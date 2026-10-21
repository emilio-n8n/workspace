/**
 * Moteur de formules natif (v2, vague « parité Excel »), pur et testable
 * (aucune dépendance DOM). Les cellules stockent la valeur brute ; le calcul
 * est toujours fait à la demande.
 *
 * Couvre :
 * - littéraux : nombres (point ou virgule décimale dans une cellule, notation
 *   scientifique, `%` final), chaînes `"…"` (`""` pour un guillemet), booléens
 *   VRAI/FAUX (TRUE/FALSE) ;
 * - références `A1`, `$A$1` (absolues ou mixtes), plages `A1:B2`, colonnes
 *   entières `A:A` (bornées aux lignes utilisées) ;
 * - opérateurs Excel avec leurs priorités : `= <> < > <= >=`, `&`, `+ -`,
 *   `* /`, `^`, `-` unaire, `%` postfixé ;
 * - environ 90 fonctions (maths, statistiques, conditions, logique, texte,
 *   dates, recherche), sous leur nom anglais **et** leur nom français
 *   (SOMME, MOYENNE, SI, NB.SI, RECHERCHEV…) ; séparateur `,` ou `;`.
 *
 * Sémantique (compatible avec la v1) :
 * - une cellule vide vaut 0 en arithmétique et "" en texte ;
 * - un texte non numérique en arithmétique → #ERREUR (le #VALEUR! d'Excel) ;
 * - les agrégats ignorent texte et vides des plages ; AVG/MOYENNE sans
 *   valeur → #DIV/0 ; MIN/MAX sans valeur → 0 ;
 * - fonction ou nom inconnu → #NOM? ; recherche infructueuse → #N/A ;
 *   index hors plage → #REF! ; résultat non fini → #NUM! ; cycle → #CYCLE.
 */

export type CellValue =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
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
 * Volontairement sous la limite de pile du moteur JS : au-delà, la formule
 * renvoie #ERREUR au lieu de déborder.
 */
const MAX_EVAL_DEPTH = 1_000;
/** Longueur maximale d'un texte produit par une formule (REPT, concaténation). */
const MAX_TEXT_LENGTH = 32_767;

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
  if (error instanceof RangeError) return "#ERREUR";
  if (error instanceof Error && error.message.startsWith("#")) return error.message;
  return "#ERREUR";
}

