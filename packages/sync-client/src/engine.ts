import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SyncApi } from "./api.ts";
import {
  loadState,
  lockPath,
  normalizeRemotePath,
  resolveToken,
  saveState,
  stateDir,
} from "./config.ts";
import {
  conflictPath,
  enrichChecksums,
  ensureLocalDir,
  mimeTypeFor,
  moveToTrash,
  setLocalMtime,
  walkLocal,
} from "./local.ts";
import { planSync } from "./plan.ts";
import { baseName, buildRemoteTree, parentPath } from "./remote.ts";
import type {
  LocalEntry,
  RemoteEntry,
  StateEntry,
  SyncConfig,
  SyncFolderConfig,
  SyncState,
} from "./types.ts";

export type SyncResult = {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  errors: number;
  details: string[];
};

function emptyResult(): SyncResult {
  return {
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    conflicts: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function folderState(entry: RemoteEntry, now: string): StateEntry {
  return {
    remoteId: entry.id,
    kind: "folder",
    remoteUpdatedAt: entry.updatedAt,
    lastSyncedAt: now,
  };
}

function fileStateFromRemote(
  entry: RemoteEntry,
  info: { mtimeMs: number; size: number },
  now: string,
): StateEntry {
  return {
    remoteId: entry.id,
    kind: "file",
    localMtimeMs: info.mtimeMs,
    localSize: info.size,
    checksum: entry.checksum ?? undefined,
    remoteChecksum: entry.checksum,
    remoteUpdatedAt: entry.updatedAt,
    lastSyncedAt: now,
  };
}

/**
 * Verrou par dossier local : empêche deux passes concurrentes (cron + daemon).
 * Un verrou de plus d'une heure est considéré comme orphelin.
 */
async function acquireLock(localPath: string): Promise<() => Promise<void>> {
  await ensureLocalDir(stateDir(localPath));
  const path = lockPath(localPath);

  try {
    const handle = await open(path, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await handle.close();
    return async () => {
      await rm(path, { force: true });
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    let stale = true;
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { startedAt?: string };
      const startedAt = raw.startedAt ? Date.parse(raw.startedAt) : Number.NaN;
      stale = Number.isNaN(startedAt) || Date.now() - startedAt > 60 * 60 * 1000;
    } catch {
      stale = true;
    }

    if (!stale) {
      throw new Error(`Une synchronisation est déjà en cours pour ${localPath} (verrou ${path}).`);
    }
    await rm(path, { force: true });
    return acquireLock(localPath);
  }
}

/**
 * Crée la chaîne de dossiers distants demandée par `remotePath` et retourne
 * l'identifiant du dossier racine (null pour la racine du Drive).
 */
async function ensureRemoteRoot(api: SyncApi, remotePath: string): Promise<string | null> {
  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") return null;

  const segments = normalized.split("/").filter(Boolean);
  const entries = await api.tree();
  const tree = buildRemoteTree(entries, "/");
  let parentId: string | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const partial = segments.slice(0, index + 1).join("/");
    const existing = tree.entries.get(partial);
    if (existing) {
      if (existing.kind !== "folder") {
        throw new Error(`Le chemin distant « ${normalized} » traverse un fichier (${partial}).`);
      }
      parentId = existing.id;
      continue;
    }

    const created = await api.ensureFolder(parentId, segments[index] ?? "");
    parentId = created.id;
  }

  return parentId;
}

async function uploadFile(
  api: SyncApi,
  state: SyncState,
  remoteIdByPath: Map<string, string>,
  rootId: string | null,
  path: string,
  local: LocalEntry,
  remote: RemoteEntry | undefined,
  now: string,
): Promise<RemoteEntry> {
  const parent = parentPath(path);
  const parentId = parent ? remoteIdByPath.get(parent) : rootId;
  if (parent && !parentId) {
    throw new Error(`Dossier distant parent introuvable : ${parent}`);
  }

  const entry = await api.upload({
    filePath: local.absolutePath,
    name: baseName(path),
    parentId: parentId ?? null,
    entryId: remote?.id,
    contentType: mimeTypeFor(path),
  });

  remoteIdByPath.set(path, entry.id);
  state.entries[path] = {
    remoteId: entry.id,
    kind: "file",
    localMtimeMs: local.mtimeMs,
    localSize: local.size,
    checksum: local.checksum,
    remoteChecksum: entry.checksum,
    remoteUpdatedAt: entry.updatedAt,
    lastSyncedAt: now,
  };
  return entry;
}

async function downloadFile(
  api: SyncApi,
  folder: SyncFolderConfig,
  state: SyncState,
  path: string,
  remote: RemoteEntry,
  now: string,
): Promise<void> {
  const destination = join(folder.localPath, path);
  await api.download(remote.id, destination);
  await setLocalMtime(destination, remote.updatedAt);
  const info = await stat(destination);
  state.entries[path] = fileStateFromRemote(remote, info, now);
}

async function handleConflict(
  api: SyncApi,
  folder: SyncFolderConfig,
  state: SyncState,
  remoteIdByPath: Map<string, string>,
  rootId: string | null,
  action: {
    path: string;
    local: LocalEntry;
    remote: RemoteEntry;
    resolution: "both" | "local-wins" | "remote-wins";
  },
  now: string,
): Promise<void> {
  const { path, local, remote } = action;

  if (action.resolution === "local-wins") {
    await uploadFile(api, state, remoteIdByPath, rootId, path, local, remote, now);
    return;
  }

  const source = join(folder.localPath, path);
  const conflict = conflictPath(path, state.deviceName, new Date());
  const destination = join(folder.localPath, conflict);
  await ensureLocalDir(dirname(destination));
  await rename(source, destination);

  await downloadFile(api, folder, state, path, remote, now);

  if (action.resolution === "both") {
    const parent = parentPath(conflict);
    const parentId = parent ? remoteIdByPath.get(parent) : rootId;
    if (parent && !parentId) {
      throw new Error(`Dossier distant parent introuvable pour la copie de conflit : ${parent}`);
    }
    const entry = await api.upload({
      filePath: destination,
      name: baseName(conflict),
      parentId: parentId ?? null,
      contentType: mimeTypeFor(conflict),
    });
    remoteIdByPath.set(conflict, entry.id);
    const info = await stat(destination);
    state.entries[conflict] = {
      remoteId: entry.id,
      kind: "file",
      localMtimeMs: info.mtimeMs,
      localSize: info.size,
      checksum: entry.checksum ?? undefined,
      remoteChecksum: entry.checksum,
      remoteUpdatedAt: entry.updatedAt,
      lastSyncedAt: now,
    };
  }
}

/** Exécute une passe de synchronisation pour un dossier. */
export async function syncFolder(
  api: SyncApi,
  folder: SyncFolderConfig,
  state: SyncState,
  options: { verbose?: boolean } = {},
): Promise<SyncResult> {
  const result = emptyResult();
  const release = await acquireLock(folder.localPath);

  try {
    await ensureLocalDir(folder.localPath);
    await ensureRemoteRoot(api, folder.remotePath);

    const remoteEntries = await api.tree();
    const tree = buildRemoteTree(remoteEntries, folder.remotePath);
    if (!tree.rootFound) {
      throw new Error(`Dossier distant introuvable : ${folder.remotePath}`);
    }

    const local = await walkLocal(folder.localPath, folder.ignore);
    await enrichChecksums(local, state);

    const plan = planSync({
      local,
      remote: tree.entries,
      state,
      mode: folder.mode,
      mirrorDeletes: folder.mirrorDeletes,
    });

    const now = new Date().toISOString();
    const remoteIdByPath = new Map<string, string>();
    for (const [path, entry] of tree.entries) remoteIdByPath.set(path, entry.id);
    const rootId = tree.rootId;

    for (const action of plan.actions) {
      try {
        switch (action.type) {
          case "mkdir-local": {
            await ensureLocalDir(join(folder.localPath, action.path));
            break;
          }
          case "mkdir-remote": {
            const parent = parentPath(action.path);
            const parentId = parent ? remoteIdByPath.get(parent) : rootId;
            if (parent && !parentId) {
              throw new Error(`Dossier distant parent introuvable : ${parent}`);
            }
            const entry = await api.ensureFolder(parentId ?? null, baseName(action.path));
            remoteIdByPath.set(action.path, entry.id);
            state.entries[action.path] = folderState(entry, now);
            result.details.push(`dossier distant créé : ${action.path}`);
            break;
          }
          case "download": {
            await downloadFile(api, folder, state, action.path, action.remote, now);
            result.downloaded += 1;
            result.details.push(`reçu : ${action.path}`);
            break;
          }
          case "upload": {
            await uploadFile(
              api,
              state,
              remoteIdByPath,
              rootId,
              action.path,
              action.local,
              action.remote,
              now,
            );
            result.uploaded += 1;
            result.details.push(`envoyé : ${action.path}`);
            break;
          }
          case "trash-remote": {
            await api.op({ action: "trash", entryId: action.remote.id });
            delete state.entries[action.path];
            remoteIdByPath.delete(action.path);
            result.deleted += 1;
            result.details.push(`supprimé côté distant : ${action.path}`);
            break;
          }
          case "trash-local": {
            await moveToTrash(folder.localPath, action.path, action.reason);
            delete state.entries[action.path];
            result.deleted += 1;
            result.details.push(`déplacé dans la corbeille locale : ${action.path}`);
            break;
          }
          case "conflict": {
            await handleConflict(api, folder, state, remoteIdByPath, rootId, action, now);
            result.conflicts += 1;
            result.details.push(`conflit résolu (${action.resolution}) : ${action.path}`);
            break;
          }
          case "skip": {
            result.skipped += 1;
            if (options.verbose) result.details.push(`ignoré : ${action.path} — ${action.reason}`);
            break;
          }
        }
      } catch (error) {
        result.errors += 1;
        result.details.push(`erreur ${action.type} « ${action.path} » : ${messageOf(error)}`);
      }
    }

    // Les fichiers identiques des deux côtés n'ont produit aucune action :
    // on mémorise leur état pour éviter de les hacher à chaque passe.
    for (const [path, localEntry] of local) {
      const remoteEntry = tree.entries.get(path);
      if (localEntry.kind === "folder" && remoteEntry?.kind === "folder") {
        state.entries[path] = folderState(remoteEntry, now);
      } else if (
        localEntry.kind === "file" &&
        remoteEntry?.kind === "file" &&
        localEntry.checksum === remoteEntry.checksum
      ) {
        state.entries[path] = {
          remoteId: remoteEntry.id,
          kind: "file",
          localMtimeMs: localEntry.mtimeMs,
          localSize: localEntry.size,
          checksum: localEntry.checksum,
          remoteChecksum: remoteEntry.checksum,
          remoteUpdatedAt: remoteEntry.updatedAt,
          lastSyncedAt: now,
        };
      }
    }

    for (const path of plan.prune) delete state.entries[path];

    state.lastSyncAt = now;
    saveState(folder.localPath, state);
    return result;
  } finally {
    await release();
  }
}

export type SyncAllResult = {
  folders: Array<{ folder: SyncFolderConfig; result: SyncResult }>;
  errors: number;
};

/** Synchronise tous les dossiers de la configuration. */
export async function syncAll(
  config: SyncConfig,
  options: { verbose?: boolean } = {},
): Promise<SyncAllResult> {
  const api = new SyncApi(config.serverUrl, resolveToken(config));
  const folders: SyncAllResult["folders"] = [];
  let errors = 0;

  for (const folder of config.folders) {
    try {
      const state = loadState(folder.localPath, config.deviceName);
      const result = await syncFolder(api, folder, state, options);
      folders.push({ folder, result });
      errors += result.errors;
    } catch (error) {
      const result = emptyResult();
      result.errors = 1;
      result.details.push(messageOf(error));
      folders.push({ folder, result });
      errors += 1;
    }
  }

  return { folders, errors };
}

export function formatResult(result: SyncResult): string {
  return `${result.uploaded} envoyé(s), ${result.downloaded} reçu(s), ${result.deleted} supprimé(s), ${result.conflicts} conflit(s), ${result.skipped} ignoré(s), ${result.errors} erreur(s)`;
}
