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

/** Puce canonique d'une liste à puces (« • » suivi d'une espace). */
export const BULLET_PREFIX = "• ";

/** Détecte une puce existante : « • » ou un tiret suivi d'une espace. */
const BULLET_PATTERN = /^(?:•|-)\s/;

/** Détecte un numéro existant : « 1. » suivi d'une espace. */
const NUMBER_PATTERN = /^\d+\.\s/;

/** Lignes non vides d'un texte, telles quelles. */
function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

/** Vrai si toutes les lignes non vides portent une puce. */
export function isBulletList(text: string): boolean {
  const lines = nonEmptyLines(text);
  return lines.length > 0 && lines.every((line) => BULLET_PATTERN.test(line));
}

/** Vrai si toutes les lignes non vides portent un numéro. */
export function isNumberedList(text: string): boolean {
  const lines = nonEmptyLines(text);
  return lines.length > 0 && lines.every((line) => NUMBER_PATTERN.test(line));
}

/** Retire puces et numéros de chaque ligne (les lignes vides restent vides). */
function stripMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(BULLET_PATTERN, "").replace(NUMBER_PATTERN, ""))
    .join("\n");
}

/**
 * Bascule une liste à puces : si toutes les lignes non vides sont déjà
 * puçées, les puces sont retirées ; sinon elles sont ajoutées (les numéros
 * éventuels sont remplacés). Les lignes vides ne comptent jamais.
 */
export function toggleBulletList(text: string): string {
  if (nonEmptyLines(text).length === 0) return text;
  if (isBulletList(text)) return stripMarkers(text);
  return stripMarkers(text)
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `${BULLET_PREFIX}${line}` : line))
    .join("\n");
}

/**
 * Bascule une liste numérotée : si toutes les lignes non vides sont déjà
 * numérotées, les numéros sont retirés ; sinon chaque ligne non vide reçoit
 * son rang (les puces éventuelles sont remplacées). Les lignes vides ne
 * comptent ni ne consomment de numéro.
 */
export function toggleNumberedList(text: string): string {
  if (nonEmptyLines(text).length === 0) return text;
  if (isNumberedList(text)) return stripMarkers(text);
  let rank = 0;
  return stripMarkers(text)
    .split("\n")
    .map((line) => {
      if (line.trim().length === 0) return line;
      rank += 1;
      return `${rank}. ${line}`;
    })
    .join("\n");
}
