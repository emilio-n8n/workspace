/**
 * Palette des libellés personnels — UNIQUEMENT des couleurs sémantiques du
 * système de design (aucune couleur libre, aucun hexadécimal dans le code).
 * Cinq teintes aux teintes bien distinctes, lisibles en clair et en sombre,
 * désignées en français pour l'écran de gestion.
 */

export type LabelColorKey = "vert" | "ambre" | "bleu" | "orange" | "violet";

export const LABEL_COLORS: { key: LabelColorKey; label: string }[] = [
  { key: "vert", label: "Vert" },
  { key: "ambre", label: "Ambre" },
  { key: "bleu", label: "Bleu" },
  { key: "orange", label: "Orange" },
  { key: "violet", label: "Violet" },
];

/** Couleur attribuée par défaut à la création d'un libellé. */
export const DEFAULT_LABEL_COLOR: LabelColorKey = "bleu";

export function isLabelColorKey(value: unknown): value is LabelColorKey {
  return typeof value === "string" && LABEL_COLORS.some((color) => color.key === value);
}

/** Libellé français d'une clé de couleur (« bleu » → « Bleu »). */
export function labelColorName(key: string): string {
  return LABEL_COLORS.find((color) => color.key === key)?.label ?? "Couleur inconnue";
}

/** Bornes de saisie des libellés (création, renommage). */
export const MAX_LABEL_NAME_LENGTH = 40;
/** Nombre maximal de libellés par utilisateur — au-delà, on refuse. */
export const MAX_LABELS_PER_USER = 25;
/** Libellés applicables à un même message. */
export const MAX_LABELS_PER_MESSAGE = 5;
