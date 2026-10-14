/**
 * Figement de l'en-tête et de la première colonne au défilement.
 *
 * La grille est un tableau natif : figer consiste à rendre les en-têtes
 * « collants » (`position: sticky`). Ce module décide quelles classes appliquer
 * et formule les libellés — logique pure, testable sans navigateur.
 */

export type FreezeState = {
  /** Ligne d'en-têtes (lettres de colonnes) visible pendant le défilement. */
  header: boolean;
  /** Première colonne (numéros de lignes) visible pendant le défilement. */
  firstColumn: boolean;
};

/** Par défaut, les deux repères sont figés : c'est le comportement d'origine. */
export const DEFAULT_FREEZE: FreezeState = { header: true, firstColumn: true };

export type FreezeClasses = {
  /** Coin supérieur gauche (les deux axes figés). */
  corner: string;
  /** Ligne des lettres de colonnes. */
  header: string;
  /** Colonne des numéros de lignes. */
  firstColumn: string;
};

/** Classes d'empilement d'un en-tête figé (au-dessus des cellules qui filent). */
const STICKY_HEADER = "sticky top-0 z-10";
const STICKY_COLUMN = "sticky left-0 z-10";

/**
 * Classes de positionnement des en-têtes selon l'état de figement. Les bordures
 * et les fonds restent dans l'appelant : ici ne vit que la géométrie.
 */
export function freezeClasses(freeze: FreezeState): FreezeClasses {
  const header = freeze.header ? STICKY_HEADER : "relative";
  const column = freeze.firstColumn ? STICKY_COLUMN : "relative";
  return {
    corner: [
      freeze.header ? "sticky top-0 z-20" : "relative",
      freeze.firstColumn ? "sticky left-0 z-20" : "relative",
    ].join(" "),
    header,
    firstColumn: column,
  };
}

/** Inverse un des deux repères (les deux peuvent être figés ensemble). */
export function toggleFreeze(freeze: FreezeState, part: keyof FreezeState): FreezeState {
  return { ...freeze, [part]: !freeze[part] };
}

/** Phrase d'aide affichée sous la barre d'outils. */
export function freezeHint(freeze: FreezeState): string {
  if (freeze.header && freeze.firstColumn) {
    return "En-tête et première colonne figés pendant le défilement.";
  }
  if (freeze.header) return "En-tête figé pendant le défilement.";
  if (freeze.firstColumn) return "Première colonne figée pendant le défilement.";
  return "Aucun repère figé : les en-têtes défilent avec les cellules.";
}

/** Libellé d'un bouton de figement, état compris. */
export function freezeButtonLabel(part: keyof FreezeState): string {
  return part === "header" ? "Figer l'en-tête" : "Figer la première colonne";
}

/** Résumé court pour une région live (« 2 repères figés »). */
export function freezeAnnouncement(freeze: FreezeState): string {
  const parts: string[] = [];
  if (freeze.header) parts.push("l'en-tête");
  if (freeze.firstColumn) parts.push("la première colonne");
  if (parts.length === 0) return "Aucun repère figé.";
  return `${parts.join(" et ")} ${parts.length > 1 ? "sont" : "est"} figé${parts.length > 1 ? "s" : ""}.`;
}
