/**
 * Préférences d'affichage du navigateur Drive : clé de tri, sens du tri et
 * densité des lignes.
 *
 * Aucune dépendance au DOM ni au stockage : la lecture/écriture est faite par
 * l'appelant, et la logique est testée isolément (test/view-prefs.test.ts).
 */

/** Clés de tri proposées par le menu « Trier ». */
export const SORT_KEYS = ["name", "date", "size"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Sens du tri. */
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Densité d'affichage des lignes du tableau. */
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/**
 * Clé de stockage local des préférences d'affichage. Même convention que le
 * thème (`workspace-theme`) : un préfixe, des points, pas d'espace.
 */
export const VIEW_PREFS_STORAGE_KEY = "workspace.drive.view";

export type ViewPrefs = {
  sortKey: SortKey;
  sortDirection: SortDirection;
  density: Density;
};

/** Préférences appliquées quand rien n'est enregistré (ou en cas de données illisibles). */
export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  sortKey: "name",
  sortDirection: "asc",
  density: "comfortable",
};

/** Libellés du menu « Trier ». */
export const SORT_LABELS: Record<SortKey, string> = {
  name: "Nom",
  date: "Date de modification",
  size: "Taille",
};

/** Libellés du menu « Densité ». */
export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: "Confort",
  compact: "Compact",
};

/** Libellés du sens du tri. */
export const DIRECTION_LABELS: Record<SortDirection, string> = {
  asc: "Croissant",
  desc: "Décroissant",
};

const SORT_KEY_SET: ReadonlySet<string> = new Set(SORT_KEYS);
const DIRECTION_SET: ReadonlySet<string> = new Set(SORT_DIRECTIONS);
const DENSITY_SET: ReadonlySet<string> = new Set(DENSITIES);

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && SORT_KEY_SET.has(value);
}

export function isSortDirection(value: unknown): value is SortDirection {
  return typeof value === "string" && DIRECTION_SET.has(value);
}

export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && DENSITY_SET.has(value);
}

/**
 * Sens appliqué quand on change de clé de tri : les noms se lisent de A à Z,
 * les dates et les tailles du plus récent au plus gros.
 */
export function defaultDirection(key: SortKey): SortDirection {
  return key === "name" ? "asc" : "desc";
}

/**
 * Lit des préférences sérialisées. Une chaîne absente, vide, mal formée ou
 * contenant des valeurs inconnues retombe sur les valeurs par défaut : une
 * préférence corrompue ne doit jamais empêcher l'affichage de la liste.
 */
export function parseViewPrefs(raw: string | null | undefined): ViewPrefs {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ...DEFAULT_VIEW_PREFS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_VIEW_PREFS };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_VIEW_PREFS };
  }

  const record = parsed as Record<string, unknown>;
  const sortKey = isSortKey(record.sortKey) ? record.sortKey : DEFAULT_VIEW_PREFS.sortKey;
  return {
    sortKey,
    sortDirection: isSortDirection(record.sortDirection)
      ? record.sortDirection
      : defaultDirection(sortKey),
    density: isDensity(record.density) ? record.density : DEFAULT_VIEW_PREFS.density,
  };
}

/** Sérialise les préférences pour le stockage local. */
export function serializeViewPrefs(prefs: ViewPrefs): string {
  return JSON.stringify({
    sortKey: prefs.sortKey,
    sortDirection: prefs.sortDirection,
    density: prefs.density,
  });
}

/** Bascule le sens du tri. */
export function toggleDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** Champs nécessaires au tri d'une entrée Drive. */
export type SortableEntry = {
  kind: "folder" | "file";
  name: string;
  updatedAt: string;
  sizeBytes: number | null;
};

/**
 * Comparaison selon la clé demandée. À égalité, le nom tranche pour que l'ordre
 * soit stable d'un rendu à l'autre.
 */
export function compareByKey(a: SortableEntry, b: SortableEntry, key: SortKey): number {
  let raw = 0;
  if (key === "name") {
    // `sensitivity: "base"` ignore accents et casse (« État » avant « finance »).
    raw = a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  } else if (key === "date") {
    raw = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  } else {
    // Les dossiers n'ont pas de taille : 0 les place en tête du groupe des fichiers.
    raw = (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
  }
  if (raw !== 0) return raw;
  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

/**
 * Trie une liste d'entrées : les dossiers d'abord (quel que soit le critère),
 * puis selon la clé et le sens choisis. Le tri est toujours appliqué — un
 * en-tête ne doit jamais pouvoir mentir sur l'ordre affiché.
 */
export function sortEntries<T extends SortableEntry>(
  entries: readonly T[],
  prefs: Pick<ViewPrefs, "sortKey" | "sortDirection">,
): T[] {
  const sign = prefs.sortDirection === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compareByKey(a, b, prefs.sortKey) * sign;
  });
}

/** Remplissage vertical d'une ligne selon la densité choisie. */
export function rowPadding(density: Density): string {
  return density === "compact" ? "py-1" : "py-2.5";
}

/** Description lue par les lecteurs d'écran (« Nom, croissant »). */
export function sortSummary(prefs: Pick<ViewPrefs, "sortKey" | "sortDirection">): string {
  return `${SORT_LABELS[prefs.sortKey]}, ${DIRECTION_LABELS[prefs.sortDirection].toLowerCase()}`;
}

/** Rôle `aria-sort` d'un en-tête : `none` quand une autre clé trie la liste. */
export function ariaSortFor(
  column: SortKey,
  prefs: Pick<ViewPrefs, "sortKey" | "sortDirection">,
): "ascending" | "descending" | "none" {
  if (prefs.sortKey !== column) return "none";
  return prefs.sortDirection === "asc" ? "ascending" : "descending";
}
