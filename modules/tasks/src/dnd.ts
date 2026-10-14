/**
 * Réordonnancement au glisser — logique pure.
 *
 * Le geste (souris, tactile, clavier) produit un déplacement « de l'index `from`
 * vers l'index `to` » ; c'est cette fonction qui le traduit en nouvel ordre. La
 * même logique sert au clavier (flèches, Début/Fin), ce qui évite deux
 * implémentations qui divergeraient.
 */

/** Bord d'insertion par rapport à la ligne survolée. */
export type DropEdge = "top" | "bottom";

/**
 * Borne du glisser : il n'a de sens que dans l'ordre manuel et sans
 * regroupement — déplacer une ligne alors que l'écran la trie par échéance
 * serait une action sans effet visible.
 */
export function canDragReorder(sort: string, group: string): boolean {
  return sort === "manual" && group === "none";
}

/**
 * Bord d'insertion selon la position du pointeur dans la ligne : au-dessus ou
 * en dessous du milieu. `height` nul (ligne non mesurée) retombe sur « bas ».
 */
export function edgeFromOffset(offsetY: number, height: number): DropEdge {
  if (!(height > 0)) return "bottom";
  return offsetY < height / 2 ? "top" : "bottom";
}

/**
 * Index cible à partir de l'index survolé et du bord : déposer « en haut » de la
 * ligne N insère avant N, « en bas » insère après.
 */
export function targetIndexFromHover(index: number, edge: DropEdge, length: number): number {
  if (index < 0 || index >= length) return -1;
  const raw = edge === "top" ? index : index + 1;
  // Une ligne ne peut pas être déposée « après la dernière ».
  return Math.min(raw, length - 1);
}

/** Applique un déplacement ; `null` si les indices sont hors bornes. */
export function moveIds<T>(ids: readonly T[], from: number, to: number): T[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return null;
  if (from === to) return [...ids];

  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
}

/** Déplacement d'un cran vers le haut (`-1`) ou le bas (`+1`). */
export function nudgeIds<T>(ids: readonly T[], from: number, delta: -1 | 1): T[] | null {
  return moveIds(ids, from, from + delta);
}

/** Déplacement vers le début ou la fin de la liste. */
export function edgeIds<T>(ids: readonly T[], from: number, to: "first" | "last"): T[] | null {
  return moveIds(ids, from, to === "first" ? 0 : ids.length - 1);
}

/**
 * Annonce du résultat d'un déplacement : position 1-indexée, accord du pluriel.
 * Un lecteur d'écran doit pouvoir répéter l'ordre à voix haute.
 */
export function describeMove(input: { title: string; index: number; total: number }): string {
  const position = input.index + 1;
  const where = input.total === 1 ? "seule ligne" : `position ${position} sur ${input.total}`;
  return `« ${input.title} » déplacée en ${where}.`;
}

/** Indications données à la poignée, reprises par le lecteur d'écran. */
export function handleHint(): string {
  return "Glisser pour réordonner, ou flèches haut et bas au clavier.";
}
