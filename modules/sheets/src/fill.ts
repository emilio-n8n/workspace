import { shiftFormula } from "./formula.ts";
import type { CellRange } from "./range.ts";

/**
 * Poignée de recopie (fill handle) et Ctrl+D / Ctrl+R, comme Excel :
 *
 * - deux nombres ou plus → série linéaire prolongée (1, 2 → 3, 4, 5…) ;
 * - un texte terminé par un nombre → incrémenté (« Lot 1 » → « Lot 2 ») ;
 * - jours et mois (français ou anglais) → suite du calendrier ;
 * - une formule → recopiée avec ses références relatives décalées ;
 * - tout le reste → recopié en boucle.
 *
 * Logique pure : la grille, Ctrl+D et les tests partagent la même fonction.
 * Les cellules sont adressées « ligne:colonne » (0-indexées), comme l'éditeur.
 */

export type FillDirection = "down" | "up" | "right" | "left";

export type FillUpdate = { row: number; col: number; value: string };

const DAY_LISTS: readonly (readonly string[])[] = [
  ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."],
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
];

const MONTH_LISTS: readonly (readonly string[])[] = [
  [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],
];

const CALENDAR_LISTS = [...DAY_LISTS, ...MONTH_LISTS];

function numberOf(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Reprend la casse d'un modèle (« Lundi » → « Mardi », « LUNDI » → « MARDI »). */
function withCase(model: string, value: string): string {
  if (model === model.toUpperCase() && model !== model.toLowerCase()) return value.toUpperCase();
  if (model[0] && model[0] === model[0].toUpperCase()) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

/** Arrondi d'affichage d'une série (évite 0,30000000000000004). */
function clean(value: number): string {
  return String(Number(value.toPrecision(15)));
}

/**
 * Valeurs de la série prolongée à partir de `source` (dans l'ordre de la
 * recopie), pour `count` cellules supplémentaires. `step` donne le décalage
 * (lignes, colonnes) entre deux cellules consécutives, pour les formules.
 */
export function extendSeries(
  source: readonly string[],
  count: number,
  step: { row: number; col: number },
): string[] {
  const output: string[] = [];
  if (source.length === 0 || count <= 0) return output;

  // Série numérique : au moins deux nombres, pas constant ou non.
  const numbers = source.map(numberOf);
  if (source.length >= 2 && numbers.every((value) => value !== null)) {
    const values = numbers as number[];
    const n = values.length;
    // Tendance linéaire (moindres carrés), comme Excel pour plus de deux valeurs.
    const meanX = (n - 1) / 2;
    const meanY = values.reduce((total, value) => total + value, 0) / n;
    let numerator = 0;
    let denominator = 0;
    values.forEach((value, index) => {
      numerator += (index - meanX) * (value - meanY);
      denominator += (index - meanX) ** 2;
    });
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;
    for (let index = 0; index < count; index += 1) {
      output.push(clean(intercept + slope * (n + index)));
    }
    return output;
  }

  // Jours et mois : un seul modèle suffit.
  const last = source[source.length - 1] ?? "";
  for (const list of CALENDAR_LISTS) {
    const position = list.indexOf(last.trim().toLowerCase());
    if (position >= 0 && source.every((value) => list.includes(value.trim().toLowerCase()))) {
      for (let index = 1; index <= count; index += 1) {
        output.push(withCase(last.trim(), list[(position + index) % list.length] ?? ""));
      }
      return output;
    }
  }

  // Texte terminé par un nombre (une seule cellule source) : incrément.
  if (source.length === 1) {
    const match = /^(.*?)(\d+)$/.exec(last);
    if (match && !last.startsWith("=") && numberOf(last) === null) {
      const [, prefix = "", digits = ""] = match;
      const start = Number(digits);
      for (let index = 1; index <= count; index += 1) {
        output.push(`${prefix}${String(start + index).padStart(digits.length, "0")}`);
      }
      return output;
    }
  }

  // Recopie en boucle ; une formule voit ses références relatives décalées.
  for (let index = 0; index < count; index += 1) {
    const offset = source.length + index;
    const model = source[offset % source.length] ?? "";
    const cycles = Math.floor(offset / source.length);
    const distance = cycles * source.length;
    output.push(
      model.startsWith("=") ? shiftFormula(model, step.row * distance, step.col * distance) : model,
    );
  }
  return output;
}

/**
 * Mises à jour d'une recopie de `source` jusqu'à couvrir `target` (qui
 * contient `source` et le prolonge dans une seule direction).
 */
export function fillRange(
  source: CellRange,
  target: CellRange,
  values: ReadonlyMap<string, string>,
): FillUpdate[] {
  const direction = fillDirection(source, target);
  if (!direction) return [];
  const updates: FillUpdate[] = [];
  const read = (row: number, col: number) => values.get(`${row}:${col}`) ?? "";

  if (direction === "down" || direction === "up") {
    const count =
      direction === "down" ? target.endRow - source.endRow : source.startRow - target.startRow;
    for (let col = source.startCol; col <= source.endCol; col += 1) {
      const column: string[] = [];
      for (let row = source.startRow; row <= source.endRow; row += 1) column.push(read(row, col));
      if (direction === "up") column.reverse();
      const series = extendSeries(column, count, { row: direction === "down" ? 1 : -1, col: 0 });
      series.forEach((value, index) => {
        const row = direction === "down" ? source.endRow + 1 + index : source.startRow - 1 - index;
        updates.push({ row, col, value });
      });
    }
    return updates;
  }

  const count =
    direction === "right" ? target.endCol - source.endCol : source.startCol - target.startCol;
  for (let row = source.startRow; row <= source.endRow; row += 1) {
    const line: string[] = [];
    for (let col = source.startCol; col <= source.endCol; col += 1) line.push(read(row, col));
    if (direction === "left") line.reverse();
    const series = extendSeries(line, count, { row: 0, col: direction === "right" ? 1 : -1 });
    series.forEach((value, index) => {
      const col = direction === "right" ? source.endCol + 1 + index : source.startCol - 1 - index;
      updates.push({ row, col, value });
    });
  }
  return updates;
}

/** Direction de la recopie, `null` si la cible ne prolonge pas la source. */
export function fillDirection(source: CellRange, target: CellRange): FillDirection | null {
  const sameCols = target.startCol === source.startCol && target.endCol === source.endCol;
  const sameRows = target.startRow === source.startRow && target.endRow === source.endRow;
  if (sameCols && target.startRow === source.startRow && target.endRow > source.endRow)
    return "down";
  if (sameCols && target.endRow === source.endRow && target.startRow < source.startRow) return "up";
  if (sameRows && target.startCol === source.startCol && target.endCol > source.endCol)
    return "right";
  if (sameRows && target.endCol === source.endCol && target.startCol < source.startCol)
    return "left";
  return null;
}

/**
 * Cible d'un glisser de la poignée : la plage source prolongée vers la
 * cellule survolée, dans la direction dominante (lignes ou colonnes).
 */
export function fillTarget(source: CellRange, row: number, col: number): CellRange {
  const below = row - source.endRow;
  const above = source.startRow - row;
  const right = col - source.endCol;
  const left = source.startCol - col;
  const vertical = Math.max(below, above);
  const horizontal = Math.max(right, left);
  if (vertical <= 0 && horizontal <= 0) return source;
  if (vertical >= horizontal) {
    return below > 0 ? { ...source, endRow: row } : { ...source, startRow: row };
  }
  return right > 0 ? { ...source, endCol: col } : { ...source, startCol: col };
}

/**
 * Collage interne : les formules copiées voient leurs références relatives
 * décalées de la distance entre la cellule d'origine et la cellule cible.
 */
export function shiftPasted(
  rows: readonly (readonly string[])[],
  rowDelta: number,
  colDelta: number,
): string[][] {
  return rows.map((line) =>
    line.map((value) => (value.startsWith("=") ? shiftFormula(value, rowDelta, colDelta) : value)),
  );
}
