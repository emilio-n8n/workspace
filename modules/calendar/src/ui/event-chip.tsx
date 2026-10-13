import { cn } from "@workspace/ui";
import type { EventView } from "../server.ts";
import { formatTime } from "./event-labels.ts";

export type EventChipProps = {
  event: EventView;
  onSelect: (event: EventView) => void;
  /** Variante compacte (grille du mois) ou détaillée (semaine, agenda). */
  variant?: "compact" | "detailed";
  /** Complément ajouté au libellé accessible (ex. réponse de l'invité). */
  extraLabel?: string;
  className?: string;
};

/**
 * Pastille d'un événement dans une grille ou une liste. Le libellé accessible
 * porte l'heure (ou « journée entière ») : la pastille seule ne suffirait pas
 * à comprendre la plage au lecteur d'écran.
 */
export function EventChip({
  event,
  onSelect,
  variant = "compact",
  extraLabel = "",
  className,
}: EventChipProps) {
  const compact = variant === "compact";
  const timeOrAllDay = event.allDay ? "journée entière" : formatTime(event.startsAt);
  const label = `${timeOrAllDay} ${event.title}${extraLabel}`;
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-label={label}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-left text-xs text-accent-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        compact ? "truncate" : "py-1",
        event.allDay && "font-medium",
        className,
      )}
    >
      {event.allDay ? (
        <span aria-hidden className="shrink-0 opacity-70">
          ◍
        </span>
      ) : compact ? null : (
        <span aria-hidden className="shrink-0 tabular-nums text-muted-foreground">
          {formatTime(event.startsAt)}
        </span>
      )}
      <span className="truncate">{event.title}</span>
    </button>
  );
}
