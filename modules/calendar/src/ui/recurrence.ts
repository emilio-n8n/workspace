/**
 * Récurrence simple : règle « fréquence + intervalle + jusqu'au », expansion des
 * occurrences et libellés français.
 *
 * Mêmes règles que le service (même ambition, code distinct) : la fréquence
 * porte sur des pas calendaires UTC, le jour est borné au dernier jour du mois
 * court (31 janvier → 28 février → 31 mars), et `until` borne le *début* des
 * occurrences. Tout est pur et testé (test/recurrence.test.ts).
 */

import type { Recurrence } from "../server.ts";
import { addDays, addMonths, formatDayMonthYear, parseDateInput } from "./view-state.ts";

/** Intervalle minimal (une unité de fréquence entre deux occurrences). */
export const INTERVAL_MIN = 1;

/** Intervalle maximal : une année de la fréquence choisie. */
export const INTERVAL_MAX = 52;

/** Fréquences proposées, dans l'ordre du menu. */
export const RECURRENCE_FREQUENCIES: Recurrence[] = ["none", "daily", "weekly", "monthly"];

/** Fréquences actives (tout sauf « aucune »). */
export type ActiveRecurrence = Exclude<Recurrence, "none">;

/** Libellés de fréquence (menu et détail). */
export const RECURRENCE_FREQUENCY_LABELS: Record<Recurrence, string> = {
  none: "Ne pas répéter",
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
};

/** Règle de répétition manipulée par l'interface. */
export type RecurrenceRule = {
  recurrence: Recurrence;
  /** Une occurrence toutes les `interval` unités de fréquence. */
  recurrenceInterval: number;
  /** Dernier jour (inclus) où une occurrence peut démarrer, `aaaa-mm-jj`. */
  recurrenceUntil: string;
};

/** Occurrence développée : bornes de début et de fin. */
export type Occurrence = { startsAt: Date; endsAt: Date };

/** Nombre maximal d'occurrences développées (garde-fou, aligné sur le service). */
const MAX_OCCURRENCES = 100;

/**
 * Plafond de recherche du nombre d'occurrences : le service borne une série à
 * 24 mois, ce qui limite le nombre d'occurrences à quelques centaines.
 */
const MAX_SERIES_OCCURRENCES = 1200;

/** Durée d'une journée en millisecondes. */
const ONE_DAY_MS = 86_400_000;

/** Valide l'intervalle (entier entre 1 et 52) et retombe sur 1 hors bornes. */
export function normalizeInterval(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value)) return INTERVAL_MIN;
  return Math.min(Math.max(value, INTERVAL_MIN), INTERVAL_MAX);
}

/** Règle par défaut : aucune répétition, intervalle inutilisé. */
export function emptyRule(): RecurrenceRule {
  return { recurrence: "none", recurrenceInterval: INTERVAL_MIN, recurrenceUntil: "" };
}

/** Une fréquence est active dès qu'elle n'est pas « aucune ». */
export function isActive(rule: RecurrenceRule): boolean {
  return rule.recurrence !== "none";
}

/**
 * Message d'erreur de la règle, ou `null` si elle est exploitable :
 * une date de fin est exigible dès qu'une fréquence est choisie.
 */
export function validateRule(rule: RecurrenceRule): string | null {
  if (rule.recurrence === "none") return null;
  const until = parseDateInput(rule.recurrenceUntil);
  if (!until) {
    return "Choisissez une date de fin de répétition.";
  }
  return null;
}

/**
 * Développe les occurrences d'un événement dans une plage [`from`, `to`).
 *
 * La première occurrence est l'événement stocké lui-même. Le pas suit la
 * fréquence et l'intervalle ; le mois est borné au dernier jour du mois court.
 * Le résultat est trié et plafonné à 100 occurrences.
 */
