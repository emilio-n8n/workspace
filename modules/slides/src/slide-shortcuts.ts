/**
 * Raccourcis clavier de l'éditeur, comme PowerPoint pour le web :
 * Ctrl+D duplique (la sélection, ou la diapositive sans sélection), Ctrl+M
 * insère une nouvelle diapositive, les flèches déplacent la sélection d'un
 * pas (1 %, 5 % avec Maj, 0,1 % avec Alt pour l'ajustement fin).
 *
 * Logique pure : l'éditeur lit l'action et l'exécute.
 */

export type ShortcutKeys = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export type EditorShortcut =
  | { kind: "duplicate-selection" }
  | { kind: "duplicate-slide" }
  | { kind: "new-slide" }
  | { kind: "nudge"; dx: number; dy: number };

/** Pas de déplacement (en % de la diapositive) selon les modificateurs. */
export function nudgeStep(keys: Pick<ShortcutKeys, "shiftKey" | "altKey">): number {
  if (keys.altKey) return 0.1;
  return keys.shiftKey ? 5 : 1;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Action d'un raccourci, ou `null` quand la touche ne concerne pas l'éditeur.
 * `hasSelection` : au moins un élément sélectionné sur la diapositive.
 */
export function editorShortcut(keys: ShortcutKeys, hasSelection: boolean): EditorShortcut | null {
  const mod = keys.ctrlKey || keys.metaKey;
  const key = keys.key.toLowerCase();
  if (mod && !keys.altKey && !keys.shiftKey && key === "d") {
    return hasSelection ? { kind: "duplicate-selection" } : { kind: "duplicate-slide" };
  }
  if (mod && !keys.altKey && !keys.shiftKey && key === "m") return { kind: "new-slide" };
  const arrow = ARROWS[keys.key];
  // Ctrl + flèche est réservé à l'ordre z (avant-plan / arrière-plan).
  if (arrow && hasSelection && !mod) {
    const step = nudgeStep(keys);
    return { kind: "nudge", dx: arrow[0] * step, dy: arrow[1] * step };
  }
  return null;
}
