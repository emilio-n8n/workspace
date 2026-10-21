/**
 * Formats de nombre personnalisés, sous-ensemble des codes Excel :
 *
 * - sections `positif;négatif;zéro;texte` (une seule section = tous les nombres) ;
 * - chiffres `0` (obligatoire), `#` (facultatif), `?` (espace), séparateur
 *   décimal `.`, milliers `,` entre deux chiffres, mise à l'échelle par `,`
 *   finale (÷ 1 000 par virgule), pourcentage `%`, scientifique `0.00E+00` ;
 * - dates et heures : `d dd ddd dddd`, `m mm mmm mmmm`, `yy yyyy`, `h hh`,
 *   `mm ss` (minutes après une heure), `AM/PM` ; équivalents français `j jj`
 *   et `aaaa aa` ;
 * - littéraux : `"texte"`, `\x`, `_x` (espace), `*x` (ignoré), `@` (texte saisi),
 *   et tous les symboles usuels (`€ $ - + ( ) : / espace`) ;
 * - couleurs `[Rouge]`, `[Red]`, `[Vert]`… : rendues comme jeton (`tone`).
 *
 * Le rendu suit les conventions françaises (virgule décimale, espace fine
 * insécable pour les milliers), comme les autres formats de la feuille.
 * Logique pure, partagée par la grille, l'import/export .xlsx et les tests.
 */

export const MAX_CUSTOM_FORMAT_LENGTH = 64;

export type FormatTone = "negative" | "positive" | "accent" | null;

export type CustomFormatResult = { text: string; tone: FormatTone };

const GROUP = "\u202f";
const DECIMAL = ",";

const MONTHS = [
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
];
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const COLOR_TONES: Record<string, FormatTone> = {
  RED: "negative",
  ROUGE: "negative",
  GREEN: "positive",
  VERT: "positive",
  BLUE: "accent",
  BLEU: "accent",
};

/** Découpe en sections sur `;` hors guillemets et échappements. */
export function splitSections(pattern: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "\\" && !quoted) {
      current += char + (pattern[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      sections.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  sections.push(current);
  return sections;
}

type Piece =
  | { kind: "literal"; value: string }
  | { kind: "digits"; value: string }
  | { kind: "text" }
  | { kind: "date"; value: string };

/** Retire les blocs `[…]` (couleur, conditions) et renvoie la teinte trouvée. */
function stripBrackets(section: string): { body: string; tone: FormatTone } {
  let tone: FormatTone = null;
  const body = section.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const upper = inner.toUpperCase();
    if (upper in COLOR_TONES) tone = COLOR_TONES[upper] ?? null;
    return "";
  });
  return { body, tone };
}

const DATE_TOKEN =
  /^(yyyy|aaaa|yy|aa|mmmm|mmm|mm|m|dddd|ddd|dd|d|jjjj|jjj|jj|j|hh|h|ss|s|am\/pm|a\/p)/i;

