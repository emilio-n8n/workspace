/**
 * Designs de présentation, construits uniquement sur les jetons sémantiques du
 * design system : aucune couleur codée en dur, donc parité thème clair / thème
 * sombre garantie. Deux designs portent en plus un ornement discret (bandeau
 * en haut, filet à gauche) qui donne un air « maquetté » aux diapositives.
 *
 * Logique pure : la table est la seule vérité, l'interface ne fait que
 * l'appliquer (le même canevas sert à l'édition, aux vignettes, au mode
 * présentation et à l'impression).
 */

export type SlideThemeId = "papier" | "encre" | "accent" | "bande" | "fiche";

/** Ornement d'un design : un élément décoratif, jamais interactif. */
export type SlideThemeDecor = {
  className: string;
  position: "top" | "left";
};

export type SlideTheme = {
  id: SlideThemeId;
  label: string;
  /** Aide courte affichée sous le sélecteur. */
  hint: string;
  /** Fond, texte courant et bordure du cadre de la diapositive. */
  canvas: string;
  /** Remplissage et bordure des formes. */
  shape: string;
  /** Trait de la forme « ligne » (remplissage, sans bordure). */
  line: string;
  /** Anneau de sélection d'un élément (jeton d'anneau commun). */
  ring: string;
  /** Ornement du design, ou `null` pour un fond nu. */
  decor: SlideThemeDecor | null;
};

export const SLIDE_THEMES: Record<SlideThemeId, SlideTheme> = {
  papier: {
    id: "papier",
    label: "Papier",
    hint: "Fond clair, encre foncée : le rendu par défaut, lisible partout.",
    canvas: "bg-card text-foreground border-border",
    shape: "border-border bg-muted",
    line: "bg-border",
    ring: "outline-ring",
    decor: null,
  },
  encre: {
    id: "encre",
    label: "Encre",
    hint: "Fond sombre, texte clair : les couleurs suivent le thème clair/sombre.",
    canvas: "bg-foreground text-background border-transparent",
    shape: "border-background/40 bg-background/10",
    line: "bg-background/40",
    ring: "outline-ring",
    decor: null,
  },
  accent: {
    id: "accent",
    label: "Accent",
    hint: "Fond teinté par l'accent evergreen, texte dédié.",
    canvas: "bg-accent text-accent-foreground border-transparent",
    shape: "border-accent-foreground/30 bg-accent-foreground/10",
    line: "bg-accent-foreground/30",
    ring: "outline-ring",
    decor: null,
  },
  bande: {
    id: "bande",
    label: "Bandeau",
    hint: "Un bandeau plein en haut de chaque diapositive : les titres claquent.",
    canvas: "bg-card text-foreground border-border",
    shape: "border-border bg-muted",
    line: "bg-border",
    ring: "outline-ring",
    decor: { className: "bg-primary", position: "top" },
  },
  fiche: {
    id: "fiche",
    label: "Fiche",
    hint: "Un filet vertical à gauche : sobre, structuré, jamais chargé.",
    canvas: "bg-card text-foreground border-border",
    shape: "border-border bg-muted",
    line: "bg-border",
    ring: "outline-ring",
    decor: { className: "bg-accent", position: "left" },
  },
};

/** Design attribué aux nouvelles présentations et aux valeurs illisibles. */
export const DEFAULT_SLIDE_THEME: SlideThemeId = "papier";

/** Identifiants de designs, dans l'ordre d'affichage du sélecteur. */
export const SLIDE_THEME_IDS = Object.keys(SLIDE_THEMES) as SlideThemeId[];

/** Relit un design persisté : toute valeur inconnue retombe au défaut. */
export function normalizeTheme(value: unknown): SlideThemeId {
  if (typeof value === "string" && value in SLIDE_THEMES) {
    return value as SlideThemeId;
  }
  return DEFAULT_SLIDE_THEME;
}

/** Classes du cadre de diapositive pour un design. */
export function themeCanvasClass(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].canvas;
}

/** Classes d'une forme pour un design. */
export function themeShapeClass(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].shape;
}

/** Classes du trait d'une forme « ligne » pour un design. */
export function themeLineClass(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].line;
}

/** Ornement d'un design, ou `null` pour un fond nu. */
export function themeDecor(theme: SlideThemeId): SlideThemeDecor | null {
  return SLIDE_THEMES[normalizeTheme(theme)].decor;
}

/** Pastille du sélecteur : même dégradé de jetons que le rendu final. */
export function themeSwatchClass(theme: SlideThemeId): string {
  const swatches: Record<SlideThemeId, string> = {
    papier: "bg-card border-border",
    encre: "bg-foreground border-border",
    accent: "bg-accent border-border",
    bande: "bg-primary border-border",
    fiche: "bg-accent border-border",
  };
  return swatches[normalizeTheme(theme)];
}

/** Libellé d'un design, sûr même si l'identifiant vient de la base. */
export function themeLabel(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].label;
}

/** Phrase d'aide d'un design. */
export function themeHint(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].hint;
}
