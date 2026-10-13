/**
 * Catalogue des actions de mise en forme de la barre d'outils de l'éditeur.
 *
 * Source unique : libellé français, glyphe, marque Tiptap et raccourci clavier
 * d'un même format sont déclarés une seule fois, puis consommés à la fois par
 * la barre d'outils et par le pont clavier. Un format ne peut donc pas avoir
 * deux noms, ni un raccourci orphelin (actif dans l'éditeur, absent de la
 * barre). Ce module est sans React ni DOM : il est testable directement.
 */

/** Identifiant d'une action de mise en forme — aussi le nom de la marque. */
export type FormatActionId = "bold" | "italic" | "underline";

export type FormatAction = {
  id: FormatActionId;
  /** Libellé français : nom accessible du bouton et texte de l'info-bulle. */
  label: string;
  /** Glyphe affiché dans la barre d'outils à la place du libellé. */
  glyph: string;
  /** Classes Tailwind du glyphe (gras, italique, souligné). */
  glyphClassName?: string;
  /** Touche principale du raccourci, sans modificateur (« b », « i », « u »). */
  shortcutKey: string;
};

export const FORMAT_ACTIONS: readonly FormatAction[] = [
  { id: "bold", label: "Gras", glyph: "B", glyphClassName: "font-bold", shortcutKey: "b" },
  { id: "italic", label: "Italique", glyph: "I", glyphClassName: "italic", shortcutKey: "i" },
  { id: "underline", label: "Souligné", glyph: "U", glyphClassName: "underline", shortcutKey: "u" },
];

/** Libellés du modificateur de raccourci : `⌘` sur macOS, `Ctrl` ailleurs. */
export const MODIFIER_LABELS = { default: "Ctrl", mac: "⌘" } as const;

/** Préfixe `aria-keyshortcuts` correspondant à un libellé de modificateur. */
export function ariaModifier(label: string): string {
  return label === MODIFIER_LABELS.mac ? "Meta" : "Control";
}

/** Raccourci affiché à l'utilisateur, ex. « Ctrl+B » ou « ⌘I ». */
export function shortcutHint(shortcutKey: string, modifier: string): string {
  // Convention macOS : le symbole se colle à la touche ; Ctrl garde le « + ».
  const separator = modifier === MODIFIER_LABELS.mac ? "" : "+";
  return `${modifier}${separator}${shortcutKey.toUpperCase()}`;
}

/** Valeur `aria-keyshortcuts` du même raccourci, ex. « Control+B », « Meta+I ». */
export function ariaKeyshortcuts(shortcutKey: string, modifier: string): string {
  return `${ariaModifier(modifier)}+${shortcutKey.toUpperCase()}`;
}

/** Modificateurs d'un évènement clavier réduits à ce que le pont consomme. */
export type ShortcutInput = {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

/**
 * Action de mise en forme portée par un évènement clavier, ou `null`.
 *
 * `Ctrl` (Windows, Linux) et `⌘` (macOS) sont traités à l'identique — Tiptap
 * nomme ce modificateur « Mod ». `Alt` est rejeté (combinaisons systèmes), et
 * une touche morte ou multi-caractères (« Control », « Enter »…) n'actionne
 * rien : seules les lettres comptent.
 */
export function matchFormatAction(input: ShortcutInput): FormatAction | null {
  if (input.alt) return null;
  if (!input.ctrl && !input.meta) return null;
  const key = input.key.toLowerCase();
  if (key.length !== 1) return null;
  return FORMAT_ACTIONS.find((action) => action.shortcutKey === key) ?? null;
}
