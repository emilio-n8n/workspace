import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { SyncConfig, SyncFolderConfig, SyncState } from "./types.ts";

const modeSchema = z.enum(["two-way", "upload", "download"]);

const folderSchema = z.object({
  localPath: z.string().min(1),
  remotePath: z.string().default("/"),
  mode: modeSchema.default("two-way"),
  ignore: z.array(z.string()).default([]),
  mirrorDeletes: z.boolean().default(false),
});

const configSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string().min(1).optional(),
  deviceName: z
    .string()
    .min(1)
    .default(() => hostname()),
  intervalSeconds: z.number().int().min(5).max(86_400).default(30),
  folders: z.array(folderSchema).min(1),
});

/** Normalise un chemin distant : toujours `/…`, sans slash final. */
export function normalizeRemotePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  const segments = trimmed.split("/").filter(Boolean);
  return `/${segments.join("/")}`;
}

/** Valide et normalise une configuration (chemins locaux absolus, URL sans slash final). */
export function normalizeConfig(input: unknown, baseDir = process.cwd()): SyncConfig {
  const parsed = configSchema.parse(input);
  return {
    serverUrl: parsed.serverUrl.replace(/\/+$/, ""),
    token: parsed.token,
    deviceName: parsed.deviceName,
    intervalSeconds: parsed.intervalSeconds,
    folders: parsed.folders.map(
      (folder): SyncFolderConfig => ({
        localPath: resolve(baseDir, folder.localPath),
        remotePath: normalizeRemotePath(folder.remotePath),
        mode: folder.mode,
        ignore: folder.ignore,
        mirrorDeletes: folder.mirrorDeletes,
      }),
    ),
  };
}

/** Chemin par défaut de la configuration (XDG / AppData / ~/.config). */
export function defaultConfigPath(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "workspace-sync", "config.json");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "workspace-sync", "config.json");
}

/** Charge et valide la configuration. */
export function loadConfig(path = defaultConfigPath()): SyncConfig {
  if (!existsSync(path)) {
    throw new Error(
      `Configuration introuvable : ${path}. Lancez « workspace-sync init » pour la créer.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Configuration illisible (${path}) : ${String(error)}`);
  }
  return normalizeConfig(raw, dirname(path));
}

/** Écrit la configuration en 0600 (elle peut contenir le jeton). */
export function saveConfig(config: SyncConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const json = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(path, json, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Jeton : variable d'environnement prioritaire, puis configuration. */
export function resolveToken(config: SyncConfig): string {
  const token = process.env.WORKSPACE_SYNC_TOKEN?.trim() || config.token?.trim();
  if (!token) {
    throw new Error(
      "Jeton manquant : définissez WORKSPACE_SYNC_TOKEN ou renseignez « token » dans la configuration.",
    );
  }
  return token;
}

export function stateDir(localPath: string): string {
  return join(localPath, ".workspace-sync");
}

export function statePath(localPath: string): string {
  return join(stateDir(localPath), "state.json");
}

export function trashDir(localPath: string): string {
  return join(stateDir(localPath), "trash");
}

export function lockPath(localPath: string): string {
  return join(stateDir(localPath), "lock");
}

export function defaultState(deviceName: string): SyncState {
  return { version: 1, deviceName, lastSyncAt: null, entries: {} };
}

/** Charge l'état ; un fichier corrompu est mis de côté plutôt que de bloquer la synchro. */
export function loadState(localPath: string, deviceName: string): SyncState {
  const path = statePath(localPath);
  if (!existsSync(path)) return defaultState(deviceName);

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncState>;
    if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
      throw new Error("format d'état inconnu");
    }
    return {
      version: 1,
      deviceName: parsed.deviceName ?? deviceName,
      lastSyncAt: parsed.lastSyncAt ?? null,
      entries: parsed.entries,
    };
  } catch {
    const backup = `${path}.corrupt-${Date.now()}`;
    try {
      renameSync(path, backup);
    } catch {
      // Le fichier reste en place si la sauvegarde échoue ; l'état repart vide.
    }
    return defaultState(deviceName);
  }
}

/** Écrit l'état de façon atomique (fichier temporaire puis renommage). */
export function saveState(localPath: string, state: SyncState): void {
  const dir = stateDir(localPath);
  mkdirSync(dir, { recursive: true });
  const path = statePath(localPath);
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}
