import { useCallback, useState } from "react";
import type { EventView } from "../server.ts";
import { updateEventFn } from "../server.ts";
import { eventDayKey } from "./date-grid.ts";
import {
  dragHint,
  dropBlockedReason,
  dropTarget,
  type MoveStep,
  moveConfirmation,
  moveErrorMessage,
  shiftEvent,
} from "./event-drag.ts";
import { useDisplayTimeZone } from "./timezone-context.tsx";

export type EventMoveState = {
  /** Événement porté pendant le glissement. */
  dragging: EventView | null;
  /** Jour survolé par le glissement (indicateur de créneau). */
  hoverDay: Date | null;
  /** Enregistrement en cours. */
  busy: boolean;
  /** Dernière annonce (geste, confirmation, erreur). */
  status: string;
  /** Dernière erreur de déplacement. */
  error: string | null;
};

export type EventMoveActions = {
  onDragStart: (event: EventView) => void;
  onDragEnd: () => void;
  onHoverDay: (day: Date | null) => void;
  onDropDay: (day: Date) => void;
  onMoveStep: (event: EventView, step: MoveStep) => void;
};

export type EventMove = EventMoveState & EventMoveActions;

/**
 * Déplacement d'un événement, au glisser-déposer comme au clavier.
 *
 * Le déplacement est enregistré immédiatement (le service conserve la durée,
 * l'heure apparente dans le fuseau d'affichage et, pour une série, toute la
 * série bouge). Un dépôt invalide est annulé avec un message français ; chaque
 * étape est annoncée dans une région `aria-live` par l'appelant.
 */
export function useEventMove(options: { onMoved: () => void | Promise<void> }): EventMove {
  const { zone } = useDisplayTimeZone();
  const [dragging, setDragging] = useState<EventView | null>(null);
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Enregistre une destination et annonce le résultat. */
  const apply = useCallback(
    async (event: EventView, target: { startsAt: string; endsAt: string }) => {
      setBusy(true);
      setError(null);
      try {
        await updateEventFn({
          data: { eventId: event.id, patch: { startsAt: target.startsAt, endsAt: target.endsAt } },
        });
        const message = moveConfirmation(event, target, zone);
        setStatus(message);
        await options.onMoved();
      } catch (caught) {
        const message = moveErrorMessage(caught);
        setError(message);
        setStatus(message);
      } finally {
        setBusy(false);
      }
    },
    [options.onMoved, zone],
  );

  const onDragStart = useCallback((event: EventView) => {
    setError(null);
    setStatus(`Déplacement de « ${event.title} » : choisissez une journée.`);
    setDragging(event);
  }, []);

  const onDragEnd = useCallback(() => {
    setDragging(null);
    setHoverDay(null);
  }, []);

  const onHoverDay = useCallback(
    (day: Date | null) => {
      setHoverDay((current) => {
        if (!day) return null;
        if (current && sameDay(current, day)) return current; // dragover répété
        setStatus(dragStatus(dragging, day, zone));
        return day;
      });
    },
    [dragging, zone],
  );

  const onDropDay = useCallback(
    (day: Date) => {
      const event = dragging;
      if (!event) return;
      setHoverDay(null);

      const blocked = dropBlockedReason(event, day, eventDayKey(event, zone), zone);
      if (blocked) {
        setError(blocked);
        setStatus(blocked);
        setDragging(null);
        return;
      }

      const target = dropTarget(event, day, zone);
      setDragging(null);
      void apply(event, target);
    },
    [apply, dragging, zone],
  );

  const onMoveStep = useCallback(
    (event: EventView, step: MoveStep) => {
      const target = shiftEvent(event, step);
      // Un événement « journée entière » ne se décale qu'à la journée.
      if (event.allDay && step.minutes !== undefined) return;
      // La fin doit rester après le début (décalage d'une demi-heure vers le
      // bas sur un événement court).
      if (new Date(target.endsAt).getTime() <= new Date(target.startsAt).getTime()) {
        setError("La fin doit rester après le début.");
        return;
      }
      void apply(event, target);
    },
    [apply],
  );

  return {
    dragging,
    hoverDay,
    busy,
    status,
    error,
    onDragStart,
    onDragEnd,
    onHoverDay,
    onDropDay,
    onMoveStep,
  };
}

/** `true` si les deux dates désignent le même jour. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Annonce du jour survolé pendant le glissement (ou raison du refus). */
function dragStatus(event: EventView | null, day: Date, zone: string): string {
  if (!event) return "";
  return dropBlockedReason(event, day, eventDayKey(event, zone), zone) ?? dragHint(event, day);
}
