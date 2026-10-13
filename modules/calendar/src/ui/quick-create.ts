/**
 * Création rapide d'événement : brouillon, analyse d'une saisie en langage
 * naturel, validation et conversion en plage horaire.
 *
 * Tout est pur et testé (test/quick-create.test.ts) — les composants se
 * contentent d'appeler ces fonctions.
 */

import { addDays, parseDateInput, startOfDay } from "./view-state.ts";

/** Brouillon de création rapide, avant envoi au serveur. */
export type QuickDraft = {
  title: string;
  /** Date locale `aaaa-mm-jj`. */
  date: string;
  /** Heure locale `hh:mm`. */
  startTime: string;
  endTime: string;
  allDay: boolean;
};

/** Durée par défaut d'un événement créé rapidement (minutes). */
export const DEFAULT_DURATION_MINUTES = 60;

/** Durée minimale imposée entre le début et la fin (minutes). */
export const MIN_DURATION_MINUTES = 1;

/** Séparateurs acceptés entre deux adresses e-mail. */
const EMAIL_SPLIT = /[,;\s]+/;

/** `9h`, `9h30`, `9 heures 30`, `14:00`. */
const TIME_TOKEN = /\b(\d{1,2})\s*(?:h(?:eures?)?)\s*(\d{2})?\b|\b(\d{1,2}):(\d{2})\b/gi;

