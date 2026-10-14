/**
 * Mise en forme du texte d'un élément : couleurs sémantiques et pas de
 * taille de police.
 *
 * Aucune couleur codée en dur : chaque couleur est un jeton du design system,
 * donc lisible en thème clair comme sombre. « Défaut » n'émet aucune classe
 * (le texte hérite du thème de la diapositive).
 *
 * Logique pure (aucune dépendance), partagée par l'éditeur, le canevas et les
 * tests.
 */

export type SlideTextColor = "default" | "muted" | "accent" | "attention" | "danger";

export type SlideTextColorSpec = {
  id: SlideTextColor;
  label: string;
  /** Classe appliquée au texte ; vide pour « défaut » (hériter du thème). */
  className: string;
  /** Pastille du sélecteur, sur les jetons du design system. */
  swatchClass: string;
};

export const SLIDE_TEXT_COLORS: Record<SlideTextColor, SlideTextColorSpec> = {
  default: {
    id: "default",
    label: "Défaut",
    className: "",
    swatchClass: "bg-foreground",
  },
  muted: {
    id: "muted",
    label: "Discret",
    className: "text-muted-foreground",
    swatchClass: "bg-muted-foreground",
  },
  accent: {
    id: "accent",
    label: "Accent",
    className: "text-primary",
    swatchClass: "bg-primary",
  },
  attention: {
    id: "attention",
    label: "Attention",
    className: "text-attention",
    swatchClass: "bg-attention",
  },
  danger: {
    id: "danger",
    label: "Alerte",
    className: "text-destructive",
    swatchClass: "bg-destructive",
  },
};

/** Couleurs proposées, dans l'ordre du sélecteur. */
export const SLIDE_TEXT_COLOR_IDS = Object.keys(SLIDE_TEXT_COLORS) as SlideTextColor[];

/** Relit une couleur persistée : toute valeur inconnue retombe au défaut. */
export function normalizeTextColor(value: unknown): SlideTextColor {
  if (typeof value === "string" && value in SLIDE_TEXT_COLORS) {
    return value as SlideTextColor;
  }
  return "default";
}

/** Classe de texte d'une couleur (vide pour « défaut »). */
export function textColorClass(color: SlideTextColor): string {
  return SLIDE_TEXT_COLORS[normalizeTextColor(color)].className;
}

/** Libellé français d'une couleur. */
export function textColorLabel(color: SlideTextColor): string {
  return SLIDE_TEXT_COLORS[normalizeTextColor(color)].label;
}

/** Pastille du sélecteur d'une couleur. */
export function textColorSwatch(color: SlideTextColor): string {
  return SLIDE_TEXT_COLORS[normalizeTextColor(color)].swatchClass;
}

/** Bornes de taille de police, en pixels base 960 (mêmes bornes que le service). */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;

/** Paliers « ronds » parcourus par les boutons A− / A+. */
const FONT_SIZE_RAMP = [
  8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 88, 104, 128, 160, 200,
] as const;

/**
 * Taille suivante ou précédente : les paliers de la rampe d'abord, puis des
 * pas de 4 px pour les valeurs hors rampe. Toujours dans les bornes.
 */
export function bumpFontSize(current: number, direction: -1 | 1): number {
  const size = Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current)));
  if (direction === 1) {
    const next = FONT_SIZE_RAMP.find((value) => value > size);
    return next ?? Math.min(FONT_SIZE_MAX, size + 4);
  }
  const previous = [...FONT_SIZE_RAMP].reverse().find((value) => value < size);
  return previous ?? Math.max(FONT_SIZE_MIN, size - 4);
}
