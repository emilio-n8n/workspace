/**
 * Libellés et formats français des événements : heures, récurrences, réponses
 * d'invités et plage affichée dans le détail. Tout est pur (test/event-labels.test.ts).
 */

import type { Recurrence } from "../server.ts";
import { browserTimeZone, formatDayInZone, formatTimeInZone, zonedDate } from "./timezone.ts";
import { formatDayMonth, formatDayTitle, parseDateInput } from "./view-state.ts";

/** Récurrences proposées, dans l'ordre du menu. */
export const RECURRENCE_OPTIONS: Recurrence[] = ["none", "daily", "weekly", "monthly"];

/** Libellés de récurrence affichés dans l'éditeur et le détail. */
export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "Aucune",
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
};

/**
 * Unité affichée après l'intervalle de répétition (« Toutes les 2 semaines »).
 * Singulier quand l'intervalle vaut 1, mois invariable.
 */
export function recurrenceUnitLabel(recurrence: Recurrence, interval: number): string {
  const singular = interval <= 1;
  switch (recurrence) {
    case "daily":
      return singular ? "jour" : "jours";
    case "weekly":
      return singular ? "semaine" : "semaines";
    case "monthly":
      return "mois";
    default:
      return "";
  }
}

/** Statuts d'invitation affichés dans le détail et la liste des invités. */
export const ATTENDANCE_LABELS: Record<string, string> = {
  invited: "Invité",
  accepted: "A accepté",
  declined: "A refusé",
};

/** Heure locale d'un instant ISO, au format français « 09:05 ». */
export function formatTime(iso: string, zone: string = browserTimeZone()): string {
  return formatTimeInZone(iso, zone);
}

/** Événement réduit à ce que la plage affichée doit connaître. */
type RangeLike = { startsAt: string; endsAt: string; allDay: boolean };

/**
 * Plage affichée dans le détail d'un événement :
 * « Mardi 13 octobre 2026 · 09:00 – 10:00 » ou
 * « Mardi 13 octobre 2026 · journée entière ».
 *
 * Un événement horaire est affiché dans le fuseau choisi ; un événement
 * « journée entière » est une date (minuit UTC), affichée telle quelle quel que
 * soit le fuseau du lecteur.
 */
export function formatEventRange(event: RangeLike, zone: string = browserTimeZone()): string {
  if (event.allDay) {
    const stored = parseDateInput(event.startsAt.slice(0, 10)) ?? new Date(event.startsAt);
    return `${formatDayTitle(stored)} · journée entière`;
  }
  return `${formatDayInZone(event.startsAt, zone)} · ${formatTime(event.startsAt, zone)} – ${formatTime(event.endsAt, zone)}`;
}

/**
 * Libellé court d'un jour (sans l'année) utilisé dans l'agenda :
 * « Aujourd'hui », « Demain » ou « 20 octobre ».
 */
export function formatAgendaDay(day: Date, now: Date = new Date()): string {
  const isToday =
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    day.getFullYear() === tomorrow.getFullYear() &&
    day.getMonth() === tomorrow.getMonth() &&
    day.getDate() === tomorrow.getDate();
  if (isToday) return "Aujourd'hui";
  if (isTomorrow) return "Demain";
  return formatDayMonth(day);
}

/**
 * Date d'un instant ramenée au fuseau d'affichage, sous forme de date locale :
 * les grilles travaillent ensuite comme si l'utilisateur y était.
 */
export function displayDate(instant: Date | string | number, zone: string): Date {
  return zonedDate(instant, zone);
}

/** Horaires d'un événement : « 09:00 – 10:00 » dans le fuseau d'affichage. */
export function formatEventTimes(event: RangeLike, zone: string = browserTimeZone()): string {
  return `${formatTime(event.startsAt, zone)} – ${formatTime(event.endsAt, zone)}`;
}
