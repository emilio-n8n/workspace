/**
 * Moteur de formules minimal, pur et testable (aucune dépendance DOM).
 * Couvre : littéraux (nombres, notation scientifique, chaînes), références A1,
 * plages A1:B2, opérateurs + - * / ( ), parenthèses et agrégats
 * SUM, AVG, MIN, MAX, COUNT.
 * Les cellules stockent la valeur brute ; le calcul est toujours à la demande.
 *
 * Sémantique :
 * - une cellule vide vaut 0 en arithmétique ; une cellule texte → #ERREUR ;
 * - une cellule vide est ignorée par les agrégats (SUM/AVG/MIN/MAX/COUNT) ;
 * - AVG sans valeur numérique → #DIV/0 ; MIN/MAX sans valeur → 0 ;
 * - COUNT compte les arguments numériques et les cellules numériques ;
 * - un résultat non fini qui ne vient pas d'une division par zéro → #NUM!.
 */

export type CellValue =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "error"; code: string };

export type CellMap = Record<string, string>;

/** Index de colonne maximal accepté (AAA, 0-indexé) — borne le coût de cellKey(). */
const MAX_COL_INDEX = 702;
/** Index de ligne maximal accepté (1 000 000 de lignes). */
const MAX_ROW_INDEX = 999_999;
/** Nombre maximal de cellules balayées par une plage (protection anti-DoS). */
const MAX_RANGE_CELLS = 10_000;
/**
 * Profondeur maximale d'évaluation croisée entre cellules.
 * Volontairement sous la limite de pile du moteur JS (~4 000 évaluations
 * imbriquées) : au-delà, la formule renvoie #ERREUR au lieu de déborder.
 */
const MAX_EVAL_DEPTH = 1_000;

/**
 * Erreur de formule : `code` est la valeur affichée dans la cellule
 * (#ERREUR, #DIV/0, #NUM!…), `message` documente la cause en français.
 */
class FormulaError extends Error {
  readonly code: string;
  constructor(code: string, message: string = code) {
    super(message);
    this.name = "FormulaError";
    this.code = code;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof FormulaError) return error.code;
  if (error instanceof Error && error.message.startsWith("#")) return error.message;
  return "#ERREUR";
}

/** Convertit (ligne, colonne) 0-indexées en référence « A1 ». */
export function cellKey(row: number, col: number): string {
  let letters = "";
  let n = col + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

/**
 * Convertit une référence « A1 » en (ligne, colonne) 0-indexées.
 * Rejette les références hors bornes (plus de 702 colonnes, plus d'un million
 * de lignes) : sans cela, une colonne de 300 lettres produit `Infinity` et
 * `cellKey()` boucle indéfiniment.
 */
export function parseKey(key: string): { row: number; col: number } | null {
  const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(key.toUpperCase()) ?? [];
  if (!letters || !digits) return null;
  let column = 0;
  for (const char of letters) {
    column = column * 26 + (char.charCodeAt(0) - 64);
  }
  const col = column - 1;
  const row = Number(digits) - 1;
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  if (col < 0 || col > MAX_COL_INDEX || row < 0 || row > MAX_ROW_INDEX) return null;
  return { row, col };
}

/** Formate une valeur avec 15 chiffres significatifs (précision d'un flottant sûr). */
export function formatValue(value: CellValue): string {
  if (value.kind === "text") return value.value;
  if (value.kind === "error") return value.code;
  return Number(value.value.toPrecision(15)).toString();
}

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "ident"; value: string }
  | { type: "punct"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
      let literal = "";
      while (index < source.length && /[0-9.]/.test(source[index] ?? "")) {
        literal += source[index];
        index += 1;
      }
      // Notation scientifique : « 2e3 » = 2000 (l'exposant suit immédiatement le littéral).
      const exponent = source[index];
      if (exponent === "e" || exponent === "E") {
        const sign = source[index + 1];
        const digit = sign === "+" || sign === "-" ? source[index + 2] : sign;
        if (digit !== undefined && /[0-9]/.test(digit)) {
          literal += exponent;
          index += 1;
          if (sign === "+" || sign === "-") {
            literal += sign;
            index += 1;
          }
          while (index < source.length && /[0-9]/.test(source[index] ?? "")) {
            literal += source[index];
            index += 1;
          }
        }
      }
      const value = Number(literal);
      if (Number.isNaN(value)) throw new FormulaError("#ERREUR", "Nombre invalide.");
      tokens.push({ type: "number", value });
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      let ident = "";
      while (index < source.length && /[A-Za-z0-9]/.test(source[index] ?? "")) {
        ident += source[index];
        index += 1;
      }
      tokens.push({ type: "ident", value: ident.toUpperCase() });
      continue;
    }
    if (char === '"') {
      index += 1;
      let text = "";
      while (index < source.length && source[index] !== '"') {
        text += source[index];
        index += 1;
      }
      if (source[index] !== '"') throw new FormulaError("#ERREUR", "Chaîne non fermée.");
      index += 1;
      tokens.push({ type: "string", value: text });
      continue;
    }
    if ("+-*/():,".includes(char)) {
      tokens.push({ type: "punct", value: char });
      index += 1;
      continue;
    }
    throw new FormulaError("#ERREUR", `Caractère invalide : ${char}.`);
  }
  return tokens;
}

