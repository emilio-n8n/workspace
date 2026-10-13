/**
 * Vocabulaire et règles des questions de formulaire.
 *
 * Logique pure — aucune dépendance à la base, au réseau ni à React — pour
 * rester testable et partagée entre le service, l'API et l'interface.
 */

/** Types de questions proposés par le constructeur et acceptés par l'API. */
export const FORM_KINDS = [
  "short_text",
  "long_text",
  "choice",
  "checkbox",
  "scale",
  "date",
  "yes_no",
] as const;

export type FormKind = (typeof FORM_KINDS)[number];

/** Libellé de chaque type, tel qu'affiché dans l'interface. */
export const KIND_LABELS: Record<FormKind, string> = {
  short_text: "Texte court",
  long_text: "Texte long",
  choice: "Choix unique",
  checkbox: "Cases à cocher",
  scale: "Échelle 1 à 5",
  date: "Date",
  yes_no: "Oui / Non",
};

/** Ce que le type attend comme réponse (aide affichée dans le constructeur). */
export const KIND_HINTS: Record<FormKind, string> = {
  short_text: "Une seule ligne : nom, adresse, numéro…",
  long_text: "Plusieurs lignes : avis, commentaire…",
  choice: "Une seule réponse possible.",
  checkbox: "Plusieurs réponses possibles.",
  scale: "Une note de 1 à 5.",
  date: "Une date choisie dans le calendrier.",
  yes_no: "Deux réponses possibles : Oui ou Non.",
};

/** Un type porte-t-il une liste d'options (choix et cases à cocher) ? */
export function kindHasOptions(kind: FormKind): boolean {
  return kind === "choice" || kind === "checkbox";
}

/** Bornes de l'échelle, incluses. */
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

/** Valeurs de l'échelle, dans l'ordre croissant. */
export const SCALE_VALUES: readonly string[] = Array.from(
  { length: SCALE_MAX - SCALE_MIN + 1 },
  (_, offset) => String(SCALE_MIN + offset),
);

/** Réponses fermées d'une question « Oui / Non ». */
export const YES_NO_OPTIONS = ["Oui", "Non"] as const;

export type YesNoValue = (typeof YES_NO_OPTIONS)[number];

/** Longueur maximale d'une réponse libre, en caractères. */
export const MAX_ANSWER_CHARS = 5000;

/** Format d'une date acceptée dans les réponses : AAAA-MM-JJ. */
export const DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return lengths[month - 1] ?? 0;
}

/**
 * Vrai pour une date du calendrier grégorien écrite AAAA-MM-JJ. Les années
 * 0000, les mois 00 ou 13 et les jours absents du mois (30 février, 31 avril)
 * sont refusés, contrairement à `new Date("2026-02-30")` qui décalerait
 * silencieusement la date.
 */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  if (year < 1) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Vrai si la valeur fait partie des réponses fermées « Oui » / « Non ». */
