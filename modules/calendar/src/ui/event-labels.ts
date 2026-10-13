/**
 * Libellés et formats français des événements : heures, récurrences, réponses
 * d'invités et plage affichée dans le détail. Tout est pur (test/event-labels.test.ts).
 */

import type { Recurrence } from "../server.ts";
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

/** Statuts d'invitation affichés dans le détail et la liste des invités. */
export const ATTENDANCE_LABELS: Record<string, string> = {
  invited: "Invité",
  accepted: "A accepté",
  declined: "A refusé",
};

/** Heure locale d'un instant ISO, au format français « 09:05 ». */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Événement réduit à ce que la plage affichée doit connaître. */
type RangeLike = { startsAt: string; endsAt: string; allDay: boolean };

/**
 * Plage affichée dans le détail d'un événement :
 * « Mardi 13 octobre 2026 · 09:00 – 10:00 » ou
 * « Mardi 13 octobre 2026 · journée entière ».
 *
 * Une journée entière est lue sur son préfixe UTC puis reformatée en date
 * locale : le jour affiché est celui stocké, quel que soit le fuseau du
 * lecteur.
 */
export function formatEventRange(event: RangeLike): string {
  const startsAt = new Date(event.startsAt);
  const day = event.allDay ? (parseDateInput(event.startsAt.slice(0, 10)) ?? startsAt) : startsAt;
  const dayLabel = formatDayTitle(day);
  return event.allDay
    ? `${dayLabel} · journée entière`
    : `${dayLabel} · ${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`;
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
