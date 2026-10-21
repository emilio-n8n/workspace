/**
 * Tri d'une plage de cellules (croissant / décroissant).
 *
 * Règle retenue, celle d'un tableur classique : le tri porte sur **une
 * colonne** de la plage, mais les lignes entières se déplacent ensemble — sinon
 * chaque colonne serait triée séparément et les données mélangées. Les valeurs
 * numériques sont comparées comme des nombres, le reste comme du texte, avec la
 * comparaison naturelle française (« 2 » avant « 10 », accents gérés).
 *
 * Logique pure : le service n'a qu'à écrire les cellules renvoyées.
 */

export type SortDirection = "asc" | "desc";

/** Sens du tri, libellés français inclus. */
export const SORT_DIRECTIONS: Record<SortDirection, string> = {
  asc: "Tri croissant",
  desc: "Tri décroissant",
};

export type SortBounds = { rows: number; cols: number };
export type SortCell = { row: number; col: number };
export type SortRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

/**
 * Compare deux valeurs : nombres d'abord, texte ensuite. Les cellules vides
 * vont toujours à la fin, quel que soit le sens du tri (une donnée absente ne
 * doit pas passer devant une donnée réelle).
 */
export function compareCells(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (left === "" || right === "") {
    if (left === right) return 0;
    return left === "" ? 1 : -1;
  }
  const na = Number(left);
  const nb = Number(right);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  return left.localeCompare(right, "fr", { numeric: true, sensitivity: "base" });
}

/**
 * Ordre effectif d'une comparaison. Les cellules vides restent **toujours en
 * dernier**, y compris en tri décroissant : un tri inversé ne doit pas faire
 * remonter les lignes vides au-dessus des données.
 */
function ordered(a: string, b: string, direction: SortDirection): number {
  const leftEmpty = a.trim() === "";
  const rightEmpty = b.trim() === "";
  if (leftEmpty || rightEmpty) {
    if (leftEmpty === rightEmpty) return 0;
    return leftEmpty ? 1 : -1;
  }
  const compared = compareCells(a, b);
  return direction === "asc" ? compared : -compared;
}

export type SortInput = {
  /** Plage triée (bornes incluses, normalisées). */
  range: SortRange;
  /** Colonne de tri, exprimée en colonne de la grille (0-indexée). */
  column: number;
  direction: SortDirection;
  /** Cellules de l'onglet : clé `${row}:${col}` → valeur brute. */
  values: Map<string, string>;
  /** Bornes de la grille (sécurité : on récrit dans les limites). */
  bounds: SortBounds;
};

export type SortResult = {
  /** Cellules à écrire (les valeurs qui ont effectivement changé). */
  updates: { row: number; col: number; value: string }[];
  /** Nombre de lignes déplacées. */
  moved: number;
  /** Vrai quand l'ordre a changé. */
  changed: boolean;
};

/** Lit une valeur de la carte, cellule absente = chaîne vide. */
function read(values: Map<string, string>, row: number, col: number): string {
  return values.get(`${row}:${col}`) ?? "";
}

/**
 * Trie les lignes de la plage selon la colonne demandée.
 *
 * Le tri est **stable** (index d'origine en cas d'égalité), la plage est
 * bornée par la grille, et seules les cellules dont la valeur change sont
 * renvoyées — l'appelant écrit une mise à jour creuse, comme l'autosave.
 */
export function sortRange(input: SortInput): SortResult {
  const { range, column, direction, values, bounds } = input;

  const startRow = Math.max(0, Math.min(range.startRow, bounds.rows - 1));
  const endRow = Math.max(startRow, Math.min(range.endRow, bounds.rows - 1));
  const startCol = Math.max(0, Math.min(range.startCol, bounds.cols - 1));
  const endCol = Math.max(startCol, Math.min(range.endCol, bounds.cols - 1));
  // La colonne de tri doit appartenir à la plage : sans cela, trier une plage
  // déplacerait des lignes dont la clé n'est pas sous les yeux de l'utilisateur.
  if (column < startCol || column > endCol) {
    return { updates: [], moved: 0, changed: false };
  }

  const lines: number[] = [];
  for (let row = startRow; row <= endRow; row += 1) lines.push(row);

  // Tri stable : l'index d'origine départage les valeurs égales.
  const sorted = [...lines].sort((a, b) => {
    const compared = ordered(read(values, a, column), read(values, b, column), direction);
    return compared !== 0 ? compared : a - b;
  });

  const updates: { row: number; col: number; value: string }[] = [];
  let moved = 0;
  sorted.forEach((sourceRow, index) => {
    // Ligne de destination absolue (la plage ne commence pas forcément en 1).
    const targetRow = startRow + index;
    if (sourceRow !== targetRow) moved += 1;
    for (let col = startCol; col <= endCol; col += 1) {
      const next = read(values, sourceRow, col);
      if (read(values, targetRow, col) === next) continue;
      updates.push({ row: targetRow, col, value: next });
    }
  });

  return { updates, moved, changed: updates.length > 0 };
}

/** Message d'annonce après un tri. */
export function sortSummary(moved: number, direction: SortDirection): string {
  const plural = moved > 1 ? "s" : "";
  return `${SORT_DIRECTIONS[direction]} : ${moved} ligne${plural} déplacée${plural}.`;
}

/** Résumé de la plage triée (« A1:B5 — 5 lignes »). */
export function sortScopeLabel(range: SortRange, letter: (col: number) => string): string {
  const label = `${letter(range.startCol)}${range.startRow + 1}:${letter(range.endCol)}${range.endRow + 1}`;
  return `${label} — ${range.endRow - range.startRow + 1} lignes`;
}