type Evaluate = (key: string) => CellValue;

const AGGREGATES = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT"]);

class Parser {
  private position = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly evaluate: Evaluate,
  ) {}

  parse(): number {
    const value = this.expression();
    if (this.position !== this.tokens.length) {
      throw new FormulaError("#ERREUR", "Formule incomplète.");
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private consume(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new FormulaError("#ERREUR", "Formule incomplète.");
    this.position += 1;
    return token;
  }

  private matchPunct(value: string): boolean {
    const token = this.peek();
    if (token?.type === "punct" && token.value === value) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.type === "punct" && (token.value === "+" || token.value === "-")) {
        this.position += 1;
        const right = this.term();
        value = token.value === "+" ? value + right : value - right;
        continue;
      }
      return value;
    }
  }

  private term(): number {
    let value = this.scalar();
    for (;;) {
      const token = this.peek();
      if (token?.type === "punct" && (token.value === "*" || token.value === "/")) {
        this.position += 1;
        const right = this.scalar();
        if (token.value === "*") {
          value *= right;
        } else {
          if (right === 0) throw new FormulaError("#DIV/0", "Division par zéro.");
          value /= right;
        }
        continue;
      }
      return value;
    }
  }

  private scalar(): number {
    const token = this.consume();
    if (token.type === "number") return token.value;
    if (token.type === "string") {
      throw new FormulaError("#ERREUR", "Texte utilisé dans une opération arithmétique.");
    }
    if (token.type === "punct" && token.value === "-") return -this.scalar();
    if (token.type === "punct" && token.value === "+") return this.scalar();
    if (token.type === "punct" && token.value === "(") {
      const value = this.expression();
      if (!this.matchPunct(")")) {
        throw new FormulaError("#ERREUR", "Parenthèse fermante manquante.");
      }
      return value;
    }
    if (token.type === "ident") {
      if (this.matchPunct("(")) return this.functionCall(token.value);
      return this.cellNumber(token.value);
    }
    throw new FormulaError("#ERREUR", "Jeton inattendu.");
  }

  /** Valeur numérique d'une référence nue (cellule vide = 0, texte = #ERREUR). */
  private cellNumber(key: string): number {
    const value = this.evaluate(key);
    if (value.kind === "error") throw new FormulaError(value.code, `Cellule ${key} en erreur.`);
    if (value.kind === "number") return value.value;
    if (value.value === "") return 0;
    throw new FormulaError("#ERREUR", `Cellule ${key} contient du texte.`);
  }

  /** Valeurs numériques d'une plage A1:B2 (texte ignoré, erreurs propagées). */
  private rangeNumbers(startKey: string, endKey: string): number[] {
    const start = parseKey(startKey);
    const end = parseKey(endKey);
    if (!start || !end) throw new FormulaError("#ERREUR", "Référence de plage invalide.");
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    if ((maxRow - minRow + 1) * (maxCol - minCol + 1) > MAX_RANGE_CELLS) {
      throw new FormulaError("#ERREUR", "plage trop grande");
    }
    const numbers: number[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const value = this.evaluate(cellKey(row, col));
        if (value.kind === "error") {
          throw new FormulaError(value.code, "Erreur dans la plage.");
        }
        if (value.kind === "number") numbers.push(value.value);
      }
    }
    return numbers;
  }

  /**
   * Un argument d'agrégat : plage ident:ident, référence de cellule nue, ou
   * expression complète (littéral, appel imbriqué, arithmétique). Une référence
   * nue conserve la sémantique « cellule » : le texte n'est jamais compté.
   */
  private argument(): number[] {
    const token = this.peek();
    const next = this.tokens[this.position + 1];
    if (token?.type === "ident" && next?.type === "punct" && next.value === ":") {
      this.position += 2;
      const end = this.consume();
      if (end.type !== "ident") throw new FormulaError("#ERREUR", "Référence de plage invalide.");
      return this.rangeNumbers(token.value, end.value);
    }
    if (
      token?.type === "ident" &&
      next?.type === "punct" &&
      (next.value === "," || next.value === ")")
    ) {
      this.position += 1;
      const value = this.evaluate(token.value);
      if (value.kind === "error") {
        throw new FormulaError(value.code, `Cellule ${token.value} en erreur.`);
      }
      return value.kind === "number" ? [value.value] : [];
    }
    return [this.expression()];
  }

  private functionCall(name: string): number {
    if (!AGGREGATES.has(name)) throw new FormulaError("#ERREUR", `Fonction inconnue : ${name}.`);
    const collected: number[] = [];
    if (!this.matchPunct(")")) {
      for (;;) {
        collected.push(...this.argument());
        if (this.matchPunct(",")) continue;
        if (this.matchPunct(")")) break;
        throw new FormulaError("#ERREUR", `Arguments invalides pour ${name}.`);
      }
    }
    switch (name) {
      case "SUM":
        return collected.reduce((total, value) => total + value, 0);
      case "AVG":
        if (collected.length === 0) {
          throw new FormulaError("#DIV/0", "AVG sans valeur numérique.");
        }
        return collected.reduce((total, value) => total + value, 0) / collected.length;
      case "MIN":
        return collected.length > 0 ? Math.min(...collected) : 0;
      case "MAX":
        return collected.length > 0 ? Math.max(...collected) : 0;
      case "COUNT":
        return collected.length;
      default:
        throw new FormulaError("#ERREUR", `Fonction inconnue : ${name}.`);
    }
  }
}

