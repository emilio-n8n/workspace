import type { RemoteEntry } from "./types.ts";

export type RemoteTree = {
  /** Identifiant du dossier distant servant de racine (null = racine du Drive). */
  rootId: string | null;
  /** Faux si `remotePath` est configuré mais que le dossier n'existe pas. */
  rootFound: boolean;
  /** Chemins relatifs à la racine distante. */
  entries: Map<string, RemoteEntry>;
  byId: Map<string, RemoteEntry>;
};

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/^\/+|\/+$/g, "");
}

/**
 * Reconstruit les chemins à partir des `parentId` et filtre le sous-arbre
 * demandé. Les entrées dont un ancêtre est absent (non accessible ou supprimé)
 * sont ignorées : elles ne peuvent pas être synchronisées sans leur parent.
 */
export function buildRemoteTree(entries: readonly RemoteEntry[], rootPath = "/"): RemoteTree {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const fullPaths = new Map<string, string>();
  const visiting = new Set<string>();

  function pathOf(entry: RemoteEntry): string | null {
    const cached = fullPaths.get(entry.id);
    if (cached !== undefined) return cached;
    if (visiting.has(entry.id)) return null;

    visiting.add(entry.id);
    let result: string | null;
    if (entry.parentId === null) {
      result = entry.name;
    } else {
      const parent = byId.get(entry.parentId);
      const parentFullPath = parent ? pathOf(parent) : null;
      result = parentFullPath ? `${parentFullPath}/${entry.name}` : null;
    }
    visiting.delete(entry.id);

    if (result !== null) fullPaths.set(entry.id, result);
    return result;
  }

  for (const entry of entries) pathOf(entry);

  const root = normalizeRoot(rootPath);
  if (!root) {
    const map = new Map<string, RemoteEntry>();
    for (const entry of entries) {
      const path = fullPaths.get(entry.id);
      if (path) map.set(path, entry);
    }
    return { rootId: null, rootFound: true, entries: map, byId };
  }

  const rootEntry = entries.find(
    (entry) => entry.kind === "folder" && fullPaths.get(entry.id) === root,
  );
  if (!rootEntry) {
    return { rootId: null, rootFound: false, entries: new Map(), byId };
  }

  const prefix = `${root}/`;
  const map = new Map<string, RemoteEntry>();
  for (const entry of entries) {
    const path = fullPaths.get(entry.id);
    if (!path || !path.startsWith(prefix)) continue;
    map.set(path.slice(prefix.length), entry);
  }

  return { rootId: rootEntry.id, rootFound: true, entries: map, byId };
}