export function isYesNoValue(value: string): boolean {
  return (YES_NO_OPTIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Validation des réponses
// ---------------------------------------------------------------------------

/** Ce qu'une question garantit, vu par la validation. */
export type AnswerableQuestion = {
  /** Clé de la réponse dans le tableau envoyé ; absente pour un brouillon. */
  id?: string;
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
};

/**
 * Résultat d'une validation : soit la valeur à enregistrer (absente quand la
 * réponse est vide et facultative), soit le message à afficher.
 */
export type AnswerOutcome =
  | { ok: true; value: string | string[] | undefined }
  | { ok: false; message: string };

function messageObligatoire(label: string): string {
  return `« ${label} » est obligatoire.`;
}

function messageInvalide(label: string): string {
  return `Réponse invalide pour « ${label} ».`;
}

function messageTropLongue(label: string): string {
  return `Réponse trop longue pour « ${label} ».`;
}

function messageDateInvalide(label: string): string {
  return `« ${label} » attend une date valide au format JJ/MM/AAAA.`;
}

function messageOuiNonInvalide(label: string): string {
  return `« ${label} » attend la réponse « Oui » ou « Non ».`;
}

/**
 * Valide et nettoie une réponse avant enregistrement. Aucune coercition de
 * type : une valeur non textuelle compte comme une absence de réponse, et
 * l'échelle refuse « 03 », « 3.0 » ou « 3 » encadré d'espaces.
 */
export function validateAnswer(question: AnswerableQuestion, raw: unknown): AnswerOutcome {
  if (question.kind === "checkbox") {
    const candidates = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    // Déduplication en conservant l'ordre de première occurrence.
    const values: string[] = [];
    for (const candidate of candidates) {
      const value = String(candidate).trim();
      if (value.length === 0 || values.includes(value)) continue;
      values.push(value);
    }
    for (const value of values) {
      if (!question.options.includes(value)) {
        return { ok: false, message: messageInvalide(question.label) };
      }
    }
    if (question.required && values.length === 0) {
      return { ok: false, message: messageObligatoire(question.label) };
    }
    return { ok: true, value: values.length > 0 ? values : undefined };
  }

  const rawValue = typeof raw === "string" ? raw : "";

  if (question.kind === "scale") {
    if (rawValue.length === 0) {
      if (question.required) return { ok: false, message: messageObligatoire(question.label) };
      return { ok: true, value: undefined };
    }
    if (!SCALE_VALUES.includes(rawValue)) {
      return { ok: false, message: messageInvalide(question.label) };
    }
    return { ok: true, value: rawValue };
  }

  const value = rawValue.trim();
  if (question.required && value.length === 0) {
    return { ok: false, message: messageObligatoire(question.label) };
  }
  if (value.length === 0) return { ok: true, value: undefined };
  if (value.length > MAX_ANSWER_CHARS) {
    return { ok: false, message: messageTropLongue(question.label) };
  }
  if (question.kind === "date" && !isCalendarDate(value)) {
    return { ok: false, message: messageDateInvalide(question.label) };
  }
  if (question.kind === "yes_no" && !isYesNoValue(value)) {
    return { ok: false, message: messageOuiNonInvalide(question.label) };
  }
  if (question.kind === "choice" && !question.options.includes(value)) {
    return { ok: false, message: messageInvalide(question.label) };
  }
  return { ok: true, value };
}

/** Applique `validateAnswer` à toutes les questions, dans l'ordre reçu. */
export function validateAnswers(
  questions: readonly AnswerableQuestion[],
  answers: Record<string, unknown>,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const question of questions) {
    // La clé de réponse est l'identifiant de la question ; les questions sans
    // identifiant (brouillon d'interface) sont ignorées.
    if (question.id === undefined) continue;
    const outcome = validateAnswer(question, answers[question.id]);
    if (!outcome.ok) throw new Error(outcome.message);
    if (outcome.value !== undefined) result[question.id] = outcome.value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Manipulation de la liste des questions
// ---------------------------------------------------------------------------

/**
 * Décale une question d'un cran. Renvoie `null` quand le déplacement est
 * impossible (bornes atteintes ou index hors liste) : l'appelant n'a rien à
 * filtrer et peut se contenter d'ignorer l'appel.
 */
export function moveQuestion<T>(
  questions: readonly T[],
  index: number,
  direction: -1 | 1,
): T[] | null {
  if (index < 0 || index >= questions.length) return null;
  const target = index + direction;
  if (target < 0 || target >= questions.length) return null;
  const next = [...questions];
  const [item] = next.splice(index, 1);
  if (item === undefined) return null;
  next.splice(target, 0, item);
  return next;
}

/**
 * Duplique la question à `index` et insère la copie juste après l'originale.
 * `copy` produit le nouveau brouillon (identifiant serveur retiré, intitulé
 * annoté) — `null` si l'index est hors liste.
 */
export function duplicateQuestion<T>(
  questions: readonly T[],
  index: number,
  copy: (question: T) => T,
): T[] | null {
  if (index < 0 || index >= questions.length) return null;
  const source = questions[index];
  if (source === undefined) return null;
  const next = [...questions];
  next.splice(index + 1, 0, copy(source));
  return next;
}

/** Ce qu'il faut pour annuler la suppression d'une question. */
export type RemovedQuestion<T> = {
  questions: T[];
  removed: T;
  index: number;
};

/**
 * Retire une question et conserve sa place (`index`) pour une annulation.
 * `null` si l'index est hors liste.
 */
export function removeQuestion<T>(
  questions: readonly T[],
  index: number,
): RemovedQuestion<T> | null {
  if (index < 0 || index >= questions.length) return null;
  const next = [...questions];
  const [removed] = next.splice(index, 1);
  if (removed === undefined) return null;
  return { questions: next, removed, index };
}

/** Remet une question retirée à sa place d'origine (annulation). */
export function insertQuestion<T>(questions: readonly T[], index: number, question: T): T[] {
  const next = [...questions];
  const position = Math.min(Math.max(index, 0), next.length);
  next.splice(position, 0, question);
  return next;
}