export function expandOccurrences(
  event: { startsAt: string; endsAt: string },
  rule: Pick<RecurrenceRule, "recurrence" | "recurrenceInterval" | "recurrenceUntil">,
  from: Date,
  to: Date,
): Occurrence[] {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const durationMs = end.getTime() - start.getTime();
  if (rule.recurrence === "none") {
    return start.getTime() < to.getTime() && end.getTime() > from.getTime()
      ? [{ startsAt: start, endsAt: end }]
      : [];
  }

  const interval = normalizeInterval(rule.recurrenceInterval);
  const until = parseDateInput(rule.recurrenceUntil);
  const untilMs = until ? addDays(until, 1).getTime() : Number.POSITIVE_INFINITY;
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const occurrences: Occurrence[] = [];

  let index = firstIndex(start, rule.recurrence, interval, fromMs - durationMs);
  while (occurrences.length < MAX_OCCURRENCES) {
    const startsAt = occurrenceStart(start, rule.recurrence, interval, index);
    if (startsAt.getTime() >= untilMs || startsAt.getTime() >= toMs) break;
    const endsAt = new Date(startsAt.getTime() + durationMs);
    if (endsAt.getTime() > fromMs) occurrences.push({ startsAt, endsAt });
    index += 1;
  }
  return occurrences;
}

/** Début de la n-ième occurrence (`index` = 0 : l'événement stocké). */
function occurrenceStart(
  base: Date,
  recurrence: Recurrence,
  interval: number,
  index: number,
): Date {
  if (recurrence === "daily") return new Date(base.getTime() + index * interval * ONE_DAY_MS);
  if (recurrence === "weekly") {
    return new Date(base.getTime() + index * interval * 7 * ONE_DAY_MS);
  }
  return addMonths(base, index * interval);
}

/**
 * Première occurrence à examiner pour une plage : l'arithmétique directe évite
 * d'énumérer les occurrences antérieures quand la série a commencé loin.
 */
function firstIndex(
  base: Date,
  recurrence: Recurrence,
  interval: number,
  thresholdMs: number,
): number {
  const baseMs = base.getTime();
  if (baseMs > thresholdMs) return 0;
  if (recurrence === "daily") {
    return Math.floor((thresholdMs - baseMs) / (interval * ONE_DAY_MS)) + 1;
  }
  if (recurrence === "weekly") {
    return Math.floor((thresholdMs - baseMs) / (interval * 7 * ONE_DAY_MS)) + 1;
  }
  const months =
    (new Date(thresholdMs).getUTCFullYear() - base.getUTCFullYear()) * 12 +
    (new Date(thresholdMs).getUTCMonth() - base.getUTCMonth());
  let index = Math.max(0, Math.floor(months / interval));
  while (
    index > 0 &&
    occurrenceStart(base, recurrence, interval, index - 1).getTime() > thresholdMs
  ) {
    index -= 1;
  }
  while (occurrenceStart(base, recurrence, interval, index).getTime() <= thresholdMs) {
    index += 1;
  }
  return index;
}

/** Nombre d'occurrences d'une règle, plafonné à 100 (aligné sur le service). */
export function countOccurrences(
  event: { startsAt: string; endsAt: string },
  rule: Pick<RecurrenceRule, "recurrence" | "recurrenceInterval" | "recurrenceUntil">,
): number {
  if (rule.recurrence === "none") return 1;
  const until = parseDateInput(rule.recurrenceUntil);
  if (!until) return 0;
  const start = new Date(event.startsAt);
  const interval = normalizeInterval(rule.recurrenceInterval);
  // La série est bornée à 2 ans par le service : la borne haute du comptage
  // reste donc faible (731 occurrences au pire pour un pas quotidien).
  const limitMs = addDays(until, 1).getTime();
  let index = 0;
  while (
    index < MAX_SERIES_OCCURRENCES &&
    occurrenceStart(start, rule.recurrence, interval, index).getTime() < limitMs
  ) {
    index += 1;
  }
  return index;
}

/** Résumé français d'une règle : « Toutes les 2 semaines jusqu'au 14 mars 2026 ». */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.recurrence === "none") return RECURRENCE_FREQUENCY_LABELS.none;
  const interval = normalizeInterval(rule.recurrenceInterval);
  // L'intervalle de 1 s'exprime au singulier (« tous les jours »), au-delà il
  // se compte (« toutes les 2 semaines »).
  const count = interval === 1 ? "" : ` ${interval}`;
  const labels: Record<ActiveRecurrence, string> = {
    daily: `Tous les${count} jours`,
    weekly: `Toutes les${count} semaines`,
    monthly: `Tous les${count} mois`,
  };
  const until = parseDateInput(rule.recurrenceUntil);
  const suffix = until ? ` jusqu'au ${formatDayMonthYear(until)}` : "";
  return `${labels[rule.recurrence]}${suffix}`;
}
