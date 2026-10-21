/**
 * Filtre automatique (« Filtrer » d'Excel) : logique pure.
 *
 * La première ligne de la plage porte les en-têtes (boutons ▾) ; les lignes
 * suivantes sont masquées quand une colonne au moins les exclut. Les valeurs
 * comparées sont celles **affichées** (formules calculées), comme Excel.
 */
import type { AutoFilter, ColumnFilter, FilterCondition, RangeRef } from "./tab-settings.ts";

/** Lecture de la valeur affichée d'une cellule (texte ; "" si vide). */
export type DisplayReader = (row: number, col: number) => string;

/** Libellé de la valeur vide dans la liste des cases à cocher. */
export const EMPTY_LABEL = "(Vides)";

function asNumber(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/[\u00a0\u202f\s]/g, "")
    .replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(cleaned)) return null;
  const value = Number(cleaned.replace("%", ""));
  return Number.isFinite(value) ? (cleaned.endsWith("%") ? value / 100 : value) : null;
}

/** Vrai quand la valeur passe la condition. */
export function matchesCondition(text: string, condition: FilterCondition): boolean {
  const value = text.trim();
  switch (condition.op) {
    case "empty":
      return value === "";
    case "notEmpty":
      return value !== "";
    case "contains":
      return value.toLocaleLowerCase("fr").includes(condition.value.toLocaleLowerCase("fr"));
    case "notContains":
      return !value.toLocaleLowerCase("fr").includes(condition.value.toLocaleLowerCase("fr"));
    case "equals":
      return value.localeCompare(condition.value, "fr", { sensitivity: "base" }) === 0;
    case "notEquals":
      return value.localeCompare(condition.value, "fr", { sensitivity: "base" }) !== 0;
    default: {
      const number = asNumber(value);
      if (number === null) return false;
      if (condition.op === "gt") return number > condition.value;
      if (condition.op === "gte") return number >= condition.value;
      if (condition.op === "lt") return number < condition.value;
      return number <= condition.value;
    }
  }
}

function passes(text: string, filter: ColumnFilter): boolean {
  const label = text.trim() === "" ? EMPTY_LABEL : text;
  if (filter.hidden?.includes(label)) return false;
  if (filter.condition && !matchesCondition(text, filter.condition)) return false;
  return true;
}

/** Lignes masquées par le filtre (index absolus, en-tête jamais masqué). */
export function hiddenRows(filter: AutoFilter, read: DisplayReader): Set<number> {
  const hidden = new Set<number>();
  const entries = Object.entries(filter.columns).map(
    ([col, criteria]) => [Number(col), criteria] as const,
  );
  if (entries.length === 0) return hidden;
  for (let row = filter.range.startRow + 1; row <= filter.range.endRow; row += 1) {
    for (const [col, criteria] of entries) {
      if (!passes(read(row, col), criteria)) {
        hidden.add(row);
        break;
      }
    }
  }
  return hidden;
}

/**
 * Valeurs distinctes d'une colonne du filtre, triées (nombres d'abord, ordre
 * naturel français), « (Vides) » en dernier.
 */
export function distinctValues(filter: AutoFilter, col: number, read: DisplayReader): string[] {
  const values = new Set<string>();
  let hasEmpty = false;
  for (let row = filter.range.startRow + 1; row <= filter.range.endRow; row += 1) {
    const text = read(row, col);
    if (text.trim() === "") hasEmpty = true;
    else values.add(text);
  }
  const sorted = [...values].sort((a, b) => {
    const na = asNumber(a);
    const nb = asNumber(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
  });
  if (hasEmpty) sorted.push(EMPTY_LABEL);
  return sorted;
}

/**
 * Plage d'un nouveau filtre : la sélection si elle couvre plusieurs lignes,
 * sinon la région de données contiguë autour de la cellule active (comme le
 * bouton Filtrer d'Excel).
 */
export function detectFilterRange(
  selection: RangeRef,
  hasValue: (row: number, col: number) => boolean,
  bounds: { rows: number; cols: number },
): RangeRef {
  if (selection.endRow > selection.startRow) return selection;
  let { startRow, endRow, startCol, endCol } = selection;
  let grew = true;
  while (grew) {
    grew = false;
    const rowHas = (row: number) => {
      for (let col = startCol; col <= endCol; col += 1) if (hasValue(row, col)) return true;
      return false;
    };
    const colHas = (col: number) => {
      for (let row = startRow; row <= endRow; row += 1) if (hasValue(row, col)) return true;
      return false;
    };
    if (startRow > 0 && rowHas(startRow - 1)) {
      startRow -= 1;
      grew = true;
    }
    if (endRow < bounds.rows - 1 && rowHas(endRow + 1)) {
      endRow += 1;
      grew = true;
    }
    if (startCol > 0 && colHas(startCol - 1)) {
      startCol -= 1;
      grew = true;
    }
    if (endCol < bounds.cols - 1 && colHas(endCol + 1)) {
      endCol += 1;
      grew = true;
    }
  }
  return { startRow, endRow, startCol, endCol };
}

/** Vrai quand une colonne a un critère actif (bouton ▾ mis en évidence). */
export function isColumnFiltered(filter: AutoFilter | undefined, col: number): boolean {
  const entry = filter?.columns[String(col)];
  return Boolean(entry && ((entry.hidden?.length ?? 0) > 0 || entry.condition));
}

/** Remplace (ou retire) le critère d'une colonne, sans muter l'entrée. */
export function withColumnFilter(
  filter: AutoFilter,
  col: number,
  criteria: ColumnFilter | null,
): AutoFilter {
  const columns = { ...filter.columns };
  if (!criteria || ((criteria.hidden?.length ?? 0) === 0 && !criteria.condition)) {
    delete columns[String(col)];
  } else {
    columns[String(col)] = criteria;
  }
  return { ...filter, columns };
}

/** Résumé pour la barre d'état (« 12 lignes sur 40 affichées »). */
export function filterSummary(filter: AutoFilter, hidden: Set<number>): string {
  const total = filter.range.endRow - filter.range.startRow;
  const shown = total - hidden.size;
  return `${shown} ligne${shown > 1 ? "s" : ""} sur ${total} affichée${shown > 1 ? "s" : ""}`;
}
