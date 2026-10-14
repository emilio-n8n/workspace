/**
 * Sélection de plage et presse-papiers TSV.
 *
 * Logique pure (aucune dépendance) : la géométrie de la sélection, la
 * sérialisation et la relecture du TSV sont testées sans navigateur. Seul le
 * dialogue avec le presse-papiers du système vit dans l'interface.
 */

export type CellAddress = { row: number; col: number };

/** Plage normalisée (bornes ordonnées), inclusive. */
export type CellRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

/** Nombre maximal de cellules copiées d'un coup (garde-fou mémoire). */
export const MAX_CLIPBOARD_CELLS = 5_000;
/** Nombre maximal de lignes ou de colonnes collées d'un coup. */
export const MAX_PASTE_COLUMNS = 100;
export const MAX_PASTE_ROWS = 1_000;

/** Normalise deux cellules en plage : l'ordre n'importe pas. */
export function rangeFrom(anchor: CellAddress, focus: CellAddress): CellRange {
  return {
    startRow: Math.min(anchor.row, focus.row),
    startCol: Math.min(anchor.col, focus.col),
    endRow: Math.max(anchor.row, focus.row),
    endCol: Math.max(anchor.col, focus.col),
  };
}

/** Une sélection simple (une cellule) est une plage d'un seul élément. */
export function singleRange(cell: CellAddress): CellRange {
  return rangeFrom(cell, cell);
}

/** La plage ne contient qu'une cellule. */
export function isSingleCell(range: CellRange): boolean {
  return range.startRow === range.endRow && range.startCol === range.endCol;
}

/** Nombre de cellules de la plage (borne haute comprise). */
export function rangeCellCount(range: CellRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

/** Vrai si la cellule est dans la plage. */
export function inRange(range: CellRange, row: number, col: number): boolean {
  return (
    row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
  );
}

/** Adresses de la plage, ligne par ligne puis colonne par colonne. */
export function rangeAddresses(range: CellRange): CellAddress[] {
  const addresses: CellAddress[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      addresses.push({ row, col });
    }
  }
  return addresses;
}

/**
 * Étend la sélection avec Maj + flèche : la plage garde son point d'ancrage et
 * seule la cellule active avance. Sans ancrage, on part de la cellule active.
 */
export function extendSelection(
  anchor: CellAddress,
  focus: CellAddress,
  delta: { dRow: number; dCol: number },
  bounds: { rows: number; cols: number },
): { anchor: CellAddress; focus: CellAddress } {
  const next = {
    row: Math.max(0, Math.min(bounds.rows - 1, focus.row + delta.dRow)),
    col: Math.max(0, Math.min(bounds.cols - 1, focus.col + delta.dCol)),
  };
  return { anchor, focus: next };
}

/** Libellé de la plage sélectionnée (« A1:B3 », « A1 »). */
export function rangeLabel(range: CellRange, letter: (col: number) => string): string {
  const first = `${letter(range.startCol)}${range.startRow + 1}`;
  if (isSingleCell(range)) return first;
  return `${first}:${letter(range.endCol)}${range.endRow + 1}`;
}

// ---------------------------------------------------------------------------
// Sérialisation TSV (copie) et relecture (collage)
// ---------------------------------------------------------------------------

/**
 * Neutralise l'injection de formule dans une cellule copiée (même règle que
 * l'export CSV) puis place la valeur en champ TSV : un caractère de tabulation
 * ou de saut de ligne à l'intérieur d'une valeur casserait la grille.
 */
export function tsvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return neutralized.replaceAll("\t", " ").replaceAll("\r\n", " ").replaceAll("\n", " ");
}

/**
 * Sérialise une matrice de valeurs en TSV : une ligne par ligne de la plage,
 * une colonne par tabulation, pas de guillemets (les valeurs plates n'en
 * ont pas besoin) et pas de saut de ligne final.
 */
export function serializeTsv(rows: string[][], limits?: { maxCells: number }): string {
  const max = limits?.maxCells ?? MAX_CLIPBOARD_CELLS;
  const lines: string[] = [];
  let count = 0;
  for (const row of rows) {
    lines.push(row.map(tsvCell).join("\t"));
    count += row.length;
    if (count > max) break;
  }
  return lines.join("\n");
}

/**
 * Relit un TSV en matrice : lignes vides ignorées (une ligne de fin copiée
 * depuis un tableur ne doit pas ajouter de ligne vide), tailles bornées.
 */
export function parseTsv(text: string): string[][] {
  if (text.length === 0) return [];
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return normalized
    .split("\n")
    .filter((line) => line.length > 0)
    .slice(0, MAX_PASTE_ROWS)
    .map((line) =>
      line
        .split("\t")
        .slice(0, MAX_PASTE_COLUMNS)
        .map((cell) => cell.trim()),
    );
}

/**
 * Positionne un collage à partir de la cellule active : les cellules qui
 * dépasseraient la grille sont ignorées (jamais d'écriture hors limites) et le
 * nombre de cellules effectivement écrites est renvoyé.
 */
export function pasteTargets(
  values: string[][],
  origin: CellAddress,
  bounds: { rows: number; cols: number },
): { row: number; col: number; value: string }[] {
  const targets: { row: number; col: number; value: string }[] = [];
  values.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => {
      const row2 = origin.row + rowOffset;
      const col = origin.col + colOffset;
      if (row2 >= bounds.rows || col >= bounds.cols) return;
      targets.push({ row: row2, col, value });
    });
  });
  return targets;
}

/** Message d'erreur français d'une opération de presse-papiers. */
export function clipboardError(kind: "copy" | "paste", reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : "";
  const base =
    kind === "copy"
      ? "Copie impossible : le navigateur a refusé l'accès au presse-papiers."
      : "Collage impossible : le navigateur a refusé l'accès au presse-papiers.";
  return detail.length > 0 ? `${base} (${detail})` : base;
}

/** Nombre de cellules effectivement collées, pour l'annonce faite à l'utilisateur. */
export function pasteSummary(count: number): string {
  return `${count} cellule${count > 1 ? "s" : ""} collée${count > 1 ? "s" : ""}.`;
}

/** Nombre de cellules copiées, pour l'annonce. */
export function copySummary(count: number): string {
  return `${count} cellule${count > 1 ? "s" : ""} copiée${count > 1 ? "s" : ""}.`;
}
