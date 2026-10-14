/**
 * Formats d'affichage d'une cellule numérique, comme dans un tableur : la
 * valeur stockée ne change jamais, seul l'affichage s'adapte (jamais d'arrondi
 * persisté — la précision reste celle de la saisie).
 *
 * Logique pure (aucune dépendance) : l'interface (boutons de format, rendu de
 * la grille) et le service (validation) partagent la même table.
 */

export type CellFormatId = "auto" | "number" | "integer" | "percent" | "currency";

export type CellFormatOption = {
  id: CellFormatId;
  label: string;
  /** Glyphe du bouton dans la barre d'outils. */
  glyph: string;
};

export const CELL_FORMATS: readonly CellFormatOption[] = [
  { id: "auto", label: "Format automatique", glyph: "Auto" },
  { id: "number", label: "Nombre (2 décimales)", glyph: "0,00" },
  { id: "integer", label: "Entier", glyph: "0" },
  { id: "percent", label: "Pourcentage", glyph: "%" },
  { id: "currency", label: "Euro", glyph: "€" },
];

/** Identifiants de formats, dans l'ordre des boutons. */
export const CELL_FORMAT_IDS = CELL_FORMATS.map((format) => format.id) as CellFormatId[];

/**
 * Formats réellement stockés : « auto » efface la clé (il ne se persiste pas),
 * comme les attributs booléens absents.
 */
export const CELL_STORED_FORMAT_IDS = ["number", "integer", "percent", "currency"] as const;
export type CellStoredFormat = (typeof CELL_STORED_FORMAT_IDS)[number];

/** Relit un format stocké ; `null` pour toute valeur absente ou inconnue. */
export function normalizeStoredFormat(value: unknown): CellStoredFormat | null {
  if (typeof value === "string" && (CELL_STORED_FORMAT_IDS as readonly string[]).includes(value)) {
    return value as CellStoredFormat;
  }
  return null;
}

/**
 * Analyse un nombre écrit dans une cellule : point ou virgule décimale, espaces
 * insécables tolérés. `null` dès que ce n'est pas un nombre (le formatage ne
 * s'applique alors pas).
 */
export function parseCellNumber(raw: string): number | null {
  const trimmed = raw
    .trim()
    .replace(/[\u00a0\u202f]/g, "")
    .replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const INTEGER_FORMATTER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const CURRENCY_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

/**
 * Formate une valeur pour l'affichage. « auto » — ou une valeur non numérique —
 * renvoie la valeur telle quelle : le format ne déforme jamais un texte.
 */
export function formatCellDisplay(raw: string, format: CellFormatId): string {
  if (format === "auto") return raw;
  const value = parseCellNumber(raw);
  if (value === null) return raw;
  switch (format) {
    case "number":
      return NUMBER_FORMATTER.format(value);
    case "integer":
      return INTEGER_FORMATTER.format(value);
    case "percent":
      return PERCENT_FORMATTER.format(value);
    case "currency":
      return CURRENCY_FORMATTER.format(value);
    default:
      return raw;
  }
}
