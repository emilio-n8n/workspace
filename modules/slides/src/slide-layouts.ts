/**
 * Mises en page de diapositive : huit dispositions prêtes à remplir, comme la
 * galerie d'un vrai outil de présentation.
 *
 * Chaque mise en page décrit des zones « à remplir » (titre, sous-titre,
 * corps, image) que l'éditeur matérialise en éléments porteurs d'un rôle
 * `placeholder`. Une zone vide affiche son invitation (« Cliquez pour ajouter
 * un titre ») et se remplit d'un clic ; une zone « image » ouvre le choix
 * d'une image, qui remplace la zone.
 *
 * Logique pure (aucune dépendance) : le service crée la première diapositive
 * d'une présentation avec ces zones, l'éditeur crée les suivantes, les tests
 * partagent la même table.
 */

export type SlideLayoutId =
  | "title"
  | "title-content"
  | "section"
  | "title-two-content"
  | "title-image"
  | "image-full"
  | "quote"
  | "blank";

/** Rôle d'une zone de contenu d'une mise en page. */
export type SlidePlaceholderRole = "title" | "subtitle" | "body" | "image";

/** Rôles acceptés, dans l'ordre d'affichage. */
export const PLACEHOLDER_ROLES = ["title", "subtitle", "body", "image"] as const;

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

/** Une zone texte de mise en page, sans répéter les valeurs par défaut. */
function zone(
  placeholder: SlidePlaceholderRole,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  options: { bold?: boolean; align?: "left" | "center" | "right" } = {},
): LayoutElement {
  return {
    placeholder,
    x,
    y,
    w,
    h,
    fontSize,
    bold: options.bold ?? false,
    align: options.align ?? "left",
  };
}

export const SLIDE_LAYOUTS: Record<SlideLayoutId, SlideLayout> = {
  title: {
    id: "title",
    label: "Titre",
    hint: "Un grand titre centré, un sous-titre.",
    elements: [
      zone("title", 8, 28, 84, 18, 48, { bold: true, align: "center" }),
      zone("subtitle", 14, 52, 72, 12, 24, { align: "center" }),
    ],
  },
  "title-content": {
    id: "title-content",
    label: "Titre et contenu",
    hint: "Un titre, une grande zone de texte.",
    elements: [zone("title", 6, 6, 88, 16, 36, { bold: true }), zone("body", 8, 26, 84, 62, 20)],
  },
  section: {
    id: "section",
    label: "Titre de section",
    hint: "Une grande annonce pour ouvrir une partie.",
    elements: [
      zone("title", 8, 36, 84, 20, 44, { bold: true }),
      zone("subtitle", 8, 60, 60, 10, 20),
    ],
  },
  "title-two-content": {
    id: "title-two-content",
    label: "Titre et deux colonnes",
    hint: "Deux zones de texte côte à côte pour comparer.",
    elements: [
      zone("title", 6, 6, 88, 14, 32, { bold: true }),
      zone("body", 6, 24, 42, 66, 18),
      zone("body", 52, 24, 42, 66, 18),
    ],
  },
  "title-image": {
    id: "title-image",
    label: "Titre et image",
    hint: "Un titre, du texte à gauche et une image à droite.",
    elements: [
      zone("title", 6, 6, 88, 14, 32, { bold: true }),
      zone("body", 6, 24, 40, 66, 18),
      zone("image", 50, 22, 44, 70, 20),
    ],
  },
  "image-full": {
    id: "image-full",
    label: "Image pleine page",
    hint: "Une image plein cadre, un titre par-dessus.",
    elements: [zone("image", 3, 3, 94, 94, 20)],
  },
  quote: {
    id: "quote",
    label: "Citation",
    hint: "Une citation centrée avec sa source.",
    elements: [
      zone("body", 10, 30, 80, 30, 32, { align: "center" }),
      zone("subtitle", 10, 64, 80, 10, 18, { align: "center" }),
    ],
  },
  blank: {
    id: "blank",
    label: "Vierge",
    hint: "Page blanche : ajoutez ce que vous voulez.",
    elements: [],
  },
};

/** Mises en page proposées, dans l'ordre de la galerie. */
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
  image: "Cliquez pour insérer une image",
};

/** Invitation d'un rôle de zone. */
export function placeholderHint(role: SlidePlaceholderRole): string {
  return PLACEHOLDER_HINTS[role];
}

/** Nom court d'un rôle, pour les noms accessibles (« Élément titre »). */
export function placeholderLabel(role: SlidePlaceholderRole): string {
  if (role === "title") return "titre";
  if (role === "subtitle") return "sous-titre";
  if (role === "body") return "texte";
  return "image";
}