/** Convertit (ligne, colonne) 0-indexées en référence « A1 ». */
export function cellKey(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** Lettres d'une colonne 0-indexée (0 → A, 26 → AA). */
export function columnLabel(col: number): string {
  let letters = "";
  let n = col + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Index 0-basé d'une colonne écrite en lettres, `null` hors bornes. */
export function columnIndex(letters: string): number | null {
  if (!/^[A-Z]+$/i.test(letters) || letters.length > 4) return null;
  let column = 0;
  for (const char of letters.toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  const col = column - 1;
  return col >= 0 && col <= MAX_COL_INDEX ? col : null;
}

/**
 * Convertit une référence « A1 » (ou « $A$1 ») en (ligne, colonne)
 * 0-indexées. Rejette les références hors bornes (plus de 702 colonnes, plus
 * d'un million de lignes) : sans cela, une colonne de 300 lettres produit
 * `Infinity` et `cellKey()` boucle indéfiniment.
 */
export function parseKey(key: string): { row: number; col: number } | null {
  const [, letters, digits] = /^\$?([A-Z]+)\$?(\d+)$/.exec(key.toUpperCase()) ?? [];
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
  if (value.kind === "boolean") return value.value ? "VRAI" : "FAUX";
  return formatNumber(value.value);
}

function formatNumber(value: number): string {
  return Number(value.toPrecision(15)).toString();
}

/**
 * Nombre saisi dans une cellule : point ou virgule décimale, espaces
 * (insécables) de milliers, signe, exposant, `%` final. `null` sinon.
 */
export function parseCellLiteral(raw: string): number | null {
  let text = raw.trim();
  // Espaces de milliers seulement entre groupes de trois chiffres (« 1 000 »).
  if (/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?%?$/.test(text)) {
    text = text.replace(/[ \u00a0\u202f]/g, "");
  }
  let scale = 1;
  if (text.endsWith("%")) {
    scale = 0.01;
    text = text.slice(0, -1);
  }
  if (/^[+-]?\d+,\d+(?:e[+-]?\d+)?$/i.test(text)) text = text.replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text) * scale;
  return Number.isNaN(value) ? null : value;
}

// ---------------------------------------------------------------------------
// Analyse lexicale
// ---------------------------------------------------------------------------

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "punct"; value: string }
  /** Préfixe d'onglet (« Feuil2! », « 'Mes données'! ») : nom tel que saisi. */
  | { type: "sheet"; value: string };

const OPERATORS = ["<>", "<=", ">=", "=", "<", ">", "&", "+", "-", "*", "/", "^", "%"];

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
      // « 12A » n'est pas un nombre : on laisse la suite échouer proprement.
      const value = Number(literal);
      if (Number.isNaN(value)) throw new FormulaError("#ERREUR", "Nombre invalide.");
      // Une référence de ligne seule (« 1:3 ») n'est pas prise en charge.
      tokens.push({ type: "number", value });
      continue;
    }
    // Référence à un autre onglet : 'Nom avec espaces'!A1 ou Feuil2!A1.
    if (char === "'") {
      let name = "";
      let cursor = index + 1;
      for (;;) {
        if (cursor >= source.length) throw new FormulaError("#ERREUR", "Nom d'onglet non fermé.");
        const current = source[cursor];
        if (current === "'") {
          if (source[cursor + 1] === "'") {
            name += "'";
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        name += current;
        cursor += 1;
      }
      if (source[cursor] !== "!")
        throw new FormulaError("#ERREUR", "« ! » attendu après le nom d'onglet.");
      tokens.push({ type: "sheet", value: name });
      index = cursor + 1;
      continue;
    }
    const sheetPrefix = /^([\p{L}_][\p{L}\p{N}_.]*)!/u.exec(source.slice(index));
    if (sheetPrefix?.[1]) {
      tokens.push({ type: "sheet", value: sheetPrefix[1] });
      index += sheetPrefix[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let ident = "";
      while (index < source.length && /[A-Za-z0-9_.$]/.test(source[index] ?? "")) {
        ident += source[index];
        index += 1;
      }
      tokens.push({ type: "ident", value: ident.toUpperCase() });
      continue;
    }
    if (char === '"') {
      index += 1;
      let text = "";
      for (;;) {
        if (index >= source.length) throw new FormulaError("#ERREUR", "Chaîne non fermée.");
        const current = source[index];
        if (current === '"') {
          if (source[index + 1] === '"') {
            text += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        text += current;
        index += 1;
      }
      tokens.push({ type: "string", value: text });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      tokens.push({ type: "op", value: two });
      index += 2;
      continue;
    }
    if (OPERATORS.includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    if ("():,;".includes(char)) {
      // `;` est le séparateur d'arguments des tableurs français.
      tokens.push({ type: "punct", value: char === ";" ? "," : char });
      index += 1;
      continue;
    }
    throw new FormulaError("#ERREUR", `Caractère invalide : ${char}.`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Arbre syntaxique
// ---------------------------------------------------------------------------

type RangeNode = {
  type: "range";
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** Colonne entière (A:A) : les lignes sont bornées à l'évaluation. */
  wholeColumns?: boolean;
  /** Onglet visé (`Feuil2!A1:B3`) ; absent = onglet de la formule. */
  sheet?: string;
};

type Node =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "ref"; row: number; col: number; sheet?: string }
  | RangeNode
  | { type: "unary"; op: string; operand: Node }
  | { type: "percent"; operand: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

const BOOLEAN_NAMES: Record<string, boolean> = {
  TRUE: true,
  VRAI: true,
  FALSE: false,
  FAUX: false,
};

class Parser {
  private position = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new FormulaError("#ERREUR", "Formule vide.");
    const node = this.comparison();
    if (this.position !== this.tokens.length) {
      throw new FormulaError("#ERREUR", "Formule incomplète.");
    }
    return node;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  private consume(): Token {
    const token = this.tokens[this.position];
    if (!token) throw new FormulaError("#ERREUR", "Formule incomplète.");
    this.position += 1;
    return token;
  }

  private matchOp(...values: string[]): string | null {
    const token = this.peek();
    if (token?.type === "op" && values.includes(token.value)) {
      this.position += 1;
      return token.value;
    }
    return null;
  }

  private matchPunct(value: string): boolean {
    const token = this.peek();
    if (token?.type === "punct" && token.value === value) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private comparison(): Node {
    let node = this.concatenation();
    for (;;) {
      const op = this.matchOp("=", "<>", "<", ">", "<=", ">=");
      if (!op) return node;
      node = { type: "binary", op, left: node, right: this.concatenation() };
    }
  }

  private concatenation(): Node {
    let node = this.additive();
    for (;;) {
      const op = this.matchOp("&");
      if (!op) return node;
      node = { type: "binary", op, left: node, right: this.additive() };
    }
  }

  private additive(): Node {
    let node = this.multiplicative();
    for (;;) {
      const op = this.matchOp("+", "-");
      if (!op) return node;
      node = { type: "binary", op, left: node, right: this.multiplicative() };
    }
  }

  private multiplicative(): Node {
    let node = this.power();
    for (;;) {
      const op = this.matchOp("*", "/");
      if (!op) return node;
      node = { type: "binary", op, left: node, right: this.power() };
    }
  }

  private power(): Node {
    let node = this.unary();
    for (;;) {
      const op = this.matchOp("^");
      if (!op) return node;
      node = { type: "binary", op, left: node, right: this.unary() };
    }
  }

  private unary(): Node {
    const op = this.matchOp("-", "+");
    if (op) return { type: "unary", op, operand: this.unary() };
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    while (this.matchOp("%")) node = { type: "percent", operand: node };
    return node;
  }

  private primary(): Node {
    const token = this.consume();
    if (token.type === "number") return { type: "number", value: token.value };
    if (token.type === "string") return { type: "string", value: token.value };
    if (token.type === "punct" && token.value === "(") {
      const node = this.comparison();
      if (!this.matchPunct(")")) {
        throw new FormulaError("#ERREUR", "Parenthèse fermante manquante.");
      }
      return node;
    }
    if (token.type === "ident") {
      if (this.matchPunct("(")) return this.call(token.value);
      return this.reference(token.value);
    }
    if (token.type === "sheet") {
      const target = this.consume();
      if (target.type !== "ident") throw new FormulaError("#REF!", "Référence d'onglet invalide.");
      const node = this.reference(target.value);
      if (node.type !== "ref" && node.type !== "range") {
        throw new FormulaError("#REF!", "Référence d'onglet invalide.");
      }
      return { ...node, sheet: token.value };
    }
    throw new FormulaError("#ERREUR", "Jeton inattendu.");
  }

  private call(name: string): Node {
    const args: Node[] = [];
    if (this.matchPunct(")")) return { type: "call", name, args };
    for (;;) {
      // Argument omis (« SI(A1;;2) ») : vide.
      const next = this.peek();
      if (next?.type === "punct" && (next.value === "," || next.value === ")")) {
        args.push({ type: "string", value: "" });
      } else {
        args.push(this.comparison());
      }
      if (this.matchPunct(",")) continue;
      if (this.matchPunct(")")) break;
      throw new FormulaError("#ERREUR", `Arguments invalides pour ${name}.`);
    }
    return { type: "call", name, args };
  }

  private reference(ident: string): Node {
    if (ident in BOOLEAN_NAMES) return { type: "boolean", value: BOOLEAN_NAMES[ident] === true };
    const next = this.peek();
    if (next?.type === "punct" && next.value === ":") {
      this.position += 1;
      const end = this.consume();
      if (end.type !== "ident") throw new FormulaError("#ERREUR", "Référence de plage invalide.");
      // Colonnes entières : A:A, $B:$D.
      const startColumn = columnIndex(ident.replace(/\$/g, ""));
      const endColumn = columnIndex(end.value.replace(/\$/g, ""));
      if (
        startColumn !== null &&
        endColumn !== null &&
        /^\$?[A-Z]+$/.test(ident) &&
        /^\$?[A-Z]+$/.test(end.value)
      ) {
        return {
          type: "range",
          startRow: 0,
          endRow: 0,
          startCol: Math.min(startColumn, endColumn),
          endCol: Math.max(startColumn, endColumn),
          wholeColumns: true,
        };
      }
      const start = parseKey(ident);
      const stop = parseKey(end.value);
      if (!start || !stop) throw new FormulaError("#ERREUR", "Référence de plage invalide.");
      const startRow = Math.min(start.row, stop.row);
      const endRow = Math.max(start.row, stop.row);
      const startCol = Math.min(start.col, stop.col);
      const endCol = Math.max(start.col, stop.col);
      if ((endRow - startRow + 1) * (endCol - startCol + 1) > MAX_RANGE_CELLS) {
        throw new FormulaError("#ERREUR", "plage trop grande");
      }
      return { type: "range", startRow, startCol, endRow, endCol };
    }
    const cell = parseKey(ident);
    if (cell) return { type: "ref", row: cell.row, col: cell.col };
    if (/^\$?[A-Z]+\$?\d+$/.test(ident)) {
      throw new FormulaError("#ERREUR", "Référence hors de la feuille.");
    }
    throw new FormulaError("#NOM?", `Nom inconnu : ${ident}.`);
  }
}

// ---------------------------------------------------------------------------
// Valeurs d'évaluation
// ---------------------------------------------------------------------------

/** Valeur scalaire ; `null` = cellule vide. */
type Scalar = number | string | boolean | null;

/** Matrice issue d'une plage (lignes × colonnes), erreurs comprises. */
type Matrix = { kind: "matrix"; rows: (Scalar | FormulaError)[][] };

type Value = Scalar | Matrix;

function isMatrix(value: Value | FormulaError): value is Matrix {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "matrix";
}

/** Contexte : lecture des cellules et ligne maximale utilisée (colonnes entières). */
type Context = {
  read: (row: number, col: number, sheet?: string) => Scalar | FormulaError;
  /** Dernière ligne utilisée de l'onglet (colonnes entières). */
  maxRowOf: (sheet?: string) => number;
  now: () => Date;
};

/** Argument paresseux : SI, SIERREUR… n'évaluent que la branche utile. */
type Arg = { node: Node; value: () => Value };

function cellValueToScalar(value: CellValue): Scalar | FormulaError {
  if (value.kind === "error") return new FormulaError(value.code);
  if (value.kind === "text") return value.value === "" ? null : value.value;
  return value.value;
}

function scalarOf(value: Value): Scalar {
  if (!isMatrix(value)) return value;
  // Plage en contexte scalaire : refusée (comme l'opération sur une plage v1).
  throw new FormulaError("#ERREUR", "Plage utilisée comme valeur simple.");
}

function toNumber(value: Scalar): number {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = parseCellLiteral(value);
  if (parsed === null) {
    throw new FormulaError("#ERREUR", "Texte utilisé dans une opération arithmétique.");
  }
  return parsed;
}

function toText(value: Scalar): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "VRAI" : "FAUX";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

function toBoolean(value: Scalar): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const upper = value.toUpperCase();
  if (upper === "VRAI" || upper === "TRUE") return true;
  if (upper === "FAUX" || upper === "FALSE") return false;
  throw new FormulaError("#ERREUR", "Texte utilisé comme condition.");
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new FormulaError("#NUM!", "Résultat non fini.");
  return value;
}

/** Ordre de comparaison d'Excel : nombres < textes < booléens ; vide = 0 ou "". */
function compare(left: Scalar, right: Scalar): number {
  const l = left === null ? (typeof right === "string" ? "" : 0) : left;
  const r = right === null ? (typeof left === "string" ? "" : 0) : right;
  const rank = (value: Scalar) =>
    typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2;
  if (rank(l) !== rank(r)) return rank(l) - rank(r);
  if (typeof l === "string" && typeof r === "string") {
    return l.localeCompare(r, "fr", { sensitivity: "base" });
  }
  const a = Number(l);
  const b = Number(r);
  return a === b ? 0 : a < b ? -1 : 1;
}

function evaluateNode(node: Node, ctx: Context): Value {
  switch (node.type) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "ref": {
      const value = ctx.read(node.row, node.col, node.sheet);
      if (value instanceof FormulaError) throw value;
      return value;
    }
    case "range":
      return readRange(node, ctx);
    case "unary": {
      const value = toNumber(scalarOf(evaluateNode(node.operand, ctx)));
      return node.op === "-" ? -value : value;
    }
    case "percent":
      return toNumber(scalarOf(evaluateNode(node.operand, ctx))) / 100;
    case "binary":
      return binary(node.op, node.left, node.right, ctx);
    case "call":
      return callFunction(node.name, node.args, ctx);
  }
}

function readRange(node: RangeNode, ctx: Context): Matrix {
  const endRow = node.wholeColumns ? ctx.maxRowOf(node.sheet) : node.endRow;
  const cells = (endRow - node.startRow + 1) * (node.endCol - node.startCol + 1);
  if (cells > MAX_RANGE_CELLS) throw new FormulaError("#ERREUR", "plage trop grande");
  const rows: (Scalar | FormulaError)[][] = [];
  for (let row = node.startRow; row <= endRow; row += 1) {
    const line: (Scalar | FormulaError)[] = [];
    for (let col = node.startCol; col <= node.endCol; col += 1)
      line.push(ctx.read(row, col, node.sheet));
    rows.push(line);
  }
  return { kind: "matrix", rows };
}

function binary(op: string, leftNode: Node, rightNode: Node, ctx: Context): Value {
  const left = scalarOf(evaluateNode(leftNode, ctx));
  const right = scalarOf(evaluateNode(rightNode, ctx));
  switch (op) {
    case "+":
      return finite(toNumber(left) + toNumber(right));
    case "-":
      return finite(toNumber(left) - toNumber(right));
    case "*":
      return finite(toNumber(left) * toNumber(right));
    case "/": {
      const divisor = toNumber(right);
      const dividend = toNumber(left);
      if (divisor === 0) throw new FormulaError("#DIV/0", "Division par zéro.");
      return finite(dividend / divisor);
    }
    case "^": {
      const result = toNumber(left) ** toNumber(right);
      if (Number.isNaN(result)) throw new FormulaError("#NUM!", "Puissance invalide.");
      return finite(result);
    }
    case "&": {
      const text = toText(left) + toText(right);
      if (text.length > MAX_TEXT_LENGTH) throw new FormulaError("#ERREUR", "Texte trop long.");
      return text;
    }
    case "=":
      return compare(left, right) === 0;
    case "<>":
      return compare(left, right) !== 0;
    case "<":
      return compare(left, right) < 0;
    case ">":
      return compare(left, right) > 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">=":
      return compare(left, right) >= 0;
    default:
      throw new FormulaError("#ERREUR", `Opérateur inconnu : ${op}.`);
  }
}

// ---------------------------------------------------------------------------
// Bibliothèque de fonctions
// ---------------------------------------------------------------------------

type FunctionImpl = (args: Arg[], ctx: Context) => Value;

export type FunctionCategory =
  | "Maths"
  | "Statistiques"
  | "Logique"
  | "Texte"
  | "Date"
  | "Recherche"
  | "Information";

export type FormulaFunctionInfo = {
  /** Nom anglais (canonique). */
  name: string;
  /** Nom français (Excel / LibreOffice en français). */
  fr: string;
  category: FunctionCategory;
  /** Signature affichée dans l'aide (« SI(condition; si_vrai; [si_faux]) »). */
  syntax: string;
  description: string;
};

type FunctionDef = FormulaFunctionInfo & {
  min: number;
  max: number;
  impl: FunctionImpl;
  /** Autres noms acceptés (AVG historique, CONCATENER…). */
  aliases?: string[];
};

/** Valeurs numériques d'arguments d'agrégat (sémantique SUM d'Excel). */
function collectNumbers(args: Arg[]): number[] {
  const numbers: number[] = [];
  for (const arg of args) {
    // Une référence nue garde la sémantique « cellule » : son texte est ignoré.
    if (arg.node.type === "ref") {
      const value = arg.value();
      if (typeof value === "number") numbers.push(value);
      continue;
    }
    const value = arg.value();
    if (isMatrix(value)) {
      for (const line of value.rows) {
        for (const cell of line) {
          if (cell instanceof FormulaError) throw cell;
          if (typeof cell === "number") numbers.push(cell);
        }
      }
    } else if (value !== null) {
      numbers.push(toNumber(value));
    }
  }
  return numbers;
}

/** Toutes les valeurs d'arguments, à plat (plages déroulées, vides conservés). */
function flatten(args: Arg[]): (Scalar | FormulaError)[] {
  const values: (Scalar | FormulaError)[] = [];
  for (const arg of args) {
    const value = arg.value();
    if (isMatrix(value)) for (const line of value.rows) values.push(...line);
    else values.push(value);
  }
  return values;
}

function matrixOf(arg: Arg | undefined): Matrix {
  if (!arg) throw new FormulaError("#ERREUR", "Plage attendue.");
  const value = arg.value();
  if (isMatrix(value)) return value;
  return { kind: "matrix", rows: [[value]] };
}

function cellsOf(matrix: Matrix): (Scalar | FormulaError)[] {
  return matrix.rows.flat();
}

function num(arg: Arg | undefined, fallback?: number): number {
  if (!arg) {
    if (fallback === undefined) throw new FormulaError("#ERREUR", "Argument manquant.");
    return fallback;
  }
  const value = scalarOf(arg.value());
  if (value === "" && fallback !== undefined) return fallback;
  return toNumber(value);
}

function text(arg: Arg | undefined, fallback = ""): string {
  if (!arg) return fallback;
  return toText(scalarOf(arg.value()));
}

function bool(arg: Arg | undefined, fallback: boolean): boolean {
  if (!arg) return fallback;
  const value = scalarOf(arg.value());
  if (value === "") return fallback;
  return toBoolean(value);
}

function roundTo(value: number, digits: number, mode: "round" | "up" | "down"): number {
  const factor = 10 ** Math.trunc(digits);
  const scaled = value * factor;
  // Correction du bruit flottant (2,675 × 100 = 267,49999…).
  const nudged = Number(scaled.toPrecision(15));
  let rounded: number;
  if (mode === "round") rounded = Math.sign(nudged) * Math.round(Math.abs(nudged));
  else if (mode === "up") rounded = Math.sign(nudged) * Math.ceil(Math.abs(nudged));
  else rounded = Math.sign(nudged) * Math.floor(Math.abs(nudged));
  return rounded / factor;
}

/** Critère SOMME.SI / NB.SI : « >5 », « <>x », « =abc », « a* », 12, VRAI. */
export function matchesCriterion(value: Scalar | FormulaError, criterion: Scalar): boolean {
  if (value instanceof FormulaError) return false;
  if (typeof criterion === "number" || typeof criterion === "boolean") {
    return value !== null && compare(value, criterion) === 0;
  }
  const raw = criterion ?? "";
  const [, op = "", operand = ""] = /^(<>|<=|>=|=|<|>)?(.*)$/s.exec(raw) ?? [];
  const numeric = parseCellLiteral(operand);
  if (op === "" || op === "=" || op === "<>") {
    let equal: boolean;
    if (operand === "") equal = value === null || value === "";
    else if (numeric !== null && (typeof value === "number" || typeof value === "boolean")) {
      equal = Number(value) === numeric;
    } else if (/[*?]/.test(operand)) {
      const pattern = new RegExp(
        `^${operand
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
        "i",
      );
      equal = pattern.test(toText(value));
    } else {
      equal = toText(value).localeCompare(operand, "fr", { sensitivity: "base" }) === 0;
    }
    return op === "<>" ? !equal : equal;
  }
  if (value === null) return false;
  const target: Scalar = numeric ?? operand;
  if (typeof target === "number" && typeof value !== "number") return false;
  if (typeof target === "string" && typeof value !== "string") return false;
  const order = compare(value, target);
  if (op === "<") return order < 0;
  if (op === ">") return order > 0;
  if (op === "<=") return order <= 0;
  return order >= 0;
}

/** Jour 0 du calendrier des tableurs : 30/12/1899 (séries identiques à Excel dès mars 1900). */
const EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Numéro de série d'une date (jours depuis le 30/12/1899, comme Excel après mars 1900). */
export function dateToSerial(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - EPOCH_UTC) / DAY_MS);
}

/** Date UTC d'un numéro de série. */
export function serialToDate(serial: number): Date {
  return new Date(EPOCH_UTC + Math.floor(serial) * DAY_MS);
}

function dateParts(arg: Arg | undefined): Date {
  const serial = num(arg);
  if (serial < 0) throw new FormulaError("#NUM!", "Date négative.");
  return serialToDate(serial);
}

/** TEXTE(valeur; format) : sous-ensemble courant des formats Excel. */
export function formatWithPattern(value: number, pattern: string): string {
  const trimmed = pattern.trim();
  const lower = trimmed.toLowerCase();
  if (/^(jj|dd)[/.-](mm)[/.-](aaaa|yyyy)$/.test(lower)) {
    const date = serialToDate(value);
    const sep = trimmed.charAt(2);
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}${sep}${mm}${sep}${date.getUTCFullYear()}`;
  }
  if (/^(aaaa|yyyy)-mm-(jj|dd)$/.test(lower)) {
    return serialToDate(value).toISOString().slice(0, 10);
  }
  const percent = trimmed.endsWith("%");
  const core = percent ? trimmed.slice(0, -1) : trimmed;
  const decimals = /[.,]([0#]+)$/.exec(core)?.[1]?.length ?? 0;
  const grouping = /[#0][ ,][#0]{3}/.test(core);
  if (!/^[#0., ]+$/.test(core)) return formatNumber(value);
  const formatter = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
  const formatted = formatter.format(percent ? value * 100 : value);
  return percent ? `${formatted} %` : formatted;
}

function lookupIndex(
  needle: Scalar,
  values: (Scalar | FormulaError)[],
  mode: "exact" | "approx",
): number {
  if (mode === "exact") {
    for (let index = 0; index < values.length; index += 1) {
      const candidate = values[index];
      if (candidate instanceof FormulaError || candidate === null || candidate === undefined)
        continue;
      if (typeof needle === "string" && /[*?]/.test(needle)) {
        if (matchesCriterion(candidate, needle)) return index;
      } else if (compare(candidate, needle) === 0) {
        return index;
      }
    }
    return -1;
  }
  // Approchée : plus grande valeur ≤ recherchée (plage triée, comme Excel).
  let found = -1;
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    if (candidate instanceof FormulaError || candidate === null || candidate === undefined)
      continue;
    if (compare(candidate, needle) <= 0) found = index;
    else break;
  }
  return found;
}

function notFound(): never {
  throw new FormulaError("#N/A", "Valeur introuvable.");
}

function sample(numbers: number[]): { mean: number; variance: number } {
  if (numbers.length < 2) throw new FormulaError("#DIV/0", "Au moins deux valeurs requises.");
  const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length;
  const variance =
    numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / (numbers.length - 1);
  return { mean, variance };
}

/** Plages « critère » de SOMME.SI.ENS : paires (plage, critère) alignées. */
function criteriaMask(args: Arg[], size: number): boolean[] {
  if (args.length % 2 !== 0) throw new FormulaError("#ERREUR", "Paires plage/critère attendues.");
  const mask = new Array<boolean>(size).fill(true);
  for (let index = 0; index < args.length; index += 2) {
    const cells = cellsOf(matrixOf(args[index]));
    if (cells.length !== size) throw new FormulaError("#ERREUR", "Plages de tailles différentes.");
    const criterion = scalarOf(args[index + 1]?.value() ?? null);
    for (let cell = 0; cell < size; cell += 1) {
      if (!matchesCriterion(cells[cell] ?? null, criterion)) mask[cell] = false;
    }
  }
  return mask;
}

const FUNCTIONS: FunctionDef[] = [
  // --- Maths -------------------------------------------------------------
  {
    name: "SUM",
    fr: "SOMME",
    category: "Maths",
    syntax: "SOMME(nombre1; [nombre2]; …)",
    description: "Additionne les nombres et les plages.",
    min: 0,
    max: 255,
    impl: (args) => collectNumbers(args).reduce((total, value) => total + value, 0),
  },
  {
    name: "PRODUCT",
    fr: "PRODUIT",
    category: "Maths",
    syntax: "PRODUIT(nombre1; [nombre2]; …)",
    description: "Multiplie les nombres et les plages.",
    min: 1,
    max: 255,
    impl: (args) => {
      const numbers = collectNumbers(args);
      return numbers.length === 0 ? 0 : numbers.reduce((total, value) => total * value, 1);
    },
  },
  {
    name: "ROUND",
    fr: "ARRONDI",
    category: "Maths",
    syntax: "ARRONDI(nombre; nb_chiffres)",
    description: "Arrondit au nombre de chiffres indiqué.",
    min: 1,
    max: 2,
    impl: (args) => roundTo(num(args[0]), num(args[1], 0), "round"),
  },
  {
    name: "ROUNDUP",
    fr: "ARRONDI.SUP",
    category: "Maths",
    syntax: "ARRONDI.SUP(nombre; nb_chiffres)",
    description: "Arrondit en s'éloignant de zéro.",
    min: 1,
    max: 2,
    impl: (args) => roundTo(num(args[0]), num(args[1], 0), "up"),
  },
  {
    name: "ROUNDDOWN",
    fr: "ARRONDI.INF",
    category: "Maths",
    syntax: "ARRONDI.INF(nombre; nb_chiffres)",
    description: "Arrondit vers zéro.",
    min: 1,
    max: 2,
    impl: (args) => roundTo(num(args[0]), num(args[1], 0), "down"),
  },
  {
    name: "INT",
    fr: "ENT",
    category: "Maths",
    syntax: "ENT(nombre)",
    description: "Partie entière (arrondi à l'entier inférieur).",
    min: 1,
    max: 1,
    impl: (args) => Math.floor(num(args[0])),
  },
  {
    name: "TRUNC",
    fr: "TRONQUE",
    category: "Maths",
    syntax: "TRONQUE(nombre; [nb_chiffres])",
    description: "Supprime la partie décimale.",
    min: 1,
    max: 2,
    impl: (args) => roundTo(num(args[0]), num(args[1], 0), "down"),
  },
  {
    name: "ABS",
    fr: "ABS",
    category: "Maths",
    syntax: "ABS(nombre)",
    description: "Valeur absolue.",
    min: 1,
    max: 1,
    impl: (args) => Math.abs(num(args[0])),
  },
  {
    name: "SQRT",
    fr: "RACINE",
    category: "Maths",
    syntax: "RACINE(nombre)",
    description: "Racine carrée.",
    min: 1,
    max: 1,
    impl: (args) => {
      const value = num(args[0]);
      if (value < 0) throw new FormulaError("#NUM!", "Racine d'un nombre négatif.");
      return Math.sqrt(value);
    },
  },
  {
    name: "POWER",
    fr: "PUISSANCE",
    category: "Maths",
    syntax: "PUISSANCE(nombre; puissance)",
    description: "Élève un nombre à une puissance.",
    min: 2,
    max: 2,
    impl: (args) => {
      const result = num(args[0]) ** num(args[1]);
      if (Number.isNaN(result)) throw new FormulaError("#NUM!", "Puissance invalide.");
      return finite(result);
    },
  },
  {
    name: "MOD",
    fr: "MOD",
    category: "Maths",
    syntax: "MOD(nombre; diviseur)",
    description: "Reste de la division (du signe du diviseur).",
    min: 2,
    max: 2,
    impl: (args) => {
      const value = num(args[0]);
      const divisor = num(args[1]);
      if (divisor === 0) throw new FormulaError("#DIV/0", "Division par zéro.");
      return value - divisor * Math.floor(value / divisor);
    },
  },
  {
    name: "EXP",
    fr: "EXP",
    category: "Maths",
    syntax: "EXP(nombre)",
    description: "e élevé à la puissance du nombre.",
    min: 1,
    max: 1,
    impl: (args) => finite(Math.exp(num(args[0]))),
  },
  {
    name: "LN",
    fr: "LN",
    category: "Maths",
    syntax: "LN(nombre)",
    description: "Logarithme népérien.",
    min: 1,
    max: 1,
    impl: (args) => {
      const value = num(args[0]);
      if (value <= 0) throw new FormulaError("#NUM!", "Logarithme d'un nombre ≤ 0.");
      return Math.log(value);
    },
  },
  {
    name: "LOG",
    fr: "LOG",
    category: "Maths",
    syntax: "LOG(nombre; [base])",
    description: "Logarithme dans la base indiquée (10 par défaut).",
    min: 1,
    max: 2,
    impl: (args) => {
      const value = num(args[0]);
      const base = num(args[1], 10);
      if (value <= 0 || base <= 0 || base === 1)
        throw new FormulaError("#NUM!", "Logarithme invalide.");
      return Math.log(value) / Math.log(base);
    },
  },
  {
    name: "LOG10",
    fr: "LOG10",
    category: "Maths",
    syntax: "LOG10(nombre)",
    description: "Logarithme décimal.",
    min: 1,
    max: 1,
    impl: (args) => {
      const value = num(args[0]);
      if (value <= 0) throw new FormulaError("#NUM!", "Logarithme d'un nombre ≤ 0.");
      return Math.log10(value);
    },
  },
  {
    name: "PI",
    fr: "PI",
    category: "Maths",
    syntax: "PI()",
    description: "La constante π.",
    min: 0,
    max: 0,
    impl: () => Math.PI,
  },
  {
    name: "SIGN",
    fr: "SIGNE",
    category: "Maths",
    syntax: "SIGNE(nombre)",
    description: "1, 0 ou -1 selon le signe.",
    min: 1,
    max: 1,
    impl: (args) => Math.sign(num(args[0])),
  },
  {
    name: "CEILING",
    fr: "PLAFOND",
    category: "Maths",
    syntax: "PLAFOND(nombre; [multiple])",
    description: "Arrondit au multiple supérieur.",
    min: 1,
    max: 2,
    impl: (args) => {
      const multiple = num(args[1], 1);
      if (multiple === 0) return 0;
      return Number((Math.ceil(num(args[0]) / multiple) * multiple).toPrecision(15));
    },
  },
  {
    name: "FLOOR",
    fr: "PLANCHER",
    category: "Maths",
    syntax: "PLANCHER(nombre; [multiple])",
    description: "Arrondit au multiple inférieur.",
    min: 1,
    max: 2,
    impl: (args) => {
      const multiple = num(args[1], 1);
      if (multiple === 0) throw new FormulaError("#DIV/0", "Multiple nul.");
      return Number((Math.floor(num(args[0]) / multiple) * multiple).toPrecision(15));
    },
  },
  {
    name: "RAND",
    fr: "ALEA",
    category: "Maths",
    syntax: "ALEA()",
    description: "Nombre aléatoire entre 0 et 1 (recalculé à chaque affichage).",
    min: 0,
    max: 0,
    impl: () => Math.random(),
  },
  {
    name: "RANDBETWEEN",
    fr: "ALEA.ENTRE.BORNES",
    category: "Maths",
    syntax: "ALEA.ENTRE.BORNES(min; max)",
    description: "Entier aléatoire entre deux bornes.",
    min: 2,
    max: 2,
    impl: (args) => {
      const low = Math.ceil(num(args[0]));
      const high = Math.floor(num(args[1]));
      if (high < low) throw new FormulaError("#NUM!", "Bornes inversées.");
      return low + Math.floor(Math.random() * (high - low + 1));
    },
  },
  {
    name: "SUMPRODUCT",
    fr: "SOMMEPROD",
    category: "Maths",
    syntax: "SOMMEPROD(matrice1; [matrice2]; …)",
    description: "Somme des produits terme à terme.",
    min: 1,
    max: 30,
    impl: (args) => {
      const arrays = args.map((arg) => cellsOf(matrixOf(arg)));
      const size = arrays[0]?.length ?? 0;
      if (arrays.some((array) => array.length !== size)) {
        throw new FormulaError("#ERREUR", "Matrices de tailles différentes.");
      }
      let total = 0;
      for (let index = 0; index < size; index += 1) {
        let product = 1;
        for (const array of arrays) {
          const cell = array[index];
          if (cell instanceof FormulaError) throw cell;
          product *= typeof cell === "number" ? cell : 0;
        }
        total += product;
      }
      return total;
    },
  },
  {
    name: "SUMIF",
    fr: "SOMME.SI",
    category: "Maths",
    syntax: "SOMME.SI(plage; critère; [plage_somme])",
    description: "Additionne les cellules qui remplissent un critère.",
    min: 2,
    max: 3,
    impl: (args) => {
      const range = cellsOf(matrixOf(args[0]));
      const criterion = scalarOf(args[1]?.value() ?? null);
      const sumRange = args[2] ? cellsOf(matrixOf(args[2])) : range;
      let total = 0;
      range.forEach((cell, index) => {
        if (!matchesCriterion(cell, criterion)) return;
        const value = sumRange[index];
        if (value instanceof FormulaError) throw value;
        if (typeof value === "number") total += value;
      });
      return total;
    },
  },
  {
    name: "SUMIFS",
    fr: "SOMME.SI.ENS",
    category: "Maths",
    syntax: "SOMME.SI.ENS(plage_somme; plage1; critère1; …)",
    description: "Additionne les cellules qui remplissent plusieurs critères.",
    min: 3,
    max: 255,
    impl: (args) => {
      const sumRange = cellsOf(matrixOf(args[0]));
      const mask = criteriaMask(args.slice(1), sumRange.length);
      let total = 0;
      sumRange.forEach((value, index) => {
        if (!mask[index]) return;
        if (value instanceof FormulaError) throw value;
        if (typeof value === "number") total += value;
      });
      return total;
    },
  },
  // --- Statistiques ------------------------------------------------------
  {
    name: "AVERAGE",
    fr: "MOYENNE",
    aliases: ["AVG"],
    category: "Statistiques",
    syntax: "MOYENNE(nombre1; [nombre2]; …)",
    description: "Moyenne arithmétique.",
    min: 1,
    max: 255,
    impl: (args) => {
      const numbers = collectNumbers(args);
      if (numbers.length === 0) throw new FormulaError("#DIV/0", "Moyenne sans valeur numérique.");
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    },
  },
  {
    name: "MIN",
    fr: "MIN",
    category: "Statistiques",
    syntax: "MIN(nombre1; [nombre2]; …)",
    description: "Plus petite valeur.",
    min: 1,
    max: 255,
    impl: (args) => {
      const numbers = collectNumbers(args);
      return numbers.length > 0 ? Math.min(...numbers) : 0;
    },
  },
  {
    name: "MAX",
    fr: "MAX",
    category: "Statistiques",
    syntax: "MAX(nombre1; [nombre2]; …)",
    description: "Plus grande valeur.",
    min: 1,
    max: 255,
    impl: (args) => {
      const numbers = collectNumbers(args);
      return numbers.length > 0 ? Math.max(...numbers) : 0;
    },
  },
  {
    name: "COUNT",
    fr: "NB",
    category: "Statistiques",
    syntax: "NB(valeur1; [valeur2]; …)",
    description: "Compte les nombres.",
    min: 0,
    max: 255,
    impl: (args) => collectNumbers(args).length,
  },
  {
    name: "COUNTA",
    fr: "NBVAL",
    category: "Statistiques",
    syntax: "NBVAL(valeur1; [valeur2]; …)",
    description: "Compte les cellules non vides.",
    min: 1,
    max: 255,
    impl: (args) => flatten(args).filter((value) => value !== null && value !== "").length,
  },
  {
    name: "COUNTBLANK",
    fr: "NB.VIDE",
    category: "Statistiques",
    syntax: "NB.VIDE(plage)",
    description: "Compte les cellules vides.",
    min: 1,
    max: 1,
    impl: (args) =>
      cellsOf(matrixOf(args[0])).filter((value) => value === null || value === "").length,
  },
  {
    name: "COUNTIF",
    fr: "NB.SI",
    category: "Statistiques",
    syntax: "NB.SI(plage; critère)",
    description: "Compte les cellules qui remplissent un critère.",
    min: 2,
    max: 2,
    impl: (args) => {
      const criterion = scalarOf(args[1]?.value() ?? null);
      return cellsOf(matrixOf(args[0])).filter((cell) => matchesCriterion(cell, criterion)).length;
    },
  },
  {
    name: "COUNTIFS",
    fr: "NB.SI.ENS",
    category: "Statistiques",
    syntax: "NB.SI.ENS(plage1; critère1; …)",
    description: "Compte les cellules qui remplissent plusieurs critères.",
    min: 2,
    max: 254,
    impl: (args) => {
      const size = cellsOf(matrixOf(args[0])).length;
      return criteriaMask(args, size).filter(Boolean).length;
    },
  },
  {
    name: "AVERAGEIF",
    fr: "MOYENNE.SI",
    category: "Statistiques",
    syntax: "MOYENNE.SI(plage; critère; [plage_moyenne])",
    description: "Moyenne des cellules qui remplissent un critère.",
    min: 2,
    max: 3,
    impl: (args) => {
      const range = cellsOf(matrixOf(args[0]));
      const criterion = scalarOf(args[1]?.value() ?? null);
      const target = args[2] ? cellsOf(matrixOf(args[2])) : range;
      const numbers: number[] = [];
      range.forEach((cell, index) => {
        const value = target[index];
        if (matchesCriterion(cell, criterion) && typeof value === "number") numbers.push(value);
      });
      if (numbers.length === 0) throw new FormulaError("#DIV/0", "Aucune valeur retenue.");
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    },
  },
  {
    name: "MEDIAN",
    fr: "MEDIANE",
    category: "Statistiques",
    syntax: "MEDIANE(nombre1; [nombre2]; …)",
    description: "Valeur médiane.",
    min: 1,
    max: 255,
    impl: (args) => {
      const numbers = collectNumbers(args).sort((a, b) => a - b);
      if (numbers.length === 0) throw new FormulaError("#NUM!", "Aucune valeur.");
      const middle = Math.floor(numbers.length / 2);
      return numbers.length % 2 === 1
        ? (numbers[middle] ?? 0)
        : ((numbers[middle - 1] ?? 0) + (numbers[middle] ?? 0)) / 2;
    },
  },
  {
    name: "STDEV",
    fr: "ECARTYPE",
    aliases: ["STDEV.S", "ECARTYPE.STANDARD"],
    category: "Statistiques",
    syntax: "ECARTYPE(nombre1; [nombre2]; …)",
    description: "Écart type d'un échantillon.",
    min: 1,
    max: 255,
    impl: (args) => Math.sqrt(sample(collectNumbers(args)).variance),
  },
  {
    name: "VAR",
    fr: "VAR",
    aliases: ["VAR.S"],
    category: "Statistiques",
    syntax: "VAR(nombre1; [nombre2]; …)",
    description: "Variance d'un échantillon.",
    min: 1,
    max: 255,
    impl: (args) => sample(collectNumbers(args)).variance,
  },
  {
    name: "LARGE",
    fr: "GRANDE.VALEUR",
    category: "Statistiques",
    syntax: "GRANDE.VALEUR(matrice; k)",
    description: "k-ième plus grande valeur.",
    min: 2,
    max: 2,
    impl: (args) => {
      const numbers = collectNumbers([args[0] as Arg]).sort((a, b) => b - a);
      const k = Math.trunc(num(args[1]));
      const value = numbers[k - 1];
      if (k < 1 || value === undefined) throw new FormulaError("#NUM!", "Rang hors limites.");
      return value;
    },
  },
  {
    name: "SMALL",
    fr: "PETITE.VALEUR",
    category: "Statistiques",
    syntax: "PETITE.VALEUR(matrice; k)",
    description: "k-ième plus petite valeur.",
    min: 2,
    max: 2,
    impl: (args) => {
      const numbers = collectNumbers([args[0] as Arg]).sort((a, b) => a - b);
      const k = Math.trunc(num(args[1]));
      const value = numbers[k - 1];
      if (k < 1 || value === undefined) throw new FormulaError("#NUM!", "Rang hors limites.");
      return value;
    },
  },
  // --- Logique -----------------------------------------------------------
  {
    name: "IF",
    fr: "SI",
    category: "Logique",
    syntax: "SI(test; valeur_si_vrai; [valeur_si_faux])",
    description: "Renvoie une valeur selon une condition.",
    min: 2,
    max: 3,
    impl: (args) => {
      const condition = bool(args[0], false);
      if (condition) return scalarOf(args[1]?.value() ?? null);
      return args[2] ? scalarOf(args[2].value()) : false;
    },
  },
  {
    name: "IFS",
    fr: "SI.CONDITIONS",
    category: "Logique",
    syntax: "SI.CONDITIONS(test1; valeur1; [test2; valeur2]; …)",
    description: "Première valeur dont la condition est vraie.",
    min: 2,
    max: 254,
    impl: (args) => {
      for (let index = 0; index + 1 < args.length; index += 2) {
        if (bool(args[index], false)) return scalarOf(args[index + 1]?.value() ?? null);
      }
      return notFound();
    },
  },
  {
    name: "AND",
    fr: "ET",
    category: "Logique",
    syntax: "ET(logique1; [logique2]; …)",
    description: "VRAI si toutes les conditions sont vraies.",
    min: 1,
    max: 255,
    impl: (args) =>
      flatten(args).every((value) => {
        if (value instanceof FormulaError) throw value;
        return value === null || toBoolean(value);
      }),
  },
  {
    name: "OR",
    fr: "OU",
    category: "Logique",
    syntax: "OU(logique1; [logique2]; …)",
    description: "VRAI si au moins une condition est vraie.",
    min: 1,
    max: 255,
    impl: (args) =>
      flatten(args).some((value) => {
        if (value instanceof FormulaError) throw value;
        return value !== null && toBoolean(value);
      }),
  },
  {
    name: "XOR",
    fr: "OUX",
    category: "Logique",
    syntax: "OUX(logique1; [logique2]; …)",
    description: "VRAI si un nombre impair de conditions sont vraies.",
    min: 1,
    max: 255,
    impl: (args) =>
      flatten(args).filter((value) => {
        if (value instanceof FormulaError) throw value;
        return value !== null && toBoolean(value);
      }).length %
        2 ===
      1,
  },
  {
    name: "NOT",
    fr: "NON",
    category: "Logique",
    syntax: "NON(logique)",
    description: "Inverse une valeur logique.",
    min: 1,
    max: 1,
    impl: (args) => !bool(args[0], false),
  },
  {
    name: "IFERROR",
    fr: "SIERREUR",
    category: "Logique",
    syntax: "SIERREUR(valeur; valeur_si_erreur)",
    description: "Remplace une erreur par une autre valeur.",
    min: 2,
    max: 2,
    impl: (args) => {
      try {
        return scalarOf(args[0]?.value() ?? null);
      } catch (error) {
        if (!(error instanceof FormulaError) || error.code === "#CYCLE") throw error;
        return scalarOf(args[1]?.value() ?? null);
      }
    },
  },
  {
    name: "IFNA",
    fr: "SI.NON.DISP",
    category: "Logique",
    syntax: "SI.NON.DISP(valeur; valeur_si_na)",
    description: "Remplace #N/A par une autre valeur.",
    min: 2,
    max: 2,
    impl: (args) => {
      try {
        return scalarOf(args[0]?.value() ?? null);
      } catch (error) {
        if (error instanceof FormulaError && error.code === "#N/A") {
          return scalarOf(args[1]?.value() ?? null);
        }
        throw error;
      }
    },
  },
  {
    name: "TRUE",
    fr: "VRAI",
    category: "Logique",
    syntax: "VRAI()",
    description: "La valeur logique VRAI.",
    min: 0,
    max: 0,
    impl: () => true,
  },
  {
    name: "FALSE",
    fr: "FAUX",
    category: "Logique",
    syntax: "FAUX()",
    description: "La valeur logique FAUX.",
    min: 0,
    max: 0,
    impl: () => false,
  },
  {
    name: "CHOOSE",
    fr: "CHOISIR",
    category: "Logique",
    syntax: "CHOISIR(index; valeur1; [valeur2]; …)",
    description: "Valeur à la position indiquée.",
    min: 2,
    max: 255,
    impl: (args) => {
      const index = Math.trunc(num(args[0]));
      const chosen = args[index];
      if (index < 1 || !chosen) throw new FormulaError("#ERREUR", "Index hors limites.");
      return scalarOf(chosen.value());
    },
  },
  // --- Information -------------------------------------------------------
  {
    name: "ISBLANK",
    fr: "ESTVIDE",
    category: "Information",
    syntax: "ESTVIDE(valeur)",
    description: "VRAI si la cellule est vide.",
    min: 1,
    max: 1,
    impl: (args) => scalarOf(args[0]?.value() ?? null) === null,
  },
  {
    name: "ISNUMBER",
    fr: "ESTNUM",
    category: "Information",
    syntax: "ESTNUM(valeur)",
    description: "VRAI si la valeur est un nombre.",
    min: 1,
    max: 1,
    impl: (args) => {
      try {
        return typeof scalarOf(args[0]?.value() ?? null) === "number";
      } catch {
        return false;
      }
    },
  },
  {
    name: "ISTEXT",
    fr: "ESTTEXTE",
    category: "Information",
    syntax: "ESTTEXTE(valeur)",
    description: "VRAI si la valeur est du texte.",
    min: 1,
    max: 1,
    impl: (args) => {
      try {
        return typeof scalarOf(args[0]?.value() ?? null) === "string";
      } catch {
        return false;
      }
    },
  },
  {
    name: "ISERROR",
    fr: "ESTERREUR",
    category: "Information",
    syntax: "ESTERREUR(valeur)",
    description: "VRAI si la valeur est une erreur.",
    min: 1,
    max: 1,
    impl: (args) => {
      try {
        scalarOf(args[0]?.value() ?? null);
        return false;
      } catch (error) {
        return error instanceof FormulaError;
      }
    },
  },
  {
    name: "ISNA",
    fr: "ESTNA",
    category: "Information",
    syntax: "ESTNA(valeur)",
    description: "VRAI si la valeur est #N/A.",
    min: 1,
    max: 1,
    impl: (args) => {
      try {
        scalarOf(args[0]?.value() ?? null);
        return false;
      } catch (error) {
        return error instanceof FormulaError && error.code === "#N/A";
      }
    },
  },
  {
    name: "NA",
    fr: "NA",
    category: "Information",
    syntax: "NA()",
    description: "Renvoie l'erreur #N/A.",
    min: 0,
    max: 0,
    impl: () => notFound(),
  },
  // --- Texte -------------------------------------------------------------
  {
    name: "CONCAT",
    fr: "CONCAT",
    aliases: ["CONCATENATE", "CONCATENER"],
    category: "Texte",
    syntax: "CONCAT(texte1; [texte2]; …)",
    description: "Assemble des textes et des plages.",
    min: 1,
    max: 255,
    impl: (args) => {
      const joined = flatten(args)
        .map((value) => {
          if (value instanceof FormulaError) throw value;
          return toText(value);
        })
        .join("");
      if (joined.length > MAX_TEXT_LENGTH) throw new FormulaError("#ERREUR", "Texte trop long.");
      return joined;
    },
  },
  {
    name: "TEXTJOIN",
    fr: "JOINDRE.TEXTE",
    category: "Texte",
    syntax: "JOINDRE.TEXTE(séparateur; ignorer_vides; texte1; …)",
    description: "Assemble des textes avec un séparateur.",
    min: 3,
    max: 255,
    impl: (args) => {
      const separator = text(args[0]);
      const ignoreEmpty = bool(args[1], true);
      const parts = flatten(args.slice(2))
        .map((value) => {
          if (value instanceof FormulaError) throw value;
          return toText(value);
        })
        .filter((part) => !ignoreEmpty || part !== "");
      return parts.join(separator);
    },
  },
  {
    name: "LEN",
    fr: "NBCAR",
    category: "Texte",
    syntax: "NBCAR(texte)",
    description: "Nombre de caractères.",
    min: 1,
    max: 1,
    impl: (args) => text(args[0]).length,
  },
  {
    name: "LEFT",
    fr: "GAUCHE",
    category: "Texte",
    syntax: "GAUCHE(texte; [nb_car])",
    description: "Premiers caractères.",
    min: 1,
    max: 2,
    impl: (args) => text(args[0]).slice(0, Math.max(0, Math.trunc(num(args[1], 1)))),
  },
  {
    name: "RIGHT",
    fr: "DROITE",
    category: "Texte",
    syntax: "DROITE(texte; [nb_car])",
    description: "Derniers caractères.",
    min: 1,
    max: 2,
    impl: (args) => {
      const count = Math.max(0, Math.trunc(num(args[1], 1)));
      const value = text(args[0]);
      return count === 0 ? "" : value.slice(-count);
    },
  },
  {
    name: "MID",
    fr: "STXT",
    category: "Texte",
    syntax: "STXT(texte; début; nb_car)",
    description: "Caractères à partir d'une position.",
    min: 3,
    max: 3,
    impl: (args) => {
      const start = Math.trunc(num(args[1]));
      const count = Math.trunc(num(args[2]));
      if (start < 1 || count < 0) throw new FormulaError("#ERREUR", "Position invalide.");
      return text(args[0]).substr(start - 1, count);
    },
  },
  {
    name: "UPPER",
    fr: "MAJUSCULE",
    category: "Texte",
    syntax: "MAJUSCULE(texte)",
    description: "Met en majuscules.",
    min: 1,
    max: 1,
    impl: (args) => text(args[0]).toLocaleUpperCase("fr-FR"),
  },
  {
    name: "LOWER",
    fr: "MINUSCULE",
    category: "Texte",
    syntax: "MINUSCULE(texte)",
    description: "Met en minuscules.",
    min: 1,
    max: 1,
    impl: (args) => text(args[0]).toLocaleLowerCase("fr-FR"),
  },
  {
    name: "PROPER",
    fr: "NOMPROPRE",
    category: "Texte",
    syntax: "NOMPROPRE(texte)",
    description: "Majuscule à chaque mot.",
    min: 1,
    max: 1,
    impl: (args) =>
      text(args[0])
        .toLocaleLowerCase("fr-FR")
        .replace(
          /(^|[^\p{L}])(\p{L})/gu,
          (_, before: string, letter: string) => `${before}${letter.toLocaleUpperCase("fr-FR")}`,
        ),
  },
  {
    name: "TRIM",
    fr: "SUPPRESPACE",
    category: "Texte",
    syntax: "SUPPRESPACE(texte)",
    description: "Supprime les espaces superflus.",
    min: 1,
    max: 1,
    impl: (args) => text(args[0]).trim().replace(/ {2,}/g, " "),
  },
  {
    name: "SUBSTITUTE",
    fr: "SUBSTITUE",
    category: "Texte",
    syntax: "SUBSTITUE(texte; ancien; nouveau; [occurrence])",
    description: "Remplace un texte par un autre.",
    min: 3,
    max: 4,
    impl: (args) => {
      const source = text(args[0]);
      const search = text(args[1]);
      const replacement = text(args[2]);
      if (search === "") return source;
      if (!args[3]) return source.split(search).join(replacement);
      const occurrence = Math.trunc(num(args[3]));
      let index = -1;
      for (let count = 0; count < occurrence; count += 1) {
        index = source.indexOf(search, index + 1);
        if (index < 0) return source;
      }
      return source.slice(0, index) + replacement + source.slice(index + search.length);
    },
  },
  {
    name: "REPLACE",
    fr: "REMPLACER",
    category: "Texte",
    syntax: "REMPLACER(texte; début; nb_car; nouveau)",
    description: "Remplace des caractères à une position.",
    min: 4,
    max: 4,
    impl: (args) => {
      const source = text(args[0]);
      const start = Math.trunc(num(args[1]));
      const count = Math.trunc(num(args[2]));
      if (start < 1 || count < 0) throw new FormulaError("#ERREUR", "Position invalide.");
      return source.slice(0, start - 1) + text(args[3]) + source.slice(start - 1 + count);
    },
  },
  {
    name: "FIND",
    fr: "TROUVE",
    category: "Texte",
    syntax: "TROUVE(texte_cherché; texte; [début])",
    description: "Position d'un texte (respecte la casse).",
    min: 2,
    max: 3,
    impl: (args) => {
      const index = text(args[1]).indexOf(text(args[0]), Math.trunc(num(args[2], 1)) - 1);
      if (index < 0) throw new FormulaError("#ERREUR", "Texte introuvable.");
      return index + 1;
    },
  },
  {
    name: "SEARCH",
    fr: "CHERCHE",
    category: "Texte",
    syntax: "CHERCHE(texte_cherché; texte; [début])",
    description: "Position d'un texte (ignore la casse).",
    min: 2,
    max: 3,
    impl: (args) => {
      const index = text(args[1])
        .toLocaleLowerCase("fr-FR")
        .indexOf(text(args[0]).toLocaleLowerCase("fr-FR"), Math.trunc(num(args[2], 1)) - 1);
      if (index < 0) throw new FormulaError("#ERREUR", "Texte introuvable.");
      return index + 1;
    },
  },
  {
    name: "VALUE",
    fr: "CNUM",
    category: "Texte",
    syntax: "CNUM(texte)",
    description: "Convertit un texte en nombre.",
    min: 1,
    max: 1,
    impl: (args) => toNumber(text(args[0])),
  },
  {
    name: "TEXT",
    fr: "TEXTE",
    category: "Texte",
    syntax: 'TEXTE(valeur; "format")',
    description: "Met en forme un nombre (« 0,00 », « 0 % », « jj/mm/aaaa »).",
    min: 2,
    max: 2,
    impl: (args) => formatWithPattern(num(args[0]), text(args[1])),
  },
  {
    name: "REPT",
    fr: "REPT",
    category: "Texte",
    syntax: "REPT(texte; nombre)",
    description: "Répète un texte.",
    min: 2,
    max: 2,
    impl: (args) => {
      const value = text(args[0]);
      const count = Math.trunc(num(args[1]));
      if (count < 0 || value.length * count > MAX_TEXT_LENGTH) {
        throw new FormulaError("#ERREUR", "Répétition invalide.");
      }
      return value.repeat(count);
    },
  },
  {
    name: "EXACT",
    fr: "EXACT",
    category: "Texte",
    syntax: "EXACT(texte1; texte2)",
    description: "VRAI si deux textes sont identiques (casse comprise).",
    min: 2,
    max: 2,
    impl: (args) => text(args[0]) === text(args[1]),
  },
  // --- Dates -------------------------------------------------------------
  {
    name: "TODAY",
    fr: "AUJOURDHUI",
    category: "Date",
    syntax: "AUJOURDHUI()",
    description: "Date du jour (numéro de série).",
    min: 0,
    max: 0,
    impl: (_, ctx) => {
      const now = ctx.now();
      return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
    },
  },
  {
    name: "NOW",
    fr: "MAINTENANT",
    category: "Date",
    syntax: "MAINTENANT()",
    description: "Date et heure actuelles (numéro de série).",
    min: 0,
    max: 0,
    impl: (_, ctx) => {
      const now = ctx.now();
      const day = dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      return day + seconds / 86_400;
    },
  },
  {
    name: "DATE",
    fr: "DATE",
    category: "Date",
    syntax: "DATE(année; mois; jour)",
    description: "Numéro de série d'une date.",
    min: 3,
    max: 3,
    impl: (args) => {
      const serial = dateToSerial(
        Math.trunc(num(args[0])),
        Math.trunc(num(args[1])),
        Math.trunc(num(args[2])),
      );
      if (!Number.isFinite(serial) || serial < 0) throw new FormulaError("#NUM!", "Date invalide.");
      return serial;
    },
  },
  {
    name: "YEAR",
    fr: "ANNEE",
    category: "Date",
    syntax: "ANNEE(date)",
    description: "Année d'une date.",
    min: 1,
    max: 1,
    impl: (args) => dateParts(args[0]).getUTCFullYear(),
  },
  {
    name: "MONTH",
    fr: "MOIS",
    category: "Date",
    syntax: "MOIS(date)",
    description: "Mois d'une date (1 à 12).",
    min: 1,
    max: 1,
    impl: (args) => dateParts(args[0]).getUTCMonth() + 1,
  },
  {
    name: "DAY",
    fr: "JOUR",
    category: "Date",
    syntax: "JOUR(date)",
    description: "Jour du mois d'une date.",
    min: 1,
    max: 1,
    impl: (args) => dateParts(args[0]).getUTCDate(),
  },
  {
    name: "WEEKDAY",
    fr: "JOURSEM",
    category: "Date",
    syntax: "JOURSEM(date; [type])",
    description: "Jour de la semaine (1 = dimanche, ou 1 = lundi avec le type 2).",
    min: 1,
    max: 2,
    impl: (args) => {
      const day = dateParts(args[0]).getUTCDay();
      const type = Math.trunc(num(args[1], 1));
      if (type === 2) return day === 0 ? 7 : day;
      if (type === 3) return day === 0 ? 6 : day - 1;
      return day + 1;
    },
  },
  {
    name: "DAYS",
    fr: "JOURS",
    category: "Date",
    syntax: "JOURS(date_fin; date_début)",
    description: "Nombre de jours entre deux dates.",
    min: 2,
    max: 2,
    impl: (args) => Math.trunc(num(args[0])) - Math.trunc(num(args[1])),
  },
  {
    name: "EDATE",
    fr: "MOIS.DECALER",
    category: "Date",
    syntax: "MOIS.DECALER(date; mois)",
    description: "Date décalée d'un nombre de mois.",
    min: 2,
    max: 2,
    impl: (args) => {
      const date = dateParts(args[0]);
      const months = Math.trunc(num(args[1]));
      const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      return dateToSerial(
        target.getUTCFullYear(),
        target.getUTCMonth() + 1,
        Math.min(date.getUTCDate(), lastDay),
      );
    },
  },
  {
    name: "EOMONTH",
    fr: "FIN.MOIS",
    category: "Date",
    syntax: "FIN.MOIS(date; mois)",
    description: "Dernier jour du mois, décalé d'un nombre de mois.",
    min: 2,
    max: 2,
    impl: (args) => {
      const date = dateParts(args[0]);
      const months = Math.trunc(num(args[1]));
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0));
      return dateToSerial(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate());
    },
  },
  // --- Recherche ---------------------------------------------------------
  {
    name: "VLOOKUP",
    fr: "RECHERCHEV",
    category: "Recherche",
    syntax: "RECHERCHEV(valeur; table; no_colonne; [approchée])",
    description: "Cherche dans la première colonne et renvoie une colonne de la ligne.",
    min: 3,
    max: 4,
    impl: (args) => {
      const needle = scalarOf(args[0]?.value() ?? null);
      const table = matrixOf(args[1]);
      const column = Math.trunc(num(args[2]));
      if (column < 1 || column > (table.rows[0]?.length ?? 0)) {
        throw new FormulaError("#REF!", "Colonne hors de la table.");
      }
      const approximate = bool(args[3], true);
      const index = lookupIndex(
        needle,
        table.rows.map((row) => row[0] ?? null),
        approximate ? "approx" : "exact",
      );
      if (index < 0) return notFound();
      const value = table.rows[index]?.[column - 1] ?? null;
      if (value instanceof FormulaError) throw value;
      return value;
    },
  },
  {
    name: "HLOOKUP",
    fr: "RECHERCHEH",
    category: "Recherche",
    syntax: "RECHERCHEH(valeur; table; no_ligne; [approchée])",
    description: "Cherche dans la première ligne et renvoie une ligne de la colonne.",
    min: 3,
    max: 4,
    impl: (args) => {
      const needle = scalarOf(args[0]?.value() ?? null);
      const table = matrixOf(args[1]);
      const rowNumber = Math.trunc(num(args[2]));
      if (rowNumber < 1 || rowNumber > table.rows.length) {
        throw new FormulaError("#REF!", "Ligne hors de la table.");
      }
      const approximate = bool(args[3], true);
      const index = lookupIndex(needle, table.rows[0] ?? [], approximate ? "approx" : "exact");
      if (index < 0) return notFound();
      const value = table.rows[rowNumber - 1]?.[index] ?? null;
      if (value instanceof FormulaError) throw value;
      return value;
    },
  },
  {
    name: "XLOOKUP",
    fr: "RECHERCHEX",
    category: "Recherche",
    syntax: "RECHERCHEX(valeur; plage_recherche; plage_résultat; [si_absent])",
    description: "Recherche exacte, renvoie la valeur correspondante.",
    min: 3,
    max: 4,
    impl: (args) => {
      const needle = scalarOf(args[0]?.value() ?? null);
      const lookup = cellsOf(matrixOf(args[1]));
      const results = cellsOf(matrixOf(args[2]));
      const index = lookupIndex(needle, lookup, "exact");
      if (index < 0) {
        if (args[3]) return scalarOf(args[3].value());
        return notFound();
      }
      const value = results[index] ?? null;
      if (value instanceof FormulaError) throw value;
      return value;
    },
  },
  {
    name: "MATCH",
    fr: "EQUIV",
    category: "Recherche",
    syntax: "EQUIV(valeur; plage; [type])",
    description: "Position d'une valeur dans une plage (0 = exacte).",
    min: 2,
    max: 3,
    impl: (args) => {
      const needle = scalarOf(args[0]?.value() ?? null);
      const values = cellsOf(matrixOf(args[1]));
      const type = Math.trunc(num(args[2], 1));
      const index = lookupIndex(needle, values, type === 0 ? "exact" : "approx");
      if (index < 0) return notFound();
      return index + 1;
    },
  },
  {
    name: "INDEX",
    fr: "INDEX",
    category: "Recherche",
    syntax: "INDEX(plage; no_ligne; [no_colonne])",
    description: "Valeur à l'intersection d'une ligne et d'une colonne.",
    min: 2,
    max: 3,
    impl: (args) => {
      const table = matrixOf(args[0]);
      let row = Math.trunc(num(args[1]));
      let col = Math.trunc(num(args[2], 1));
      // Plage d'une seule ligne : le premier index désigne la colonne.
      if (table.rows.length === 1 && !args[2]) {
        col = row;
        row = 1;
      }
      const value = table.rows[row - 1]?.[col - 1];
      if (value === undefined || row < 1 || col < 1) {
        throw new FormulaError("#REF!", "Index hors de la plage.");
      }
      if (value instanceof FormulaError) throw value;
      return value;
    },
  },
  {
    name: "ROWS",
    fr: "LIGNES",
    category: "Recherche",
    syntax: "LIGNES(plage)",
    description: "Nombre de lignes d'une plage.",
    min: 1,
    max: 1,
    impl: (args) => matrixOf(args[0]).rows.length,
  },
  {
    name: "COLUMNS",
    fr: "COLONNES",
    category: "Recherche",
    syntax: "COLONNES(plage)",
    description: "Nombre de colonnes d'une plage.",
    min: 1,
    max: 1,
    impl: (args) => matrixOf(args[0]).rows[0]?.length ?? 0,
  },
  {
    name: "ROW",
    fr: "LIGNE",
    category: "Recherche",
    syntax: "LIGNE(référence)",
    description: "Numéro de ligne d'une référence.",
    min: 1,
    max: 1,
    impl: (args) => {
      const node = args[0]?.node;
      if (node?.type === "ref" || node?.type === "range") {
        return (node.type === "ref" ? node.row : node.startRow) + 1;
      }
      throw new FormulaError("#ERREUR", "Référence attendue.");
    },
  },
  {
    name: "COLUMN",
    fr: "COLONNE",
    category: "Recherche",
    syntax: "COLONNE(référence)",
    description: "Numéro de colonne d'une référence.",
    min: 1,
    max: 1,
    impl: (args) => {
      const node = args[0]?.node;
      if (node?.type === "ref") return node.col + 1;
      if (node?.type === "range") return node.startCol + 1;
      throw new FormulaError("#ERREUR", "Référence attendue.");
    },
  },
];

/** Index nom → définition (anglais, français, alias). */
const FUNCTION_INDEX = new Map<string, FunctionDef>();
for (const definition of FUNCTIONS) {
  FUNCTION_INDEX.set(definition.name, definition);
  FUNCTION_INDEX.set(definition.fr, definition);
  for (const alias of definition.aliases ?? []) FUNCTION_INDEX.set(alias, definition);
}

/** Catalogue public (aide, autocomplétion) : une entrée par fonction. */
export const FORMULA_FUNCTIONS: readonly FormulaFunctionInfo[] = FUNCTIONS.map(
  ({ name, fr, category, syntax, description }) => ({ name, fr, category, syntax, description }),
);

/** Définition d'une fonction par l'un de ses noms (casse indifférente). */
export function findFormulaFunction(name: string): FormulaFunctionInfo | null {
  const definition = FUNCTION_INDEX.get(name.toUpperCase());
  if (!definition) return null;
  const { fr, category, syntax, description } = definition;
  return { name: definition.name, fr, category, syntax, description };
}

function callFunction(name: string, nodes: Node[], ctx: Context): Value {
  const definition = FUNCTION_INDEX.get(name);
  if (!definition) throw new FormulaError("#NOM?", `Fonction inconnue : ${name}.`);
  if (nodes.length < definition.min || nodes.length > definition.max) {
    throw new FormulaError("#ERREUR", `Nombre d'arguments invalide pour ${definition.fr}.`);
  }
  const args: Arg[] = nodes.map((node) => {
    let cached: { value: Value } | null = null;
    return {
      node,
      value: () => {
        if (!cached) cached = { value: evaluateNode(node, ctx) };
        return cached.value;
      },
    };
  });
  return definition.impl(args, ctx);
}

// ---------------------------------------------------------------------------
// Évaluation de la feuille
// ---------------------------------------------------------------------------

/** Valeur d'une saisie qui n'est pas une formule. */
function literalValue(raw: string): CellValue {
  if (raw.trim() === "") return { kind: "text", value: "" };
  const number = parseCellLiteral(raw);
  if (number === null) {
    const upper = raw.trim().toUpperCase();
    if (upper === "VRAI" || upper === "TRUE") return { kind: "boolean", value: true };
    if (upper === "FAUX" || upper === "FALSE") return { kind: "boolean", value: false };
    return { kind: "text", value: raw };
  }
  if (!Number.isFinite(number)) return { kind: "error", code: "#NUM!" };
  return { kind: "number", value: number };
}

function resultOf(value: Value): CellValue {
  const scalar = isMatrix(value) ? (value.rows[0]?.[0] ?? null) : value;
  if (scalar instanceof FormulaError) return { kind: "error", code: scalar.code };
  if (scalar === null) return { kind: "number", value: 0 };
  if (typeof scalar === "number") {
    return Number.isFinite(scalar)
      ? { kind: "number", value: scalar }
      : { kind: "error", code: "#NUM!" };
  }
  if (typeof scalar === "boolean") return { kind: "boolean", value: scalar };
  return { kind: "text", value: scalar };
}

/**
 * Options d'évaluation : horloge injectable (tests) et autres onglets du
 * classeur, par nom, pour les références `Feuil2!A1`.
 */
export type EvaluateOptions = {
  now?: () => Date;
  /** Cellules brutes des autres onglets (clé = nom de l'onglet, casse libre). */
  sheets?: Record<string, CellMap>;
  /** Nom de l'onglet évalué : `Feuil1!A1` depuis Feuil1 vise ses propres cellules. */
  sheetName?: string;
};

/** Nom d'onglet comparable (casse et espaces de bord ignorés, comme Excel). */
export function sheetKey(name: string): string {
  return name.trim().toLocaleUpperCase("fr");
}

type SheetData = { cells: CellMap; maxRow: number };

function normalizeSheet(cells: CellMap): SheetData {
  const normalized: CellMap = {};
  let maxRow = 0;
  for (const [key, raw] of Object.entries(cells)) {
    const upper = key.toUpperCase();
    normalized[upper] = raw;
    const position = parseKey(upper);
    if (position && position.row > maxRow) maxRow = position.row;
  }
  return { cells: normalized, maxRow };
}

/**
 * Évalue toutes les cellules : `Map` référence → valeur calculée.
 * Détecte les cycles (#CYCLE, y compris entre onglets), la division par zéro
 * (#DIV/0), les débordements (#NUM!), les onglets inconnus (#REF!), les plages
 * abusives et les erreurs de syntaxe (#ERREUR).
 */
export function evaluateCells(
  cells: CellMap,
  options: EvaluateOptions = {},
): Map<string, CellValue> {
  const CURRENT = "\u0000";
  const book = new Map<string, SheetData>();
  for (const [name, sheetCells] of Object.entries(options.sheets ?? {})) {
    book.set(sheetKey(name), normalizeSheet(sheetCells));
  }
  const current = normalizeSheet(cells);
  book.set(CURRENT, current);
  if (options.sheetName) book.set(sheetKey(options.sheetName), current);
  const resolve = (sheet: string | undefined, from: string): string | null => {
    if (sheet === undefined) return from;
    const key = sheetKey(sheet);
    if (options.sheetName && key === sheetKey(options.sheetName)) return CURRENT;
    return book.has(key) ? key : null;
  };

  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();
  let depth = 0;
  const now = options.now ?? (() => new Date());
  const contexts = new Map<string, Context>();

  const contextOf = (sheetId: string): Context => {
    const existing = contexts.get(sheetId);
    if (existing) return existing;
    const context: Context = {
      read: (row, col, sheet) => {
        const target = resolve(sheet, sheetId);
        if (target === null) return new FormulaError("#REF!", "Onglet inconnu.");
        return cellValueToScalar(evaluate(target, cellKey(row, col)));
      },
      maxRowOf: (sheet) => {
        const target = resolve(sheet, sheetId);
        if (target === null) throw new FormulaError("#REF!", "Onglet inconnu.");
        return book.get(target)?.maxRow ?? 0;
      },
      now,
    };
    contexts.set(sheetId, context);
    return context;
  };

  const evaluate = (sheetId: string, key: string): CellValue => {
    const cacheKey = `${sheetId}!${key}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    if (visiting.has(cacheKey)) return { kind: "error", code: "#CYCLE" };
    if (depth >= MAX_EVAL_DEPTH) return { kind: "error", code: "#ERREUR" };

    visiting.add(cacheKey);
    depth += 1;
    const raw = book.get(sheetId)?.cells[key] ?? "";
    let result: CellValue;
    try {
      if (raw.startsWith("=")) {
        try {
          const tree = new Parser(tokenize(raw.slice(1))).parse();
          result = resultOf(evaluateNode(tree, contextOf(sheetId)));
        } catch (error) {
          result = { kind: "error", code: errorCode(error) };
        }
      } else {
        result = literalValue(raw);
      }
    } finally {
      visiting.delete(cacheKey);
      depth -= 1;
    }

    cache.set(cacheKey, result);
    return result;
  };

  const evaluated = new Map<string, CellValue>();
  for (const key of Object.keys(current.cells)) evaluated.set(key, evaluate(CURRENT, key));
  return evaluated;
}

/** Nom d'onglet tel qu'il s'écrit dans une formule (guillemets simples si besoin). */
export function quoteSheetName(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && parseKey(name.toUpperCase()) === null
    ? name
    : `'${name.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Décalage des références (recopie, collage) et aide à la saisie
// ---------------------------------------------------------------------------

/**
 * Décale les références relatives d'une formule, comme Excel lors d'une
 * recopie ou d'un collage : `A1` → `B2` pour (+1, +1), `$A$1` ne bouge pas,
 * `A$1` ne décale que la colonne. Une référence qui sortirait de la feuille
 * devient `#REF!`. Les chaînes entre guillemets ne sont jamais touchées.
 */
export function shiftFormula(formula: string, rowDelta: number, colDelta: number): string {
  if (!formula.startsWith("=") || (rowDelta === 0 && colDelta === 0)) return formula;
  let output = "";
  let index = 0;
  const source = formula;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1);
      const stop = end < 0 ? source.length : end + 1;
      output += source.slice(index, stop);
      index = stop;
      continue;
    }
    const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_.(])/.exec(source.slice(index));
    const previous = source[index - 1] ?? "";
    if (match && !/[A-Za-z0-9_.]/.test(previous)) {
      const [whole, colAbs, letters = "", rowAbs, digits = ""] = match;
      const col = columnIndex(letters);
      const row = Number(digits) - 1;
      if (col === null) {
        output += whole;
        index += whole.length;
        continue;
      }
      const nextCol = colAbs ? col : col + colDelta;
      const nextRow = rowAbs ? row : row + rowDelta;
      if (nextCol < 0 || nextRow < 0 || nextCol > MAX_COL_INDEX || nextRow > MAX_ROW_INDEX) {
        output += "#REF!";
      } else {
        output += `${colAbs}${columnLabel(nextCol)}${rowAbs}${nextRow + 1}`;
      }
      index += whole.length;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

/**
 * Fonction en cours de saisie à la fin d'une formule (« =SOM » → « SOM ») pour
 * l'autocomplétion ; `null` hors formule ou au milieu d'une chaîne.
 */
export function formulaTokenAtEnd(input: string): string | null {
  if (!input.startsWith("=")) return null;
  const quotes = (input.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) return null;
  const match = /(?:^=|[=(,;+\-*/^&<>\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(input);
  if (!match?.[1]) return null;
  // Une référence complète (A1, AB12) n'appelle pas de suggestion.
  if (/^[A-Za-z]{1,3}\d+$/.test(match[1])) return null;
  return match[1].toUpperCase();
}

/** Suggestions de fonctions pour un préfixe (noms français d'abord). */
export function suggestFunctions(prefix: string, limit = 8): FormulaFunctionInfo[] {
  const upper = prefix.toUpperCase();
  if (upper.length === 0) return [];
  const french = FORMULA_FUNCTIONS.filter((fn) => fn.fr.startsWith(upper));
  const english = FORMULA_FUNCTIONS.filter(
    (fn) => !fn.fr.startsWith(upper) && fn.name.startsWith(upper),
  );
  return [...french, ...english].slice(0, limit);
}

/**
 * Fonction dont on saisit les arguments (curseur en fin de formule) :
 * « =SI(A1>2; » → SI, pour afficher sa syntaxe sous la cellule.
 */
export function activeFunctionCall(input: string): FormulaFunctionInfo | null {
  if (!input.startsWith("=")) return null;
  let depth = 0;
  let inString = false;
  for (let index = input.length - 1; index >= 1; index -= 1) {
    const char = input[index];
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === ")") depth += 1;
    else if (char === "(") {
      if (depth === 0) {
        const name = /([A-Za-z][A-Za-z0-9.]*)$/.exec(input.slice(0, index))?.[1];
        return name ? findFormulaFunction(name) : null;
      }
      depth -= 1;
    }
  }
  return null;
}
