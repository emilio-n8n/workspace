/**
 * Mises en page de diapositive : titre, titre et contenu, vierge.
 *
 * Chaque mise en page décrit des zones « à remplir » (titre, sous-titre,
 * corps) que l'éditeur matérialise en éléments texte porteurs d'un rôle
 * `placeholder`. Une zone vide affiche son invitation (« Cliquez pour ajouter
 * un titre ») et se remplit d'un simple clic : c'est le geste de base d'un
 * outil de présentation.
 *
 * Logique pure (aucune dépendance) : le service crée la première diapositive
 * d'une présentation avec ces zones, l'éditeur crée les suivantes, les tests
 * partagent la même table.
 */

export type SlideLayoutId = "title" | "title-content" | "blank";

/** Rôle d'une zone de contenu d'une mise en page. */
export type SlidePlaceholderRole = "title" | "subtitle" | "body";

/** Rôles acceptés, dans l'ordre d'affichage. */
export const PLACEHOLDER_ROLES = ["title", "subtitle", "body"] as const;

/**
 * Géométrie d'une zone de mise en page, en pourcentages de la diapositive
 * (mêmes unités que les éléments : 0-100, y compris la taille du texte en
 * pixels base 960).
 */
export type LayoutElement = {
  placeholder: SlidePlaceholderRole;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
};

export type SlideLayout = {
  id: SlideLayoutId;
  label: string;
  hint: string;
  elements: LayoutElement[];
};

export const SLIDE_LAYOUTS: Record<SlideLayoutId, SlideLayout> = {
  title: {
    id: "title",
    label: "Titre",
    hint: "Un grand titre centré, un sous-titre.",
    elements: [
      {
        placeholder: "title",
        x: 8,
        y: 28,
        w: 84,
        h: 18,
        fontSize: 48,
        bold: true,
        align: "center",
      },
      {
        placeholder: "subtitle",
        x: 14,
        y: 52,
        w: 72,
        h: 12,
        fontSize: 24,
        bold: false,
        align: "center",
      },
    ],
  },
  "title-content": {
    id: "title-content",
    label: "Titre et contenu",
    hint: "Un titre, une grande zone de texte.",
    elements: [
      {
        placeholder: "title",
        x: 6,
        y: 6,
        w: 88,
        h: 16,
        fontSize: 36,
        bold: true,
        align: "left",
      },
      {
        placeholder: "body",
        x: 8,
        y: 26,
        w: 84,
        h: 62,
        fontSize: 20,
        bold: false,
        align: "left",
      },
    ],
  },
  blank: {
    id: "blank",
    label: "Vierge",
    hint: "Page blanche : ajoutez ce que vous voulez.",
    elements: [],
  },
};

/** Mises en page proposées, dans l'ordre du dialogue d'insertion. */
export const SLIDE_LAYOUT_IDS = Object.keys(SLIDE_LAYOUTS) as SlideLayoutId[];

/** Mise en page de la toute première diapositive d'une présentation. */
export const TITLE_LAYOUT: SlideLayoutId = "title";

/** Mise en page proposée par défaut pour une nouvelle diapositive. */
export const DEFAULT_NEW_LAYOUT: SlideLayoutId = "title-content";

/** Relit une mise en page persistée : toute valeur inconnue retombe au défaut. */
export function normalizeLayout(value: unknown): SlideLayoutId {
  if (typeof value === "string" && value in SLIDE_LAYOUTS) {
    return value as SlideLayoutId;
  }
  return DEFAULT_NEW_LAYOUT;
}

/** Libellé français d'une mise en page. */
export function layoutLabel(layout: SlideLayoutId): string {
  return SLIDE_LAYOUTS[normalizeLayout(layout)].label;
}

/** Phrase d'aide d'une mise en page. */
export function layoutHint(layout: SlideLayoutId): string {
  return SLIDE_LAYOUTS[normalizeLayout(layout)].hint;
}

/** Zones d'une mise en page, copiées pour ne jamais être partagées. */
export function layoutElements(layout: SlideLayoutId): LayoutElement[] {
  return SLIDE_LAYOUTS[normalizeLayout(layout)].elements.map((element) => ({ ...element }));
}

/** Relit un rôle persisté : toute valeur inconnue devient « aucune zone ». */
export function normalizePlaceholder(value: unknown): SlidePlaceholderRole | null {
  if (typeof value === "string" && (PLACEHOLDER_ROLES as readonly string[]).includes(value)) {
    return value as SlidePlaceholderRole;
  }
  return null;
}

/** Invitation affichée dans une zone vide (le geste attendu, en français). */
export const PLACEHOLDER_HINTS: Record<SlidePlaceholderRole, string> = {
  title: "Cliquez pour ajouter un titre",
  subtitle: "Cliquez pour ajouter un sous-titre",
  body: "Cliquez pour ajouter du texte",
};

/** Invitation d'un rôle de zone. */
export function placeholderHint(role: SlidePlaceholderRole): string {
  return PLACEHOLDER_HINTS[role];
}

/** Nom court d'un rôle, pour les noms accessibles (« Élément titre »). */
export function placeholderLabel(role: SlidePlaceholderRole): string {
  return role === "subtitle" ? "sous-titre" : role === "body" ? "texte" : "titre";
}
