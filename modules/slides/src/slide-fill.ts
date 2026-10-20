/**
 * Remplissage et rotation d'un élément de diapositive (formes, zones de texte).
 *
 * Aucune couleur codée en dur : chaque remplissage est un jeton du design
 * system, lisible en thème clair comme sombre. « Thème » n'émet que la classe
 * de forme du design de la présentation (rendu historique) ; « Aucun » rend
 * l'élément transparent.
 *
 * Logique pure (aucune dépendance), partagée par l'éditeur, le canevas, le
 * service et les tests.
 */

export type SlideFill = "theme" | "none" | "muted" | "accent" | "attention" | "danger" | "ink";

export type SlideFillSpec = {
  id: SlideFill;
  label: string;
  /** Classes de remplissage ; vide pour « thème » (classe du design). */
  className: string;
  /** Trait d'une ligne dans cette couleur. */
  lineClass: string;
  /** Pastille du sélecteur. */
  swatchClass: string;
};

export const SLIDE_FILLS: Record<SlideFill, SlideFillSpec> = {
  theme: {
    id: "theme",
    label: "Thème",
    className: "",
    lineClass: "",
    swatchClass: "bg-muted",
  },
  none: {
    id: "none",
    label: "Aucun",
    className: "bg-transparent",
    lineClass: "",
    swatchClass: "bg-transparent border border-dashed border-border",
  },
  muted: {
    id: "muted",
    label: "Gris",
    className: "bg-muted-foreground/25",
    lineClass: "bg-muted-foreground",
    swatchClass: "bg-muted-foreground/40",
  },
  accent: {
    id: "accent",
    label: "Accent",
    className: "bg-primary text-primary-foreground",
    lineClass: "bg-primary",
    swatchClass: "bg-primary",
  },
  attention: {
    id: "attention",
    label: "Attention",
    className: "bg-attention/80",
    lineClass: "bg-attention",
    swatchClass: "bg-attention",
  },
  danger: {
    id: "danger",
    label: "Alerte",
    className: "bg-destructive text-destructive-foreground",
    lineClass: "bg-destructive",
    swatchClass: "bg-destructive",
  },
  ink: {
    id: "ink",
    label: "Encre",
    className: "bg-foreground text-background",
    lineClass: "bg-foreground",
    swatchClass: "bg-foreground",
  },
};

/** Remplissages proposés, dans l'ordre du sélecteur. */
export const SLIDE_FILL_IDS = Object.keys(SLIDE_FILLS) as SlideFill[];

/** Remplissage par défaut : celui du design de la présentation. */
export const DEFAULT_SLIDE_FILL: SlideFill = "theme";

/** Relit un remplissage persisté : toute valeur inconnue retombe au thème. */
export function normalizeFill(value: unknown): SlideFill {
  if (typeof value === "string" && Object.hasOwn(SLIDE_FILLS, value)) {
    return value as SlideFill;
  }
  return DEFAULT_SLIDE_FILL;
}

/** Libellé français d'un remplissage. */
export function fillLabel(fill: SlideFill): string {
  return SLIDE_FILLS[normalizeFill(fill)].label;
}

/** Pastille du sélecteur d'un remplissage. */
export function fillSwatch(fill: SlideFill): string {
  return SLIDE_FILLS[normalizeFill(fill)].swatchClass;
}

/**
 * Classe de fond d'un élément : le remplissage choisi, ou à défaut celle du
 * design (`themeClass`, vide pour une zone de texte sans fond).
 */
export function fillClass(fill: SlideFill, themeClass: string): string {
  const spec = SLIDE_FILLS[normalizeFill(fill)];
  return spec.id === "theme" ? themeClass : spec.className;
}

/** Trait d'une ligne : la couleur choisie, ou celle du design. */
export function lineFillClass(fill: SlideFill, themeLine: string): string {
  const spec = SLIDE_FILLS[normalizeFill(fill)];
  return spec.lineClass === "" ? themeLine : spec.lineClass;
}

/**
 * Rotation en degrés entiers, ramenée dans [0, 360) : −90 devient 270,
 * 450 devient 90. Toute valeur non finie retombe à 0.
 */
export function normalizeRotation(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number) % 360;
  return rounded < 0 ? rounded + 360 : rounded === 0 ? 0 : rounded;
}

/** Fait pivoter de `delta` degrés (± 90 pour les commandes de menu). */
export function rotateBy(rotation: number, delta: number): number {
  return normalizeRotation(normalizeRotation(rotation) + delta);
}

/** Transformation CSS d'une rotation (non définie à 0° : aucun calque inutile). */
export function rotationTransform(rotation: number): string | undefined {
  const value = normalizeRotation(rotation);
  return value === 0 ? undefined : `rotate(${value}deg)`;
}
