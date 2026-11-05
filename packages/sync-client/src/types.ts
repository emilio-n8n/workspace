/** Modes de synchronisation d'un dossier. */
export type SyncMode = "two-way" | "upload" | "download";

/** Dossier synchronisé : chemin local, chemin distant et politique. */
export type SyncFolderConfig = {
  localPath: string;
  remotePath: string;
  mode: SyncMode;
  ignore: string[];
  /** En mode one-way, propager aussi les suppressions (désactivé par défaut). */
  mirrorDeletes: boolean;
};

/** Configuration du client (fichier JSON, jeton éventuellement en variable d'env). */
export type SyncConfig = {
  serverUrl: string;
  token?: string;
  deviceName: string;
  intervalSeconds: number;
  folders: SyncFolderConfig[];
};

/** Entrée distante renvoyée par `/api/drive/sync/tree`. */
export type RemoteEntry = {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  updatedAt: string;
};

/** Entrée locale (chemin relatif à la racine synchronisée). */
export type LocalEntry = {
  path: string;
  kind: "folder" | "file";
  absolutePath: string;
  size: number;
  mtimeMs: number;
  /** Renseigné pour les fichiers après le calcul d'empreinte. */
  checksum?: string;
};

/** État persistant d'un chemin synchronisé. */
export type StateEntry = {
  remoteId: string;
  kind: "folder" | "file";
  localMtimeMs?: number;
  localSize?: number;
  checksum?: string;
  remoteChecksum?: string | null;
  remoteUpdatedAt?: string;
  lastSyncedAt: string;
};

export type SyncState = {
  version: 1;
  deviceName: string;
  lastSyncAt: string | null;
  entries: Record<string, StateEntry>;
};

/** Action calculée par le planificateur, exécutée par le moteur. */
export type Action =
  | { type: "mkdir-local"; path: string }
  | { type: "mkdir-remote"; path: string }
  | { type: "download"; path: string; remote: RemoteEntry }
  | {
      type: "upload";
      path: string;
      local: LocalEntry;
      remote?: RemoteEntry;
      reason: "new" | "local-changed" | "recreate" | "conflict-copy";
    }
  | {
      type: "trash-remote";
      path: string;
      remote: RemoteEntry;
      reason: "local-deleted" | "remote-deleted";
    }
  | {
      type: "trash-local";
      path: string;
      reason: "remote-deleted" | "local-deleted";
    }
  | {
      type: "conflict";
      path: string;
      local: LocalEntry;
      remote: RemoteEntry;
      resolution: "both" | "local-wins" | "remote-wins";
    }
  | { type: "skip"; path: string; reason: string };

export type SyncPlan = {
  actions: Action[];
  /** Chemins d'état à oublier (supprimés des deux côtés). */
  prune: string[];
};
