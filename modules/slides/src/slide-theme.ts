/**
 * Thèmes de diapositive, construits uniquement sur les jetons sémantiques du
 * design system (papier, encre, accent) : aucune couleur codée en dur, donc
 * parité thème clair / thème sombre garantie.
 *
 * Logique pure : la table est la seule vérité, l'interface ne fait que
 * l'appliquer (le même canevas sert à l'édition, aux vignettes, au mode
 * présentation et à l'impression).
 */

export type SlideThemeId = "papier" | "encre" | "accent";

export type SlideTheme = {
  id: SlideThemeId;
  label: string;
  /** Aide courte affichée sous le sélecteur. */
  hint: string;
  /** Fond, texte courant et bordure du cadre de la diapositive. */
  canvas: string;
  /** Remplissage et bordure des formes. */
  shape: string;
  /** Anneau de sélection d'un élément (jeton d'anneau commun). */
  ring: string;
};

export const SLIDE_THEMES: Record<SlideThemeId, SlideTheme> = {
  papier: {
    id: "papier",
    label: "Papier",
    hint: "Fond clair, encre foncée : le rendu par défaut, lisible partout.",
    canvas: "bg-card text-foreground border-border",
    shape: "border-border bg-muted",
    ring: "outline-ring",
  },
  encre: {
    id: "encre",
    label: "Encre",
    hint: "Fond sombre, texte clair : les couleurs suivent le thème clair/sombre.",
    canvas: "bg-foreground text-background border-transparent",
    shape: "border-background/40 bg-background/10",
    ring: "outline-ring",
  },
  accent: {
    id: "accent",
    label: "Accent",
    hint: "Fond teinté par l'accent evergreen, texte dédié.",
    canvas: "bg-accent text-accent-foreground border-transparent",
    shape: "border-accent-foreground/30 bg-accent-foreground/10",
    ring: "outline-ring",
  },
};

/** Thème attribué aux nouvelles présentations et aux valeurs illisibles. */
export const DEFAULT_SLIDE_THEME: SlideThemeId = "papier";

/** Identifiants de thèmes, dans l'ordre d'affichage du sélecteur. */
export const SLIDE_THEME_IDS = Object.keys(SLIDE_THEMES) as SlideThemeId[];

/** Relit un thème persisté : toute valeur inconnue retombe au défaut. */
export function normalizeTheme(value: unknown): SlideThemeId {
  if (typeof value === "string" && value in SLIDE_THEMES) {
    return value as SlideThemeId;
  }
  return DEFAULT_SLIDE_THEME;
}

/** Classes du cadre de diapositive pour un thème. */
export function themeCanvasClass(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].canvas;
}

/** Classes d'une forme pour un thème. */
export function themeShapeClass(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].shape;
}

/** Pastille du sélecteur : même dégradé de jetons que le rendu final. */
export function themeSwatchClass(theme: SlideThemeId): string {
  const swatches: Record<SlideThemeId, string> = {
    papier: "bg-card border-border",
    encre: "bg-foreground border-border",
    accent: "bg-accent border-border",
  };
  return swatches[normalizeTheme(theme)];
}

/** Libellé d'un thème, sûr même si l'identifiant vient de la base. */
export function themeLabel(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].label;
}

/** Phrase d'aide d'un thème. */
export function themeHint(theme: SlideThemeId): string {
  return SLIDE_THEMES[normalizeTheme(theme)].hint;
}