/** Séparateurs tolérés entre deux heures : « 9h à 10h », « 9h-10h ». */
const RANGE_GAP = /^\s*(?:-|–|—|à|a|au|jusqu'?à|to)\s*$/i;

/** Mots-clés de date et décalage en jours (« demain » → +1). */
const DATE_KEYWORDS: { pattern: RegExp; offset: number }[] = [
  { pattern: /aujourd['’]?hui/i, offset: 0 },
  { pattern: /apr[èe]s[-\s]?demain/i, offset: 2 },
  { pattern: /demain/i, offset: 1 },
];

/** Noms des jours de la semaine, index 0 = lundi. */
const WEEKDAYS: { pattern: RegExp; weekday: number }[] = [
  { pattern: /lundi\b/i, weekday: 0 },
  { pattern: /mardi\b/i, weekday: 1 },
  { pattern: /mercredi\b/i, weekday: 2 },
  { pattern: /jeudi\b/i, weekday: 3 },
  { pattern: /vendredi\b/i, weekday: 4 },
  { pattern: /samedi\b/i, weekday: 5 },
  { pattern: /dimanche\b/i, weekday: 6 },
];

/** Date locale `aaaa-mm-jj`. */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Heure locale `hh:mm`. */
export function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Prochain quart d'heure (une heure ronde reste inchangée). */
export function nextQuarterHour(date: Date): Date {
  return roundUp(date, 15);
}

/** Prochaine demi-heure : arrondi par défaut des créations rapides. */
export function nextHalfHour(date: Date): Date {
  return roundUp(date, 30);
}

function roundUp(date: Date, step: number): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const minutes = copy.getMinutes();
  copy.setMinutes(minutes + ((step - (minutes % step)) % step));
  return copy;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Brouillon par défaut pour un jour : démarrage à la prochaine demi-heure et
 * durée d'une heure. La date du jour est conservée telle quelle.
 */
export function defaultQuickDraft(date: Date, now: Date = new Date()): QuickDraft {
  const start = nextHalfHour(now);
  return {
    title: "",
    date: toDateInput(date),
    startTime: toTimeInput(start),
    endTime: toTimeInput(addMinutes(start, DEFAULT_DURATION_MINUTES)),
    allDay: false,
  };
}

/** Sépare une liste d'invités saisie librement (virgule, point-virgule, espace). */
export function splitEmails(input: string): string[] {
  return input
    .split(EMAIL_SPLIT)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Lit une heure `hh:mm` en minutes depuis minuit ; `null` si invalide. */
export function parseTimeInput(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes depuis minuit → `hh:mm`. */
export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/** `true` si la chaîne est une date locale valide (`aaaa-mm-jj` existante). */
function isDateInput(value: string): boolean {
  return parseDateInput(value) !== null;
}

/**
 * Valide un brouillon. Renvoie le message d'erreur en français, ou `null` si
 * le brouillon peut être enregistré.
 */
export function validateQuickDraft(draft: QuickDraft): string | null {
  if (draft.title.trim().length === 0) {
    return "Donnez un titre à l'événement.";
  }
  if (!isDateInput(draft.date)) {
    return "Choisissez une date valide.";
  }
  if (draft.allDay) return null;
  const start = parseTimeInput(draft.startTime);
  const end = parseTimeInput(draft.endTime);
  if (start === null || end === null) {
    return "Les heures doivent être au format hh:mm.";
  }
  if (end - start < MIN_DURATION_MINUTES) {
    return "La fin doit être après le début.";
  }
  return null;
}

/**
 * Plage horaire d'un brouillon, prête pour l'API.
 *
 * Un événement horaire est construit en heure locale ; un événement
 * « journée entière » est ramené aux minuits UTC du jour et du lendemain, comme
 * le fait le service (DATE seule).
 */
export function quickDraftRange(draft: QuickDraft): {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
} {
  if (draft.allDay) {
    const day = parseDateInput(draft.date) ?? startOfDay(new Date());
    const start = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 86_400_000).toISOString(),
      allDay: true,
    };
  }
  return {
    startsAt: new Date(`${draft.date}T${draft.startTime}:00`).toISOString(),
    endsAt: new Date(`${draft.date}T${draft.endTime}:00`).toISOString(),
    allDay: false,
  };
}

// ---------------------------------------------------------------------------
// Analyse d'une saisie en langage naturel
// ---------------------------------------------------------------------------

type Span = { start: number; end: number };

/** Retire les extraits reconnus et normalise les espaces restants. */
function withoutSpans(text: string, spans: Span[]): string {
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let rest = text;
  for (const span of ordered) {
    rest = rest.slice(0, span.start) + rest.slice(span.end);
  }
  return rest.replace(/\s+/g, " ").trim();
}

type TimeMatch = { span: Span; minutes: number };

/** Heures reconnues, dans l'ordre d'apparition. */
function findTimes(text: string): TimeMatch[] {
  const found: TimeMatch[] = [];
  for (const match of text.matchAll(TIME_TOKEN)) {
    if (match.index === undefined) continue;
    // Deux formes : « 9h30 » (groupes 1-2) ou « 09:30 » (groupes 3-4).
    const colon = match[3] !== undefined;
    const hours = Number(colon ? match[3] : match[1]);
    const minutes = Number(colon ? match[4] : (match[2] ?? 0));
    if (hours > 23 || minutes > 59) continue;
    found.push({
      span: { start: match.index, end: match.index + match[0].length },
      minutes: hours * 60 + minutes,
    });
  }
  return found;
}

type ParsedTimes = { start: number; end: number; spans: Span[] };

/**
 * Premier couple d'heures reconnu. Toutes les heures reconnues quittent le
 * titre (un « 17h » oublié au milieu d'une phrase reste du bruit), mais seul
 * un second compte directement collé au premier (« 9h-10h », « 9h à 10h »)
 * sert de fin : sans ce garde-fou, un titre comme « Stand-up 9h puis rétro
 * 17h » serait lu comme une plage de huit heures.
 */
function parseTimes(text: string): ParsedTimes | null {
  const times = findTimes(text);
  const first = times[0];
  if (!first) return null;
  const spans = times.map((time) => time.span);
  let end = first.minutes + DEFAULT_DURATION_MINUTES;
  const second = times[1];
  if (second) {
    const gapStart = first.span.end;
    const gapEnd = second.span.start;
    const between = text.slice(gapStart, gapEnd);
    if (between.length <= 12 && RANGE_GAP.test(between) && second.minutes > first.minutes) {
      end = second.minutes;
      // Le séparateur (« à », « - ») est retiré du titre en même temps.
      spans.push({ start: gapStart, end: gapEnd });
    }
  }
  return { start: first.minutes, end, spans };
}

type ParsedDate = { day: Date; spans: Span[] };

/**
 * Date reconnue dans la saisie : mot-clé (« aujourd'hui », « demain »), jour de
 * semaine (« jeudi », « lundi prochain ») ou forme numérique (« 13/10 »,
 * « 13/10/2026 »).
 */
function parseDateToken(text: string, now: Date): ParsedDate | null {
  const today = startOfDay(now);

  for (const keyword of DATE_KEYWORDS) {
    const match = keyword.pattern.exec(text);
    if (match && match.index !== undefined) {
      return {
        day: addDays(today, keyword.offset),
        spans: [{ start: match.index, end: match.index + match[0].length }],
      };
    }
  }

  for (const entry of WEEKDAYS) {
    const match = entry.pattern.exec(text);
    if (!match || match.index === undefined) continue;
    // Occurrence visée : aujourd'hui si le jour nommé est le jour courant,
    // sinon la prochaine fois que ce jour arrive.
    const todayIndex = (now.getDay() + 6) % 7; // 0 = lundi
    const offsetDays = (entry.weekday - todayIndex + 7) % 7;
    // « lundi prochain » : le lundi de la semaine suivante. Un jour encore à
    // venir cette semaine est donc décalé de sept jours ; un jour déjà passé
    // cette semaine tombe déjà la semaine prochaine (convention française).
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
    const next = /^\s*prochaine?\b/i.exec(after);
    const extra = next !== null && entry.weekday >= todayIndex ? 7 : 0;
    const end = match.index + match[0].length + (next?.[0].length ?? 0);
    return { day: addDays(today, offsetDays + extra), spans: [{ start: match.index, end }] };
  }

  // Forme numérique jj/mm ou jj/mm/aaaa.
  for (const match of text.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?\b/g)) {
    if (match.index === undefined) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] !== undefined ? Number(match[3]) : now.getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) continue;
    // Une date déjà passée dans l'année est lue sur l'année suivante.
    const resolved =
      match[3] !== undefined || candidate.getTime() >= today.getTime()
        ? candidate
        : new Date(year + 1, month - 1, day);
    return {
      day: resolved,
      spans: [{ start: match.index, end: match.index + match[0].length }],
    };
  }

  return null;
}

/**
 * Analyse une saisie en langage naturel et renvoie un brouillon prêt à
 * compléter : le titre est ce qui reste une fois la date et les heures
 * retirées. Sans date ni heure reconnue, le jour courant et les horaires par
 * défaut s'appliquent.
 *
 * Exemples : « Point d'équipe demain 9h », « Revue 14:30 à 15:30 aujourd'hui »,
 * « Cours jeudi 8h30 », « Atelier 13/10 9h-11h ».
 */
export function parseQuickInput(input: string, now: Date = new Date()): QuickDraft {
  const text = input.trim();
  const times = parseTimes(text);
  const date = parseDateToken(text, now);

  const spans: Span[] = [...(times?.spans ?? []), ...(date?.spans ?? [])];
  const day = date?.day ?? startOfDay(now);

  const defaultStart = nextHalfHour(now);
  const startMinutes = times?.start ?? defaultStart.getHours() * 60 + defaultStart.getMinutes();
  const endMinutes = times?.end ?? startMinutes + DEFAULT_DURATION_MINUTES;

  return {
    title: withoutSpans(text, spans),
    date: toDateInput(day),
    startTime: minutesToTime(startMinutes),
    endTime: minutesToTime(endMinutes),
    allDay: false,
  };
}
