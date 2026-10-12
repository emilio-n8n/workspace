/**
 * Analyseur CSV RFC 4180, pur et testable (aucune dépendance DOM ni base).
 * Gère les champs cités (`""` échappé), les virgules et retours à la ligne
 * cités, les fins de ligne CRLF, le BOM UTF-8 et une fin de fichier sans
 * saut de ligne. Les limites reprennent celles de la feuille.
 */

/** Nombre maximal de lignes importables (aligné sur la grille). */
export const MAX_ROWS = 1000;
/** Nombre maximal de colonnes importables (aligné sur la grille). */
export const MAX_COLS = 100;
/** Taille maximale d'une cellule en caractères. */
export const MAX_CELL_CHARS = 1000;

export type CsvLimits = { maxRows?: number; maxCols?: number };

/**
 * Découpe un texte CSV en lignes de cellules.
 *
 * - une ligne vide en fin de fichier (`\n` final, CRLF compris) est ignorée ;
 * - au-delà de `maxRows` lignes ou `maxCols` colonnes, le surplus est ignoré ;
 * - une cellule dépasse `MAX_CELL_CHARS` caractères → `Error` (remontée au UI) ;
 * - `""` → `[]`.
 *
 * La validation de longueur s'applique après découpe aux limites : une cellule
 * hors colonnes est ignorée avant d'être contrôlée.
 */
export function parseCsv(text: string, limits?: CsvLimits): string[][] {
  const maxRows = limits?.maxRows ?? MAX_ROWS;
  const maxCols = limits?.maxCols ?? MAX_COLS;

  let source = text;
  if (source.startsWith("\uFEFF")) source = source.slice(1);

  const rows: string[][] = [];
  // Masque un saut de ligne final (LF ou CRLF) : le fichier se termine par une
  // ligne vide implicite, jamais par une cellule vide supplémentaire.
  const effective = source.endsWith("\n")
    ? source.slice(0, source.endsWith("\r\n") ? -2 : -1)
    : source;
  if (effective === "") return [];

  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  while (index < effective.length) {
    const char = effective[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (effective[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" && effective[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 2;
      continue;
    }
    field += char;
    index += 1;
  }

  // Dernière ligne partielle : conservée seulement si elle porte du contenu.
  if (row.length > 0 || field !== "") {
    row.push(field);
    rows.push(row);
  }

  const limited = rows.slice(0, maxRows);
  const parsed: string[][] = [];
  for (const current of limited) {
    const cells = current.slice(0, maxCols);
    for (const cell of cells) {
      if (cell.length > MAX_CELL_CHARS) {
        throw new Error(`Cellule trop longue (${MAX_CELL_CHARS} caractères maximum).`);
      }
    }
    parsed.push(cells);
  }
  return parsed;
}
