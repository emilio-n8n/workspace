import type { Action, LocalEntry, RemoteEntry, SyncMode, SyncPlan, SyncState } from "./types.ts";

function depth(path: string): number {
  return path.split("/").length;
}

function rank(action: Action): number {
  if (action.type === "mkdir-local" || action.type === "mkdir-remote") return 0;
  if (action.type === "download" || action.type === "upload" || action.type === "conflict") {
    return 1;
  }
  if (action.type === "skip") return 3;
  return 2;
}

function sortActions(actions: Action[]): Action[] {
  return actions.sort(
    (a, b) =>
      rank(a) - rank(b) || depth(a.path) - depth(b.path) || a.path.localeCompare(b.path, "fr"),
  );
}

export type PlanInput = {
  local: Map<string, LocalEntry>;
  remote: Map<string, RemoteEntry>;
  state: SyncState;
  mode: SyncMode;
  mirrorDeletes: boolean;
};

/**
 * Calcule les actions d'une passe, sans effet de bord.
 *
 * Règles de suppression :
 * - two-way : une suppression locale ou distante se propage si l'autre côté
 *   n'a pas changé depuis la dernière passe ; sinon le contenu modifié gagne.
 * - upload / download : les suppressions ne se propagent que si
 *   `mirrorDeletes` est activé ; sinon l'élément est conservé de l'autre côté.
 *
 * Les conflits de type (fichier vs dossier) sont signalés et laissés à
 * l'utilisateur : aucune suppression silencieuse.
 */
export function planSync(input: PlanInput): SyncPlan {
  const actions: Action[] = [];
  const prune: string[] = [];
  const paths = new Set([
    ...input.local.keys(),
    ...input.remote.keys(),
    ...Object.keys(input.state.entries),
  ]);
  const sorted = [...paths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b, "fr"));

  for (const path of sorted) {
    const local = input.local.get(path);
    const remote = input.remote.get(path);
    const previous = input.state.entries[path];

    if (!local && !remote) {
      if (previous) prune.push(path);
      continue;
    }

    if (local?.kind === "folder" && remote?.kind === "folder") continue;

    if (local?.kind === "folder" && !remote) {
      if (input.mode === "download") {
        actions.push({
          type: "skip",
          path,
          reason: "dossier local absent du distant (mode download)",
        });
        continue;
      }
      actions.push({ type: "mkdir-remote", path });
      continue;
    }

    if (remote?.kind === "folder" && !local) {
      if (input.mode === "upload") {
        actions.push({
          type: "skip",
          path,
          reason: "dossier distant absent en local (mode upload)",
        });
        continue;
      }
      actions.push({ type: "mkdir-local", path });
      continue;
    }

    if (local && remote && local.kind !== remote.kind) {
      actions.push({
        type: "skip",
        path,
        reason: `conflit de type (${local.kind} local / ${remote.kind} distant) — résolution manuelle requise`,
      });
      continue;
    }

    if (local?.kind === "file" && !remote) {
      if (previous) {
        if (input.mode === "two-way") {
          if (local.checksum === previous.checksum) {
            actions.push({ type: "trash-local", path, reason: "remote-deleted" });
          } else {
            actions.push({ type: "upload", path, local, reason: "recreate" });
          }
          continue;
        }
        if (input.mode === "upload") {
          actions.push({ type: "upload", path, local, reason: "recreate" });
          continue;
        }
        if (input.mirrorDeletes && local.checksum === previous.checksum) {
          actions.push({ type: "trash-local", path, reason: "remote-deleted" });
          continue;
        }
        actions.push({
          type: "skip",
          path,
          reason: "supprimé côté distant, conservé localement (mode download)",
        });
        continue;
      }

      if (input.mode === "download") {
        actions.push({
          type: "skip",
          path,
          reason: "fichier local absent du distant (mode download)",
        });
        continue;
      }
      actions.push({ type: "upload", path, local, reason: "new" });
      continue;
    }

    if (remote?.kind === "file" && !local) {
      if (previous) {
        if (input.mode === "two-way") {
          if (remote.checksum === previous.remoteChecksum) {
            actions.push({ type: "trash-remote", path, remote, reason: "local-deleted" });
          } else {
            actions.push({ type: "download", path, remote });
          }
          continue;
        }
        if (input.mode === "upload") {
          if (input.mirrorDeletes && remote.checksum === previous.remoteChecksum) {
            actions.push({ type: "trash-remote", path, remote, reason: "local-deleted" });
            continue;
          }
          actions.push({
            type: "skip",
            path,
            reason: "supprimé localement, conservé côté distant (mode upload)",
          });
          continue;
        }
        actions.push({ type: "download", path, remote });
        continue;
      }

      if (input.mode === "upload") {
        actions.push({
          type: "skip",
          path,
          reason: "fichier distant absent en local (mode upload)",
        });
        continue;
      }
      actions.push({ type: "download", path, remote });
      continue;
    }

    if (local?.kind === "file" && remote?.kind === "file") {
      const localChanged = !previous || local.checksum !== previous.checksum;
      const remoteChanged = !previous || remote.checksum !== previous.remoteChecksum;

      if (!localChanged && !remoteChanged) continue;
      if (local.checksum === remote.checksum) continue;

      if (localChanged && !remoteChanged) {
        actions.push({ type: "upload", path, local, remote, reason: "local-changed" });
        continue;
      }
      if (!localChanged && remoteChanged) {
        actions.push({ type: "download", path, remote });
        continue;
      }

      if (input.mode === "two-way") {
        actions.push({ type: "conflict", path, local, remote, resolution: "both" });
        continue;
      }
      if (input.mode === "upload") {
        actions.push({ type: "upload", path, local, remote, reason: "local-changed" });
        continue;
      }
      actions.push({ type: "conflict", path, local, remote, resolution: "remote-wins" });
    }
  }

  return { actions: sortActions(actions), prune };
}
