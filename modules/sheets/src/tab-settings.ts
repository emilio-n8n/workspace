/**
 * Réglages persistés d'un onglet (colonne additive `sheet_tabs.settings`,
 * migration 0003) : volets figés, filtre automatique, graphiques.
 *
 * Validation stricte et partagée : le service refuse tout ce qui sort du
 * schéma, l'interface relit les réglages avec la même fonction (une valeur
 * inconnue en base est ignorée au lieu de casser l'éditeur).
 */

export const MAX_FROZEN = 50;
export const MAX_CHARTS = 12;
export const MAX_FILTER_VALUES = 500;
export const MAX_CHART_TITLE = 120;

export type RangeRef = { startRow: number; startCol: number; endRow: number; endCol: number };

/** Volets figés : nombre de lignes de données et de colonnes de données. */
export type FrozenPanes = { rows: number; cols: number };

/**
 * Critère d'une colonne filtrée : valeurs affichées masquées (liste de
 * cases à cocher d'Excel) et/ou condition simple.
 */
export type FilterCondition =
  | { op: "contains" | "notContains" | "equals" | "notEquals"; value: string }
  | { op: "gt" | "gte" | "lt" | "lte"; value: number }
  | { op: "empty" | "notEmpty" };

export type ColumnFilter = { hidden?: string[]; condition?: FilterCondition };

export type AutoFilter = {
  /** Plage filtrée, ligne d'en-tête comprise (première ligne). */
  range: RangeRef;
  /** Critères par colonne absolue (clé = index de colonne en texte). */
  columns: Record<string, ColumnFilter>;
};

export type ChartType = "bar" | "column" | "line" | "pie";

export type SheetChart = {
  id: string;
  type: ChartType;
  /** Données sources (en-têtes de séries en première ligne, catégories en 1re colonne). */
  range: RangeRef;
  title: string;
  /** Position et taille en pixels dans la grille. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TabSettings = {
  frozen?: FrozenPanes;
  filter?: AutoFilter;
  charts?: SheetChart[];
};

export const CHART_TYPES: readonly { id: ChartType; label: string }[] = [
  { id: "column", label: "Histogramme" },
  { id: "bar", label: "Barres" },
  { id: "line", label: "Courbes" },
  { id: "pie", label: "Secteurs" },
];

const CONDITION_OPS = new Set([
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "notEmpty",
]);

export class TabSettingsError extends Error {}

function fail(message: string): never {
  throw new TabSettingsError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function int(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} invalide.`);
  }
  return value;
}

export function normalizeRange(value: unknown, bounds = { rows: 1_000, cols: 26 }): RangeRef {
  if (!isRecord(value)) fail("Plage invalide.");
  const startRow = int(value.startRow, 0, bounds.rows - 1, "Ligne de début");
  const endRow = int(value.endRow, 0, bounds.rows - 1, "Ligne de fin");
  const startCol = int(value.startCol, 0, bounds.cols - 1, "Colonne de début");
  const endCol = int(value.endCol, 0, bounds.cols - 1, "Colonne de fin");
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

function normalizeCondition(value: unknown): FilterCondition {
  if (!isRecord(value) || typeof value.op !== "string" || !CONDITION_OPS.has(value.op)) {
    fail("Condition de filtre invalide.");
  }
  const op = value.op;
  if (op === "empty" || op === "notEmpty") return { op };
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
      fail("La condition numérique attend un nombre.");
    }
    return { op, value: value.value };
  }
  if (typeof value.value !== "string" || value.value.length > 200) {
    fail("La condition texte attend un texte (200 caractères au plus).");
  }
  return { op: op as "contains", value: value.value };
}

/**
 * Valide des réglages d'onglet ; lève `TabSettingsError` au premier écart.
 * Les clés vides sont retirées (un onglet sans réglage stocke `null`).
 */
export function normalizeTabSettings(value: unknown): TabSettings | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) fail("Réglages d'onglet invalides.");
  for (const key of Object.keys(value)) {
    if (key !== "frozen" && key !== "filter" && key !== "charts") fail(`Réglage inconnu : ${key}.`);
  }
  const clean: TabSettings = {};
  if (value.frozen !== undefined) {
    if (!isRecord(value.frozen)) fail("Volets figés invalides.");
    const rows = int(value.frozen.rows, 0, MAX_FROZEN, "Nombre de lignes figées");
    const cols = int(value.frozen.cols, 0, MAX_FROZEN, "Nombre de colonnes figées");
    if (rows > 0 || cols > 0) clean.frozen = { rows, cols };
  }
  if (value.filter !== undefined && value.filter !== null) {
    if (!isRecord(value.filter)) fail("Filtre invalide.");
    const range = normalizeRange(value.filter.range);
    const columns: Record<string, ColumnFilter> = {};
    const rawColumns = value.filter.columns ?? {};
    if (!isRecord(rawColumns)) fail("Critères de filtre invalides.");
    for (const [key, raw] of Object.entries(rawColumns)) {
      const col = Number(key);
      if (!Number.isInteger(col) || col < range.startCol || col > range.endCol) {
        fail("Critère hors de la plage filtrée.");
      }
      if (!isRecord(raw)) fail("Critère de colonne invalide.");
      const entry: ColumnFilter = {};
      if (raw.hidden !== undefined) {
        if (
          !Array.isArray(raw.hidden) ||
          raw.hidden.length > MAX_FILTER_VALUES ||
          raw.hidden.some((item) => typeof item !== "string" || item.length > 500)
        ) {
          fail("Valeurs masquées invalides.");
        }
        if (raw.hidden.length > 0) entry.hidden = [...new Set(raw.hidden as string[])];
      }
      if (raw.condition !== undefined && raw.condition !== null) {
        entry.condition = normalizeCondition(raw.condition);
      }
      if (entry.hidden || entry.condition) columns[String(col)] = entry;
    }
    clean.filter = { range, columns };
  }
  if (value.charts !== undefined) {
    if (!Array.isArray(value.charts) || value.charts.length > MAX_CHARTS) {
      fail(`${MAX_CHARTS} graphiques au plus par onglet.`);
    }
    const ids = new Set<string>();
    const charts = value.charts.map((raw): SheetChart => {
      if (!isRecord(raw)) fail("Graphique invalide.");
      if (typeof raw.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(raw.id) || ids.has(raw.id)) {
        fail("Identifiant de graphique invalide.");
      }
      ids.add(raw.id);
      if (!CHART_TYPES.some((type) => type.id === raw.type)) fail("Type de graphique inconnu.");
      if (typeof raw.title !== "string" || raw.title.length > MAX_CHART_TITLE) {
        fail("Titre de graphique invalide.");
      }
      return {
        id: raw.id,
        type: raw.type as ChartType,
        range: normalizeRange(raw.range),
        title: raw.title,
        x: int(raw.x, 0, 20_000, "Position horizontale"),
        y: int(raw.y, 0, 200_000, "Position verticale"),
        width: int(raw.width, 200, 1_600, "Largeur"),
        height: int(raw.height, 150, 1_200, "Hauteur"),
      };
    });
    if (charts.length > 0) clean.charts = charts;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** Relecture tolérante (base ou réseau) : réglages invalides = aucun réglage. */
export function readTabSettings(value: unknown): TabSettings {
  try {
    return normalizeTabSettings(value) ?? {};
  } catch {
    return {};
  }
}
