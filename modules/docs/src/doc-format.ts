/**
 * Catalogue de mise en forme avancée du document : styles de paragraphe,
 * couleurs de texte, surlignages et tailles de police.
 *
 * Aucune couleur codée en dur : chaque couleur est un jeton sémantique du
 * design system (sous forme `var(--jeton)`), donc lisible en thème clair
 * comme sombre et jamais désynchronisée du reste de la suite.
 *
 * Logique pure (aucune dépendance) : la barre d'outils et les tests partagent
 * la même table.
 */

export type ParagraphStyleId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "codeBlock";

export type ParagraphStyleOption = { id: ParagraphStyleId; label: string };

/** Styles de paragraphe proposés, dans l'ordre du sélecteur. */
export const PARAGRAPH_STYLES: readonly ParagraphStyleOption[] = [
  { id: "paragraph", label: "Normal" },
  { id: "heading1", label: "Titre 1" },
  { id: "heading2", label: "Titre 2" },
  { id: "heading3", label: "Titre 3" },
  { id: "blockquote", label: "Citation" },
  { id: "codeBlock", label: "Bloc de code" },
];

export type TextStyleColorOption = {
  id: string;
  label: string;
  /** Valeur CSS posée sur la sélection ; `null` = défaut (sans couleur). */
  css: string | null;
};

/** Couleurs de texte proposées (« Défaut » retire la couleur). */
export const DOC_TEXT_COLORS: readonly TextStyleColorOption[] = [
  { id: "default", label: "Défaut", css: null },
  { id: "muted", label: "Discret", css: "var(--muted-foreground)" },
  { id: "accent", label: "Accent", css: "var(--primary)" },
  { id: "attention", label: "Attention", css: "var(--attention)" },
  { id: "danger", label: "Alerte", css: "var(--destructive)" },
];

/** Surlignages proposés (« Aucun » retire le surlignage). */
export const DOC_HIGHLIGHTS: readonly TextStyleColorOption[] = [
  { id: "none", label: "Aucun", css: null },
  { id: "attention", label: "Jaune", css: "var(--attention)" },
  { id: "accent", label: "Accent", css: "var(--accent)" },
  { id: "muted", label: "Gris", css: "var(--muted)" },
];

/** Tailles de police proposées, en pixels. */
export const DOC_FONT_SIZES = [
  "10",
  "11",
  "12",
  "14",
  "16",
  "18",
  "20",
  "24",
  "28",
  "32",
  "36",
  "48",
] as const;

/**
 * Normalise une taille de police relue d'un attribut (« 16 », « 16px ») :
 * seules les tailles du catalogue sont retenues, pour que le sélecteur ne
 * mente jamais sur la valeur réellement appliquée.
 */
export function normalizeDocFontSize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.match(/^\d+/)?.[0];
  if (!digits) return null;
  return (DOC_FONT_SIZES as readonly string[]).includes(digits) ? digits : null;
}

export type FontFamilyOption = {
  id: string;
  label: string;
  /** Pile CSS posée sur la sélection ; `null` = police du document. */
  css: string | null;
};

/**
 * Polices proposées : piles sûres (présentes ou remplacées proprement sur
 * Windows, macOS et Linux), libellées comme dans Word.
 */
export const DOC_FONT_FAMILIES: readonly FontFamilyOption[] = [
  { id: "default", label: "Police du document", css: null },
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { id: "calibri", label: "Calibri", css: "Calibri, Carlito, sans-serif" },
  { id: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "times", label: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { id: "garamond", label: "Garamond", css: "Garamond, 'EB Garamond', serif" },
  { id: "courier", label: "Courier New", css: '"Courier New", Courier, monospace' },
];

/**
 * Police active relue d'un attribut : identifiant du catalogue, « default »
 * sans police, `null` pour une police inconnue (collée depuis Word, par ex.).
 */
export function fontFamilyIdOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "default";
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  const exact = DOC_FONT_FAMILIES.find(
    (option) => option.css !== null && option.css.toLowerCase() === normalized,
  );
  if (exact) return exact.id;
  // Première famille de la pile (« Calibri, sans-serif » collé depuis Word).
  const first = normalized.split(",")[0]?.replace(/["']/g, "").trim();
  const byLabel = DOC_FONT_FAMILIES.find((option) => option.label.toLowerCase() === first);
  return byLabel?.id ?? null;
}