function tokenizeSection(body: string): Piece[] {
  const pieces: Piece[] = [];
  const pushLiteral = (value: string) => {
    const last = pieces[pieces.length - 1];
    if (last?.kind === "literal") last.value += value;
    else pieces.push({ kind: "literal", value });
  };
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === '"') {
      const end = body.indexOf('"', index + 1);
      const stop = end < 0 ? body.length : end;
      pushLiteral(body.slice(index + 1, stop));
      index = stop + 1;
      continue;
    }
    if (char === "\\") {
      pushLiteral(body[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (char === "_") {
      pushLiteral(" ");
      index += 2;
      continue;
    }
    if (char === "*") {
      index += 2;
      continue;
    }
    if (char === "@") {
      pieces.push({ kind: "text" });
      index += 1;
      continue;
    }
    const dateMatch = DATE_TOKEN.exec(body.slice(index));
    if (dateMatch?.[1] && !/[eE]/.test(char)) {
      pieces.push({ kind: "date", value: dateMatch[1] });
      index += dateMatch[1].length;
      continue;
    }
    if (
      "0#?.,%".includes(char) ||
      ((char === "E" || char === "e") && /[+-]/.test(body[index + 1] ?? ""))
    ) {
      let run = "";
      while (index < body.length) {
        const current = body[index] ?? "";
        if ("0#?.,%".includes(current)) {
          run += current;
          index += 1;
        } else if ((current === "E" || current === "e") && /[+-]/.test(body[index + 1] ?? "")) {
          run += `E${body[index + 1]}`;
          index += 2;
        } else if (current === " " && /[0#?]/.test(body[index + 1] ?? "") && /[0#?]$/.test(run)) {
          // « # ##0 » : l'espace sert de séparateur de milliers (usage français).
          run += ",";
          index += 1;
        } else break;
      }
      const last = pieces[pieces.length - 1];
      if (last?.kind === "digits") last.value += run;
      else pieces.push({ kind: "digits", value: run });
      continue;
    }
    pushLiteral(char);
    index += 1;
  }
  return pieces;
}

function groupDigits(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

/**
 * Codes saisis « à la française » (`0,00`, `# ##0,00`) : sans point, une
 * virgule suivie de 1, 2 ou 4+ chiffres est le séparateur décimal (le
 * séparateur de milliers est alors l'espace, déjà converti en `,`… sauf
 * pour celle-ci). `#,##0` (3 chiffres) reste le séparateur de milliers US.
 */
function frenchMaskToUs(mask: string): string {
  if (mask.includes(".")) return mask;
  const match = /,([0#?]+)(E[+-]0+)?$/.exec(mask);
  if (!match?.[1] || match[1].length === 3) return mask;
  return `${mask.slice(0, match.index)}.${match[1]}${match[2] ?? ""}`;
}

/** Applique un masque de chiffres (`#,##0.00`, `0%`, `0.0E+00`) à une valeur positive. */
function formatDigits(value: number, mask: string): string {
  let scaled = value;
  const percentCount = (mask.match(/%/g) ?? []).length;
  scaled *= 100 ** percentCount;
  let core = frenchMaskToUs(mask.replace(/%/g, ""));
  // Virgules finales : mise à l'échelle par milliers.
  const trailing = /,+$/.exec(core.replace(/E[+-].*$/, ""))?.[0].length ?? 0;
  if (trailing > 0) {
    scaled /= 1000 ** trailing;
    core = core.replace(/,+(?=(E[+-].*)?$)/, "");
  }
  const exponentMatch = /E([+-])(0+)$/.exec(core);
  let exponentText = "";
  if (exponentMatch) {
    core = core.slice(0, exponentMatch.index);
    const exponent = scaled === 0 ? 0 : Math.floor(Math.log10(Math.abs(scaled)));
    scaled /= 10 ** exponent;
    const digits = String(Math.abs(exponent)).padStart(exponentMatch[2]?.length ?? 1, "0");
    const sign = exponent < 0 ? "-" : exponentMatch[1] === "+" ? "+" : "";
    exponentText = `E${sign}${digits}`;
  }
  const [intMask = "", fracMask = ""] = core.split(".");
  const grouping = intMask.includes(",");
  const cleanInt = intMask.replace(/,/g, "");
  const decimals = fracMask.length;
  const fixed = scaled.toFixed(decimals);
  let [intPart = "0", fracPart = ""] = fixed.split(".");
  // Partie entière : `0` impose un chiffre, `#` le rend facultatif.
  const minInt = (cleanInt.match(/0/g) ?? []).length;
  if (intPart === "0" && minInt === 0) intPart = "";
  intPart = intPart.padStart(minInt, "0");
  const spaces = (cleanInt.match(/\?/g) ?? []).length;
  if (intPart.length < spaces) intPart = intPart.padStart(spaces, " ");
  if (grouping) intPart = groupDigits(intPart);
  // Partie décimale : les `#` finaux effacent les zéros superflus.
  if (decimals > 0) {
    const required = fracMask.replace(/[#?]+$/, "").length;
    let trimmed = fracPart;
    while (trimmed.length > required && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
    fracPart = trimmed;
  }
  return `${intPart}${fracPart.length > 0 ? DECIMAL + fracPart : ""}${exponentText}`;
}

/** Numéro de série de tableur (jours depuis le 30/12/1899) → date UTC. */
function serialToUtc(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

function formatDatePiece(token: string, date: Date, afterHour: boolean, ampm: boolean): string {
  const lower = token.toLowerCase();
  const hours = date.getUTCHours();
  switch (lower) {
    case "yyyy":
    case "aaaa":
      return String(date.getUTCFullYear());
    case "yy":
    case "aa":
      return String(date.getUTCFullYear()).slice(-2);
    case "mmmm":
      return MONTHS[date.getUTCMonth()] ?? "";
    case "mmm":
      return (MONTHS[date.getUTCMonth()] ?? "").slice(0, 3);
    case "mm":
      return afterHour
        ? String(date.getUTCMinutes()).padStart(2, "0")
        : String(date.getUTCMonth() + 1).padStart(2, "0");
    case "m":
      return afterHour ? String(date.getUTCMinutes()) : String(date.getUTCMonth() + 1);
    case "dddd":
    case "jjjj":
      return DAYS[date.getUTCDay()] ?? "";
    case "ddd":
    case "jjj":
      return (DAYS[date.getUTCDay()] ?? "").slice(0, 3);
    case "dd":
    case "jj":
      return String(date.getUTCDate()).padStart(2, "0");
    case "d":
    case "j":
      return String(date.getUTCDate());
    case "hh":
      return String(ampm ? hours % 12 || 12 : hours).padStart(2, "0");
    case "h":
      return String(ampm ? hours % 12 || 12 : hours);
    case "ss":
      return String(date.getUTCSeconds()).padStart(2, "0");
    case "s":
      return String(date.getUTCSeconds());
    case "am/pm":
      return hours < 12 ? "AM" : "PM";
    case "a/p":
      return hours < 12 ? "A" : "P";
    default:
      return token;
  }
}

/** Choisit la section qui s'applique à un nombre (Excel : pos;nég;zéro;texte). */
function pickSection(
  sections: string[],
  value: number,
): { section: string; negativeSign: boolean } {
  if (sections.length >= 3 && value === 0)
    return { section: sections[2] ?? "", negativeSign: false };
  if (sections.length >= 2 && value < 0) return { section: sections[1] ?? "", negativeSign: false };
  return { section: sections[0] ?? "", negativeSign: value < 0 };
}

/** Vrai quand le code est accepté (longueur bornée, au moins un jeton utile). */
export function isValidCustomFormat(pattern: unknown): pattern is string {
  if (typeof pattern !== "string") return false;
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || pattern.length > MAX_CUSTOM_FORMAT_LENGTH) return false;
  // Caractères de contrôle refusés (un format s'affiche dans la grille).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: filtrage volontaire des caractères de contrôle.
  if (/[\u0000-\u001f\u007f]/.test(pattern)) return false;
  return splitSections(pattern).length <= 4;
}

/**
 * Formate une valeur brute selon un code personnalisé. Un texte non numérique
 * passe par la 4e section (ou `@`) ; sinon il est rendu tel quel.
 */
export function formatCustom(
  raw: string,
  pattern: string,
  number: number | null,
): CustomFormatResult {
  const sections = splitSections(pattern);
  if (number === null) {
    const textSection =
      sections[3] ?? (sections.length === 1 && sections[0]?.includes("@") ? sections[0] : null);
    if (textSection === null || textSection === undefined) return { text: raw, tone: null };
    const { body, tone } = stripBrackets(textSection);
    const text = tokenizeSection(body)
      .map((piece) => (piece.kind === "text" ? raw : piece.kind === "literal" ? piece.value : ""))
      .join("");
    return { text, tone };
  }
  const { section, negativeSign } = pickSection(sections, number);
  const { body, tone } = stripBrackets(section);
  const pieces = tokenizeSection(body);
  const hasDate = pieces.some((piece) => piece.kind === "date");
  const hasDigits = pieces.some((piece) => piece.kind === "digits" && /[0#?]/.test(piece.value));
  if (hasDate && !hasDigits) {
    const date = serialToUtc(number);
    const ampm = pieces.some(
      (piece) => piece.kind === "date" && /^a/i.test(piece.value) && piece.value.includes("/"),
    );
    let afterHour = false;
    const text = pieces
      .map((piece, index) => {
        if (piece.kind === "literal") return piece.value;
        if (piece.kind === "text") return raw;
        if (piece.kind === "digits") return piece.value;
        const lower = piece.value.toLowerCase();
        // « mm » vaut minutes après une heure ou avant des secondes.
        const nextDate = pieces.slice(index + 1).find((next) => next.kind === "date");
        const beforeSeconds = nextDate?.kind === "date" && /^s/i.test(nextDate.value);
        const out = formatDatePiece(
          piece.value,
          date,
          (afterHour || beforeSeconds) && /^m{1,2}$/.test(lower),
          ampm,
        );
        if (/^h/.test(lower)) afterHour = true;
        else if (!/^m{1,2}$/.test(lower) && !/^s/.test(lower)) afterHour = false;
        return out;
      })
      .join("");
    return { text, tone };
  }
  const magnitude = Math.abs(number);
  const digitPieces = pieces.filter((piece) => piece.kind === "digits");
  let text = "";
  let digitsDone = false;
  for (const piece of pieces) {
    if (piece.kind === "literal") text += piece.value;
    else if (piece.kind === "text") text += raw;
    else if (piece.kind === "date") text += piece.value;
    else if (!digitsDone) {
      // Tous les blocs de chiffres forment un seul masque (« 0 000,00 »).
      const mask = digitPieces.map((digits) => digits.value).join("");
      text += formatDigits(magnitude, mask);
      if (mask.includes("%")) text += "%";
      digitsDone = true;
    }
  }
  if (!hasDigits && digitPieces.length === 0) {
    // Section purement littérale (« "néant" ») : rendue telle quelle.
  }
  return { text: negativeSign && hasDigits ? `-${text}` : text, tone };
}

/** Exemples proposés dans le dialogue « Format personnalisé ». */
export const CUSTOM_FORMAT_PRESETS: readonly { pattern: string; label: string }[] = [
  { pattern: "# ##0,00 €", label: "Monnaie (€)" },
  { pattern: "$#,##0.00", label: "Monnaie ($)" },
  { pattern: "0.0%", label: "Pourcentage (1 décimale)" },
  { pattern: "#,##0;[Rouge]-#,##0", label: "Milliers, négatifs en rouge" },
  { pattern: "0.00E+00", label: "Scientifique" },
  { pattern: "dd/mm/yyyy", label: "Date courte" },
  { pattern: "dddd d mmmm yyyy", label: "Date longue" },
  { pattern: "hh:mm", label: "Heure" },
  { pattern: '0" kg"', label: "Unité (kg)" },
];
