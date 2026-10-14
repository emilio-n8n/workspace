/**
 * Grilles de dates : mini calendrier, regroupement des événements par jour et
 * navigation clavier dans une grille rectangulaire.
 *
 * Fonctions pures (test/date-grid.test.ts) : l'interface se contente de rendre
 * le résultat.
 */

import { browserTimeZone, zonedDayKey } from "./timezone.ts";
import { addDays, startOfWeek } from "./view-state.ts";

/** Nombre de semaines affichées par le mini calendrier. */
export const MINI_CALENDAR_WEEKS = 6;

/** Nombre de colonnes d'une grille de jours (une par jour de semaine). */
export const GRID_COLUMNS = 7;

/** Libellés courts des jours de la semaine, du lundi au dimanche. */
export const WEEKDAY_LABELS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

/** Libellés longs des jours de la semaine, du lundi au dimanche. */
export const WEEKDAY_NAMES = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

/** Événement réduit à ce que le découpage par jour doit connaître. */
export type DayEventLike = {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

/** Clé de jour locale (`aaaa-mm-jj`) utilisée pour regrouper. */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Jour auquel un événement est rattaché. Un événement « journée entière » est
 * stocké en minuit UTC : sa clé est le préfixe de l'instant, quel que soit le
 * fuseau d'affichage (c'est une date, pas un instant). Un événement horaire est
 * rattaché au jour de son début **dans le fuseau d'affichage** : un événement
 * à 23:30 UTC appartient au lendemain à Paris.
 */
export function eventDayKey(event: DayEventLike, zone: string = browserTimeZone()): string {
  return event.allDay ? event.startsAt.slice(0, 10) : zonedDayKey(event.startsAt, zone);
}

/**
 * Regroupe les événements par jour, triés par heure de début puis par durée
 * décroissante (un événement plus long passe avant un plus court qui commence
 * à la même heure). Les événements « journée entière » restent en tête de leur
 * journée.
 */
export function groupEventsByDay<T extends DayEventLike>(
  events: T[],
  zone?: string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const event of events) {
    const key = eventDayKey(event, zone);
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      const startDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      if (startDiff !== 0) return startDiff;
      // Même début : le plus long d'abord, pour une lecture stable.
      return new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime();
    });
  }
  return map;
}

/** Événements d'un seul jour, déjà triés par `groupEventsByDay`. */
export function eventsOfDay<T extends DayEventLike>(
  events: T[],
  day: Date,
  zone?: string,
): { key: string; list: T[] } {
  const key = dateKey(day);
  return { key, list: groupEventsByDay(events, zone).get(key) ?? [] };
}

/** Ensemble des jours portant au moins un événement (pastilles du mini calendrier). */
export function daysWithEvents(events: DayEventLike[], zone?: string): Set<string> {
  return new Set(events.map((event) => eventDayKey(event, zone)));
}

/** `true` si le jour porte au moins un événement. */
export function dayHasEvents(events: DayEventLike[], day: Date, zone?: string): boolean {
  return daysWithEvents(events, zone).has(dateKey(day));
}

/**
 * Jours du mini calendrier : six semaines entières couvrant le mois de `month`,
 * du lundi de la première semaine au dimanche de la sixième (une taille fixe
 * évite que la grille sautille d'un mois à l'autre).
 */
export function miniCalendarDays(month: Date): Date[] {
  return daysFromWeek(startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1)));
}

/** Six semaines entières à partir du lundi de la semaine de `date`. */
export function daysFromWeek(monday: Date): Date[] {
  const start = startOfWeek(monday);
  return Array.from({ length: MINI_CALENDAR_WEEKS * GRID_COLUMNS }, (_, index) =>
    addDays(start, index),
  );
}

/** Mêmes jours, découpés en semaines (une par ligne de la grille). */
export function miniCalendarWeeks(month: Date): Date[][] {
  const days = miniCalendarDays(month);
  const weeks: Date[][] = [];
  for (let index = 0; index < days.length; index += GRID_COLUMNS) {
    weeks.push(days.slice(index, index + GRID_COLUMNS));
  }
  return weeks;
}

/**
 * Nombre d'événements affichés sous le numéro du jour dans la grille du mois.
 * Au-delà, la vue résume par « +N autre(s) ».
 */
export function visibleEventsPerDay(list: unknown[]): number {
  return Math.min(list.length, 3);
}

/** Texte du résumé « +N autre(s) » d'une case de mois. */
export function overflowLabel(count: number): string {
  return `+${count} autre(s)`;
}

// ---------------------------------------------------------------------------
// Navigation clavier dans une grille
// ---------------------------------------------------------------------------

/**
 * Index cible d'un déplacement clavier dans une grille de `total` cases et
 * `columns` colonnes. Renvoie `null` quand la touche ne déplace pas le focus
 * (l'appelant laisse alors le navigateur traiter l'évènement).
 *
 * Touches gérées : flèches (bord à bord, sans retour à la ligne en début et
 * fin de grille), Début / Fin (première et dernière case), Page haut / Page
 * bas (une grille complète, mois précédent / suivant).
 */
export function nextGridIndex(
  current: number,
  columns: number,
  total: number,
  key: string,
): number | null {
  const row = Math.floor(current / columns);
  const lastRow = gridRows(total, columns) - 1;
  switch (key) {
    case "ArrowRight":
      return current + 1 < total ? current + 1 : null;
    case "ArrowLeft":
      return current - 1 >= 0 ? current - 1 : null;
    case "ArrowDown":
      return row < lastRow ? current + columns : null;
    case "ArrowUp":
      return row > 0 ? current - columns : null;
    case "Home":
      return row * columns;
    case "End":
      return Math.min(row * columns + columns - 1, total - 1);
    case "PageDown":
      return Math.min(current + gridPageStep(columns, total), total - 1);
    case "PageUp":
      return Math.max(current - gridPageStep(columns, total), 0);
    default:
      return null;
  }
}

/** Nombre de lignes d'une grille de `total` cases et `columns` colonnes. */
export function gridRows(total: number, columns: number): number {
  return Math.ceil(total / columns);
}

/** Pas de navigation d'une grille complète (mois précédent / suivant). */
export function gridPageStep(columns: number, total: number): number {
  return columns * gridRows(total, columns);
}
