/**
 * Déplacement d'un événement : destination du dépôt, indication du créneau
 * pendant le geste, messages d'erreur et annonces pour les lecteurs d'écran.
 *
 * Tout est pur (test/event-drag.test.ts) : l'interface se contente d'appeler ces
 * fonctions et de rendre le résultat.
 */

import { formatDayInZone, formatTimeInZone, zonedParts } from "./timezone.ts";
import { addDays } from "./view-state.ts";

/** Sens d'un déplacement clavier. */
export type MoveStep = {
  /** Décalage en jours (négatif = vers le passé). */
  days?: number;
  /** Décalage en semaines. */
  weeks?: number;
  /** Décalage en minutes (événements horaires uniquement). */
  minutes?: number;
};

/** Événement réduit à ce que le déplacement doit connaître. */
export type MovableEvent = {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Titre, repris dans les annonces du geste. */
  title?: string;
  /** Droit de modification : sans lui, aucun déplacement n'est proposé. */
  canEdit: boolean;
  /** `true` si l'événement appartient à une série récurrente. */
  recurring: boolean;
};

/** Destination d'un déplacement. */
export type MoveTarget = { startsAt: string; endsAt: string };

/** Pas proposés au clavier (Alt + touche). */
export const MOVE_STEPS = {
  day: { days: 1 },
  week: { weeks: 1 },
  halfHour: { minutes: 30 },
} as const satisfies Record<string, MoveStep>;

/**
 * Décale un événement d'un pas, en conservant sa durée et son heure de début.
 * Un événement « journée entière » se décale d'un nombre entier de jours ; un
 * événement horaire d'un nombre de minutes ou de jours.
 */
export function shiftEvent(event: MovableEvent, step: MoveStep): MoveTarget {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (step.minutes !== undefined) {
    const delta = step.minutes * 60_000;
    return {
      startsAt: new Date(start.getTime() + delta).toISOString(),
      endsAt: new Date(end.getTime() + delta).toISOString(),
    };
  }
  const days = (step.days ?? 0) + (step.weeks ?? 0) * 7;
  return { startsAt: addDays(start, days).toISOString(), endsAt: addDays(end, days).toISOString() };
}

/**
 * Destination d'un dépôt sur un jour de la grille : la date change, l'heure de
 * début et la durée sont conservées (exprimées dans le fuseau d'affichage, pour
 * qu'un événement déplacé garde son horaire apparent).
 *
 * Un événement « journée entière » est ramené aux minuits UTC du jour déposé,
 * comme le stockage l'attend.
 */
export function dropTarget(event: MovableEvent, targetDay: Date, zone?: string): MoveTarget {
  if (event.allDay) {
    const startsAt = Date.UTC(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate());
    const endsAt = startsAt + 86_400_000;
    return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
  }

  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (zone) {
    // Heure de début conservée dans le fuseau d'affichage.
    const parts = zonedParts(start, zone);
    const startInstant = zonedInstant(targetDay, parts.hours, parts.minutes, zone);
    const durationMs = end.getTime() - start.getTime();
    return {
      startsAt: startInstant.toISOString(),
      endsAt: new Date(startInstant.getTime() + durationMs).toISOString(),
    };
  }

  const durationMs = end.getTime() - start.getTime();
  const moved = new Date(
    targetDay.getFullYear(),
    targetDay.getMonth(),
    targetDay.getDate(),
    start.getHours(),
    start.getMinutes(),
  );
  return {
    startsAt: moved.toISOString(),
    endsAt: new Date(moved.getTime() + durationMs).toISOString(),
  };
}

/** Instant d'une heure locale d'un jour, dans un fuseau donné. */
function zonedInstant(day: Date, hours: number, minutes: number, zone: string): Date {
  const wallClock = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  const first = wallClock - offsetMinutes(new Date(wallClock), zone) * 60_000;
  return new Date(wallClock - offsetMinutes(new Date(first), zone) * 60_000);
}

