/**
 * Navigation au clavier dans la liste d'éléments.
 *
 * Fonctions pures (test/grid-nav.test.ts) : le tableau se contente d'appliquer
 * l'action retournée et de placer le focus.
 *
 * Modèle : une ligne = une unité focalisable (`tabindex` mobile). Les flèches
 * haut/bas déplacent le curseur, droite ouvre l'élément, gauche remonte au
 * dossier parent, Espace bascule la sélection.
 */

/** Touches reconnues par la liste. */
export const GRID_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;

/** Nombre de lignes sautées par Page haut / Page bas. */
export const GRID_PAGE_SIZE = 10;

/** Action demandée par une touche. */
export type GridAction =
  /** Déplacer le curseur sur une autre ligne. */
  | { kind: "move"; index: number }
  /** Ouvrir la ligne courante (Entrée ou flèche droite). */
  | { kind: "open" }
  /** Basculer la sélection de la ligne courante (Espace). */
  | { kind: "toggle" }
  /** Remonter au dossier parent (flèche gauche). */
  | { kind: "parent" };

/** Borne un index dans les lignes visibles ; `null` reste `null`. */
export function clampCursor(index: number | null, rowCount: number): number | null {
  if (index === null || rowCount <= 0) return null;
  return Math.min(Math.max(index, 0), rowCount - 1);
}

/**
 * Traduit une touche en action. `currentIndex` est la ligne focalisée
 * (`null` si aucune) ; `rowCount` le nombre de lignes visibles.
 *
 * Sans curseur, la première touche de déplacement pose le curseur sur la
 * première (ou la dernière) ligne plutôt que de ne rien faire.
 */
export function gridActionForKey(
  key: string,
  currentIndex: number | null,
  rowCount: number,
): GridAction | null {
  if (rowCount <= 0) return null;

  switch (key) {
    case "ArrowDown":
      return {
        kind: "move",
        index: currentIndex === null ? 0 : Math.min(currentIndex + 1, rowCount - 1),
      };
    case "ArrowUp":
      return {
        kind: "move",
        index: currentIndex === null ? rowCount - 1 : Math.max(currentIndex - 1, 0),
      };
    case "ArrowRight":
      return currentIndex === null ? null : { kind: "open" };
    case "ArrowLeft":
      return currentIndex === null ? null : { kind: "parent" };
    case "Enter":
      return currentIndex === null ? null : { kind: "open" };
    // `" "` dans les navigateurs récents, `"Spacebar"` dans les anciens.
    case " ":
    case "Spacebar":
      return currentIndex === null ? null : { kind: "toggle" };
    case "Home":
      return { kind: "move", index: 0 };
    case "End":
      return { kind: "move", index: rowCount - 1 };
    case "PageDown":
      return {
        kind: "move",
        index: currentIndex === null ? 0 : Math.min(currentIndex + GRID_PAGE_SIZE, rowCount - 1),
      };
    case "PageUp":
      return {
        kind: "move",
        index: currentIndex === null ? rowCount - 1 : Math.max(currentIndex - GRID_PAGE_SIZE, 0),
      };
    default:
      return null;
  }
}

/** Champs nécessaires pour annoncer la position du curseur. */
export type CursorTarget = {
  name: string;
  kind: "folder" | "file";
  selected: boolean;
};

/**
 * Message de la région « aria-live » à chaque déplacement : la position dans la
 * liste, le nom, le type et l'état de sélection — ce qu'un lecteur d'écran ne
 * peut pas déduire d'un `role="grid"` quand les lignes sont rendues par lot.
 */
export function cursorAnnouncement(
  target: CursorTarget | null,
  index: number,
  rowCount: number,
): string {
  if (target === null || rowCount <= 0) return "";
  const position = `Élément ${index + 1} sur ${rowCount}`;
  const type = target.kind === "folder" ? "Dossier" : "Fichier";
  return `${position} : ${type} ${target.name}${target.selected ? ", sélectionné" : ""}`;
}

/**
 * Région d'annonce de la liste : le nombre d'éléments et le tri en cours, lus
 * quand le contenu change sans que le focus ait bougé.
 */
export function listAnnouncement(rowCount: number, sortLabel: string): string {
  if (rowCount <= 0) return "Aucun élément à parcourir.";
  const count = rowCount === 1 ? "1 élément" : `${rowCount} éléments`;
  return `${count} à parcourir, triés par ${sortLabel}.`;
}
