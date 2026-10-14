import { cn } from "@workspace/ui";
import type { DragEvent, KeyboardEvent } from "react";
import type { EventView } from "../server.ts";
import { type MoveStep, stepForShortcut } from "./event-drag.ts";
import { formatTime } from "./event-labels.ts";
import { useDisplayTimeZone } from "./timezone-context.tsx";

export type EventChipProps = {
  event: EventView;
  onSelect: (event: EventView) => void;
  /** Variante compacte (grille du mois) ou détaillée (semaine, agenda). */
  variant?: "compact" | "detailed";
  /** Complément ajouté au libellé accessible (ex. réponse de l'invité). */
  extraLabel?: string;
  /** Gestion du glisser-déposer et des raccourcis de déplacement. */
  onDragStart?: (event: EventView) => void;
  onDragEnd?: () => void;
  onMoveStep?: (event: EventView, step: MoveStep) => void;
  className?: string;
};

/**
 * Pastille d'un événement dans une grille ou une liste. Le libellé accessible
 * porte l'heure (ou « journée entière ») : la pastille seule ne suffirait pas
 * à comprendre la plage au lecteur d'écran.
 *
 * Au clavier, `Alt` + flèches déplace l'événement d'un jour (gauche / droite),
 * d'une semaine (haut / bas) ou d'une demi-heure (Page haut / Page bas) : le
 * glisser-déposer n'est pas accessible au clavier, ce raccourci le remplace.
 */
export function EventChip({
  event,
  onSelect,
  variant = "compact",
  extraLabel = "",
  onDragStart,
  onDragEnd,
  onMoveStep,
  className,
}: EventChipProps) {
  const { zone } = useDisplayTimeZone();
  const compact = variant === "compact";
  const timeOrAllDay = event.allDay ? "journée entière" : formatTime(event.startsAt, zone);
  const label = `${timeOrAllDay} ${event.title}${extraLabel}`;

  function onKeyDown(keyEvent: KeyboardEvent<HTMLButtonElement>) {
    if (!keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || !onMoveStep) return;
    const step = stepForShortcut(keyEvent.key);
    if (!step) return;
    keyEvent.preventDefault();
    onMoveStep(event, step);
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      onKeyDown={onKeyDown}
      aria-label={label}
      draggable={Boolean(onDragStart) && event.canEdit}
      onDragStart={
        onDragStart
          ? (dragEvent: DragEvent<HTMLButtonElement>) => startDrag(dragEvent, event)
          : undefined
      }
      onDragEnd={onDragEnd}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-left text-xs text-accent-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        compact ? "truncate" : "py-1",
        event.allDay && "font-medium",
        onDragStart && event.canEdit && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {event.allDay ? (
        <span aria-hidden className="shrink-0 opacity-70">
          ◍
        </span>
      ) : compact ? null : (
        <span aria-hidden className="shrink-0 tabular-nums text-muted-foreground">
          {timeOrAllDay}
        </span>
      )}
      <span className="truncate">{event.title}</span>
    </button>
  );
}

/** Début du glissement : l'événement porté est mémorisé dans l'état React. */
function startDrag(dragEvent: DragEvent<HTMLButtonElement>, event: EventView) {
  dragEvent.dataTransfer.setData("text/plain", event.id);
  dragEvent.dataTransfer.effectAllowed = "move";
}
