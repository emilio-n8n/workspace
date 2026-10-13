/**
 * Réordonnancement des diapositives et bande de vignettes.
 *
 * Logique pure (aucun accès au DOM) : l'éditeur et les tests s'en servent
 * avec les mêmes règles. Les positions manipulées ici sont des index de
 * tableau ; le glisser-déposer les convertit une seule fois, à la mesure des
 * vignettes.
 */

export type StripOrientation = "horizontal" | "vertical";

/** Place d'une vignette sur l'axe de déplacement (pixels page). */
export type StripItem = { start: number; size: number };

export type FilmstripKeyAction =
  | { kind: "select"; index: number }
  | { kind: "move"; index: number };

/** La diapositive peut-elle être déplacée d'un cran dans cette direction ? */
export function canMoveSlide(index: number, direction: -1 | 1, count: number): boolean {
  if (index < 0 || index >= count) return false;
  const target = index + direction;
  return target >= 0 && target < count;
}

/** Destination d'un déplacement, ou null s'il est impossible. */
export function moveTarget(index: number, direction: -1 | 1, count: number): number | null {
  return canMoveSlide(index, direction, count) ? index + direction : null;
}

/**
 * Déplace l'élément `from` sur `to`. Hors bornes ou déplacement à l'identique :
 * la liste est renvoyée à l'identique (jamais de mutation de l'état appelant).
 */
export function reorderSlides<T>(slides: readonly T[], from: number, to: number): T[] {
  const copy = [...slides];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return copy;
  if (from < 0 || to < 0 || from >= copy.length || to >= copy.length || from === to) return copy;
  const [moved] = copy.splice(from, 1);
  if (moved === undefined) return [...slides];
  copy.splice(to, 0, moved);
  return copy;
}

/**
 * Emplacement d'insertion dans une bande : le pointeur comparé au milieu de
 * chaque vignette, les extrémités attrapant les débordements.
 */
export function insertionIndex(items: readonly StripItem[], pointer: number): number {
  for (const [index, item] of items.entries()) {
    if (pointer < item.start + item.size / 2) return index;
  }
  return items.length;
}

/**
 * Destination du glisser-déposer, exprimée dans la liste SANS la diapositive
 * déplacée : une vignette lâchée sous son voisin du bas se place après lui,
 * au-dessus elle se place avant.
 */
export function dropIndex(input: {
  from: number;
  items: readonly StripItem[];
  pointer: number;
}): number {
  const slot = insertionIndex(input.items, input.pointer);
  return slot <= input.from ? slot : Math.max(0, slot - 1);
}

/**
 * Action d'une touche dans la bande de vignettes. Les flèches, Page préc./suiv.,
 * Départ et Fin déplacent la sélection ; avec Alt, les flèches réordonnent.
 */
export function filmstripKeyAction(input: {
  key: string;
  altKey?: boolean;
  current: number;
  count: number;
}): FilmstripKeyAction | null {
  const { key, current, count } = input;
  if (count <= 0 || current < 0 || current >= count) return null;

  if (input.altKey) {
    if (key === "ArrowUp" || key === "ArrowLeft") {
      const target = moveTarget(current, -1, count);
      return target === null ? null : { kind: "move", index: target };
    }
    if (key === "ArrowDown" || key === "ArrowRight") {
      const target = moveTarget(current, 1, count);
      return target === null ? null : { kind: "move", index: target };
    }
    return null;
  }

  let target: number | null = null;
  if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp") {
    target = moveTarget(current, -1, count);
  } else if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown") {
    target = moveTarget(current, 1, count);
  } else if (key === "Home") target = 0;
  else if (key === "End") target = count - 1;

  if (target === null || target === current) return null;
  return { kind: "select", index: target };
}

/** Libellé accessible d'une vignette (position, titre, contenu, notes). */
export function filmstripOptionLabel(input: {
  index: number;
  count: number;
  title: string | null | undefined;
  elementCount: number;
  hasNotes: boolean;
}): string {
  const number = input.index + 1;
  const name = (input.title ?? "").trim() || `Diapositive ${number}`;
  const elements = `${input.elementCount} élément${input.elementCount > 1 ? "s" : ""}`;
  const notes = input.hasNotes ? ", notes du présentateur" : "";
  return `Diapositive ${number} sur ${input.count} : ${name} — ${elements}${notes}`;
}

/** Annonce vocale d'un réordonnancement abouti. */
export function reorderAnnouncement(from: number, to: number): string {
  return `Diapositive ${from + 1} déplacée en position ${to + 1}.`;
}