/** Décalage d'un fuseau à un instant, en minutes. */
function offsetMinutes(instant: Date, zone: string): number {
  const parts = zonedParts(instant, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * `true` si le déplacement est possible : l'événement doit être modifiable et
 * la destination différente de la position actuelle.
 */
export function canMove(event: MovableEvent): boolean {
  return event.canEdit;
}

/**
 * Message d'erreur d'un dépôt refusé, ou `null` si le dépôt est acceptable.
 * Les messages sont en français, prêts à être affichés et annoncés.
 */
export function dropBlockedReason(
  event: MovableEvent,
  targetDay: Date,
  sourceDayKey: string,
  zone?: string,
): string | null {
  if (!event.canEdit) {
    return "Vous n'êtes pas autorisé à déplacer cet événement.";
  }
  if (targetKey(targetDay) === sourceDayKey) {
    return "L'événement est déjà sur cette journée.";
  }
  const target = dropTarget(event, targetDay, zone);
  if (new Date(target.endsAt).getTime() <= new Date(target.startsAt).getTime()) {
    return "Le déplacement produirait une plage horaire invalide.";
  }
  return null;
}

/** Clé `aaaa-mm-jj` d'une Date locale (jour affiché). */
export function targetKey(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Message affiché pendant le glissement (indicateur de créneau + aria-live). */
export function dragHint(event: MovableEvent, targetDay: Date): string {
  return `Déposer « ${event.title ?? "l'événement"} » sur le ${dayLabel(targetDay)} ? Lâchez pour confirmer.`;
}

/** Libellé du créneau fantôme affiché dans la case survolée. */
export function ghostLabel(event: MovableEvent, target: MoveTarget, zone?: string): string {
  if (event.allDay) return "Journée entière";
  const parts = zonedParts(target.startsAt, zone ?? "UTC");
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
}

/** Confirmation d'un déplacement, annoncée après l'enregistrement. */
export function moveConfirmation(event: MovableEvent, target: MoveTarget, zone?: string): string {
  const day = dayLabelOf(target.startsAt, zone);
  const moved = event.allDay ? day : `${day} à ${formatTimeInZone(target.startsAt, zone ?? "UTC")}`;
  return event.recurring
    ? `Déplacé au ${moved} — toute la série est déplacée.`
    : `Déplacé au ${moved}.`;
}

/** Jour d'un instant, première lettre en minuscule (« mardi 13 octobre 2026 »). */
function dayLabelOf(instant: string, zone?: string): string {
  const label = formatDayInZone(instant, zone ?? "UTC");
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Message d'un déplacement clavier (annoncé également). */
export function moveStepLabel(step: MoveStep): string {
  if (step.minutes !== undefined) return `${step.minutes} minutes`;
  if (step.weeks !== undefined) return `${step.weeks} semaine${step.weeks > 1 ? "s" : ""}`;
  const days = step.days ?? 0;
  return `${days} jour${days > 1 ? "s" : ""}`;
}

/** Sens inverse d'un pas (pour les raccourcis « vers le haut » / « le bas »). */
export function invertStep(step: MoveStep): MoveStep {
  if (step.minutes !== undefined) return { minutes: -step.minutes };
  if (step.weeks !== undefined) return { weeks: -step.weeks };
  return { days: -(step.days ?? 0) };
}

/**
 * Pas correspondant à une touche (Alt enfoncée). Renvoie `null` si la touche ne
 * déplace pas : l'appelant laisse alors le navigateur traiter l'évènement.
 */
export function stepForShortcut(key: string): MoveStep | null {
  if (key === "ArrowLeft") return invertStep(MOVE_STEPS.day);
  if (key === "ArrowRight") return MOVE_STEPS.day;
  if (key === "ArrowUp") return invertStep(MOVE_STEPS.week);
  if (key === "ArrowDown") return MOVE_STEPS.week;
  if (key === "PageUp") return invertStep(MOVE_STEPS.halfHour);
  if (key === "PageDown") return MOVE_STEPS.halfHour;
  return null;
}

/** Convertit une erreur serveur en message français affichable. */
export function moveErrorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message.trim().length > 0) {
    return caught.message;
  }
  return "Déplacement impossible.";
}

/** Jour d'une date locale en clair (« mardi 13 octobre 2026 »). */
function dayLabel(day: Date): string {
  const label = formatDayInZone(day, "UTC");
  return label.charAt(0).toLowerCase() + label.slice(1);
}
