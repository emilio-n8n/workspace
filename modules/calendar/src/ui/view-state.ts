/**
 * État de navigation du calendrier : vues Jour / Semaine / Mois / Agenda,
 * déplacement du curseur, plages interrogées et libellés français.
 *
 * Aucune dépendance au DOM ni au stockage : la logique est testée isolément
 * (test/view-state.test.ts) puis consommée par l'interface.
 */

/** Vues disponibles, dans l'ordre des onglets. */
export const VIEW_MODES = ["day", "week", "month", "agenda"] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

/** Vue affichée quand aucune préférence n'est enregistrée. */
export const DEFAULT_VIEW_MODE: ViewMode = "week";

const VIEW_MODE_SET: ReadonlySet<string> = new Set(VIEW_MODES);

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && VIEW_MODE_SET.has(value);
}

/** Libellés courts des onglets de vue. */
export const VIEW_LABELS: Record<ViewMode, string> = {
  day: "Jour",
  week: "Semaine",
  month: "Mois",
  agenda: "Agenda",
};

/** Clé de la préférence de vue dans le stockage local du navigateur. */
export const VIEW_STORAGE_KEY = "workspace.calendar.view";

/**
 * Lit une préférence de vue persistée. Une valeur absente, mal formée ou
 * inconnue retombe sur la vue par défaut : une donnée corrompue ne doit jamais
 * empêcher l'affichage.
 */
export function parseStoredView(raw: string | null | undefined): ViewMode {
  if (typeof raw !== "string") return DEFAULT_VIEW_MODE;
  const value = raw.trim().toLowerCase();
  return isViewMode(value) ? value : DEFAULT_VIEW_MODE;
}

/** Sérialise la préférence de vue pour le stockage local. */
export function serializeView(mode: ViewMode): string {
  return mode;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Nombre de jours couverts par la vue agenda, à partir du curseur. */
export const AGENDA_DAYS = 30;

/** Taille de la grille du mois : 6 semaines de 7 jours. */
export const MONTH_GRID_DAYS = 42;

/** Pas de navigation de la vue agenda (une semaine à la fois). */
export const AGENDA_STEP_DAYS = 7;

const longDayFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayMonthFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const dayMonthYearFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthOnlyFormat = new Intl.DateTimeFormat("fr-FR", { month: "long" });
const monthYearFormat = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  const targetMonth = copy.getMonth() + months;
  const daysInTarget = new Date(copy.getFullYear(), targetMonth + 1, 0).getDate();
  copy.setDate(Math.min(copy.getDate(), daysInTarget));
  copy.setMonth(targetMonth);
  return copy;
}

/** Lundi de la semaine de `date` (semaine calendaire française). */
export function startOfWeek(date: Date): Date {
  const base = startOfDay(date);
  const offset = (base.getDay() + 6) % 7;
  return addDays(base, -offset);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Ajoute `days` jours consécutifs à partir de `from` (liste triée). */
export function daysFrom(from: Date, days: number): Date[] {
  return Array.from({ length: days }, (_, index) => addDays(startOfDay(from), index));
}

/**
 * Lit une date locale `aaaa-mm-jj` (valeur d'un `<input type="date">`).
 * Renvoie `null` si la chaîne est mal formée ou décrit une date inexistante
 * (« 2026-02-30 ») : la date est interprétée en heure locale, sans le décalage
 * UTC qu'introduirait `new Date("2026-10-13")`.
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

/**
 * Décale le curseur d'une période dans la vue courante. La vue agenda avance
 * d'une semaine : la liste suivante chevauche la précédente, sans saut.
 */
export function shiftCursor(cursor: Date, mode: ViewMode, direction: 1 | -1): Date {
  switch (mode) {
    case "day":
      return addDays(cursor, direction);
    case "week":
      return addDays(cursor, (WEEK_MS / DAY_MS) * direction);
    case "month":
      return addMonths(cursor, direction);
    case "agenda":
      return addDays(cursor, AGENDA_STEP_DAYS * direction);
  }
}

/** Plage couverte par une vue : bornes de requête et jours affichés. */
export type ViewRange = {
  /** Borne basse, incluse (minuit local). */
  from: Date;
  /** Borne haute, exclue. */
  to: Date;
  /** Jours affichés par la vue. */
  days: Date[];
};

/**
 * Plage de la vue : la grille du mois dépasse volontairement le mois affiché
 * (six semaines entières) pour que chaque ligne soit complète.
 */
export function rangeFor(mode: ViewMode, cursor: Date): ViewRange {
  switch (mode) {
    case "day": {
      const from = startOfDay(cursor);
      return { from, to: addDays(from, 1), days: [from] };
    }
    case "week": {
      const from = startOfWeek(cursor);
      return { from, to: addDays(from, 7), days: daysFrom(from, 7) };
    }
    case "month": {
      const from = startOfWeek(startOfMonth(cursor));
      return { from, to: addDays(from, MONTH_GRID_DAYS), days: daysFrom(from, MONTH_GRID_DAYS) };
    }
    case "agenda": {
      const from = startOfDay(cursor);
      return { from, to: addDays(from, AGENDA_DAYS), days: daysFrom(from, AGENDA_DAYS) };
    }
  }
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

/** Première lettre en capitale, le reste intact (« mardi » → « Mardi »). */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Date complète lisible : « mardi 13 octobre 2026 ». */
export function formatLongDay(date: Date): string {
  return longDayFormat.format(date);
}

/** Date complète, première lettre capitalisée : « Mardi 13 octobre 2026 ». */
export function formatDayTitle(date: Date): string {
  return capitalize(longDayFormat.format(date));
}

/** « 13 octobre ». */
export function formatDayMonth(date: Date): string {
  return dayMonthFormat.format(date);
}

/** « 5 octobre 2026 », première lettre capitalisée. */
export function formatDayMonthYear(date: Date): string {
  return capitalize(dayMonthYearFormat.format(date));
}

/** « octobre 2026 ». */
export function formatMonthYear(date: Date): string {
  return monthYearFormat.format(date);
}

/** « octobre ». */
export function formatMonthName(date: Date): string {
  return monthOnlyFormat.format(date);
}

/**
 * Intervalle de dates « 12 au 18 octobre 2026 », réduit quand les deux bornes
 * sont dans le même mois (« 29 septembre au 5 octobre 2026 » sinon).
 */
export function formatSpan(from: Date, to: Date): string {
  if (isSameMonth(from, to)) {
    return `${from.getDate()} au ${to.getDate()} ${formatMonthYear(from)}`;
  }
  return `${formatDayMonth(from)} au ${formatDayMonthYear(to)}`;
}

/** Titre de la barre d'en-tête, en français et accordé à la vue. */
export function viewHeading(mode: ViewMode, cursor: Date): string {
  switch (mode) {
    case "day":
      return formatDayTitle(cursor);
    case "week":
      return `Semaine du ${formatSpan(startOfWeek(cursor), addDays(startOfWeek(cursor), 6))}`;
    case "month":
      return capitalize(monthYearFormat.format(cursor));
    case "agenda":
      return `Agenda — du ${formatSpan(startOfDay(cursor), addDays(startOfDay(cursor), AGENDA_DAYS - 1))}`;
  }
}

/**
 * Libellé d'accessibilité d'un jour de la grille : la date complète est
 * nécessaire, le numéro seul n'étant pas prononcé de façon utile.
 */
export function dayCellLabel(date: Date, isToday: boolean): string {
  const base = formatLongDay(date);
  return isToday ? `${base}, aujourd'hui` : base;
}
