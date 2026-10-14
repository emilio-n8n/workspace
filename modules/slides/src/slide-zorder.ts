/**
 * Ordre z des éléments d'une diapositive (avant-plan / arrière-plan).
 *
 * L'ordre du tableau des éléments est l'ordre de rendu : le premier élément est
 * au fond, le dernier au premier plan. Les opérations sont pures — l'entrée
 * n'est jamais mutée — et partagées par les boutons explicites et les
 * raccourcis clavier, donc testables sans navigateur.
 */

export type ZMove = "front" | "forward" | "backward" | "back";

/** Opérations d'ordre z, du fond vers l'avant, pour l'affichage. */
export const Z_MOVE_ORDER = ["back", "backward", "forward", "front"] as const;

const Z_MOVE_LABELS: Record<ZMove, string> = {
  back: "Arrière-plan",
  backward: "Reculer",
  forward: "Avancer",
  front: "Avant-plan",
};

/** Libellé français d'une opération d'ordre z. */
export function zMoveLabel(move: ZMove): string {
  return Z_MOVE_LABELS[move];
}

/** L'opération change-t-elle réellement la place de l'élément ? */
export function canMoveZ(index: number, move: ZMove, count: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= count) return false;
  if (move === "front" || move === "forward") return index < count - 1;
  return index > 0;
}

/**
 * Déplace l'élément `index` selon `move` et renvoie une copie du tableau.
 * Index hors bornes ou déplacement à l'identique : la copie est renvoyée
 * inchangée (jamais de mutation de l'état appelant, jamais de saut d'index).
 */
export function zOrderMove<T>(items: readonly T[], index: number, move: ZMove): T[] {
  const copy = [...items];
  if (!Number.isInteger(index) || index < 0 || index >= copy.length) return copy;

  let target: number;
  if (move === "front") target = copy.length - 1;
  else if (move === "back") target = 0;
  else if (move === "forward") target = Math.min(copy.length - 1, index + 1);
  else target = Math.max(0, index - 1);

  if (target === index) return copy;
  const [moved] = copy.splice(index, 1);
  if (moved === undefined) return [...items];
  copy.splice(target, 0, moved);
  return copy;
}

/**
 * Raccourci clavier d'une opération d'ordre z, ou null. Reprend la convention
 * des éditeurs de diapositives : Ctrl/Cmd + ↑ avance, Ctrl/Cmd + ↓ recule, et
 * avec Maj l'élément va directement à l'avant-plan ou à l'arrière-plan.
 */
export function zMoveForKey(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): ZMove | null {
  if (input.altKey) return null;
  if (!input.ctrlKey && !input.metaKey) return null;
  if (input.key === "ArrowUp") return input.shiftKey ? "front" : "forward";
  if (input.key === "ArrowDown") return input.shiftKey ? "back" : "backward";
  return null;
}

/** Annonce vocale d'un changement d'ordre (sujet « Élément », donc accord sûr). */
export function zOrderAnnouncement(move: ZMove, label: string): string {
  const action: Record<ZMove, string> = {
    front: "placé au premier plan",
    forward: "avancé d'un plan",
    backward: "reculé d'un plan",
    back: "placé à l'arrière-plan",
  };
  return `Élément « ${label} » ${action[move]}.`;
}