/**
 * Évalue toutes les cellules : `Map` référence → valeur calculée.
 * Détecte les cycles (#CYCLE), la division par zéro (#DIV/0), les débordements
 * (#NUM!), les plages abusives (#ERREUR) et les erreurs de syntaxe (#ERREUR).
 */
export function evaluateCells(cells: CellMap): Map<string, CellValue> {
  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();
  let depth = 0;

  const evaluate = (rawKey: string): CellValue => {
    const key = rawKey.toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;
    if (visiting.has(key)) return { kind: "error", code: "#CYCLE" };
    if (depth >= MAX_EVAL_DEPTH) return { kind: "error", code: "#ERREUR" };

    visiting.add(key);
    depth += 1;
    const raw = cells[key] ?? "";
    let result: CellValue;
    try {
      if (raw.startsWith("=")) {
        try {
          const value = new Parser(tokenize(raw.slice(1)), evaluate).parse();
          result = Number.isFinite(value)
            ? { kind: "number", value }
            : { kind: "error", code: "#NUM!" };
        } catch (error) {
          result = { kind: "error", code: errorCode(error) };
        }
      } else if (raw.trim() === "") {
        result = { kind: "text", value: "" };
      } else {
        const number = Number(raw);
        if (Number.isNaN(number)) {
          result = { kind: "text", value: raw };
        } else if (Number.isFinite(number)) {
          result = { kind: "number", value: number };
        } else {
          result = { kind: "error", code: "#NUM!" };
        }
      }
    } finally {
      visiting.delete(key);
      depth -= 1;
    }

    cache.set(key, result);
    return result;
  };

  const evaluated = new Map<string, CellValue>();
  for (const key of Object.keys(cells)) {
    evaluated.set(key.toUpperCase(), evaluate(key));
  }
  return evaluated;
}
