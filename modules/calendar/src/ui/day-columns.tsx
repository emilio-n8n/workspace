import { cn, IconPlus } from "@workspace/ui";
import type { EventView } from "../server.ts";
import { dateKey, groupEventsByDay, WEEKDAY_LABELS } from "./date-grid.ts";
import { EventChip } from "./event-chip.tsx";
import { dropTarget, ghostLabel } from "./event-drag.ts";
import { CellQuickCreate, type CellQuickCreateProps } from "./quick-create-form.tsx";
import { useDisplayTimeZone } from "./timezone-context.tsx";
import { useDayGrid } from "./use-day-grid.ts";
import type { EventMove } from "./use-event-move.ts";
import { formatDayTitle, isSameDay } from "./view-state.ts";

export type DayColumnsProps = {
  /** Jours affichés : un seul en vue Jour, sept en vue Semaine. */
  days: Date[];
  today: Date;
  events: EventView[];
  submitError: string | null;
  busy: boolean;
  /** Jour dont la colonne affiche le formulaire de création rapide. */
  inlineDay: Date | null;
  onInlineOpen: (day: Date) => void;
  onInlineCancel: () => void;
  onCreate: CellQuickCreateProps["onCreate"];
  onSelectEvent: (event: EventView) => void;
  /** Page haut / Page bas : période précédente / suivante. */
  onPage: (direction: 1 | -1) => void;
  /** Déplacement d'événement (glisser-déposer et clavier). */
  move: EventMove;
  ariaLabel: string;
};

/** Grille pleine largeur, colonnes égales, jours espacés les uns des autres. */
const gridClass = "w-full table-fixed border-separate border-spacing-2";

/**
 * Colonnes de jours — vues Jour et Semaine. `role="grid"` porté par un
 * `<table>` : une ligne d'en-têtes (les jours) et une ligne de cases (les
 * événements du jour).
 *
 * Clavier : flèches gauche / droite entre les jours, Début / Fin de la
 * période, Page haut / bas pour changer de période, Entrée pour créer un
 * événement dans la colonne focalisée. Déplacement : `Alt` + flèches sur une
 * pastille, ou glisser-déposer vers une autre colonne.
 */
export function DayColumns({
  days,
  today,
  events,
  submitError,
  busy,
  inlineDay,
  onInlineOpen,
  onInlineCancel,
  onCreate,
  onSelectEvent,
  onPage,
  move,
  ariaLabel,
}: DayColumnsProps) {
  const { zone } = useDisplayTimeZone();
  const eventsByDay = groupEventsByDay(events, zone);
  const { cellProps } = useDayGrid({
    count: days.length,
    columns: days.length,
    onPage,
    onActivate: (index) => {
      const day = days[index];
      if (day) onInlineOpen(day);
    },
  });

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable.
    <table role="grid" aria-label={ariaLabel} className={gridClass}>
      <caption className="sr-only">
        {ariaLabel} — flèches pour parcourir les jours, Entrée pour créer un événement.
      </caption>
      <thead>
        <tr>
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            const isSelected = inlineDay !== null && isSameDay(inlineDay, day);
            return (
              <th
                key={dateKey(day)}
                scope="col"
                className={cn(
                  "rounded-lg border border-border px-2 py-1.5 text-left text-xs",
                  isToday ? "border-primary/40 bg-accent/40" : "bg-muted/50",
                )}
              >
                <span className="sr-only">{formatDayTitle(day)}</span>
                <span
                  aria-hidden
                  className="text-[11px] uppercase tracking-widest text-muted-foreground"
                >
                  {WEEKDAY_LABELS[(day.getDay() + 6) % 7]}
                </span>
                <span aria-hidden className="ml-1 font-medium">
                  {day.getDate()}
                </span>
                {isToday ? <span className="ml-1 text-muted-foreground">· aujourd'hui</span> : null}
                {isSelected ? <span className="ml-1 text-muted-foreground">· création</span> : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        <tr>
          {days.map((day, index) => {
            const list = eventsByDay.get(dateKey(day)) ?? [];
            const isToday = isSameDay(day, today);
            const isInline = inlineDay !== null && isSameDay(inlineDay, day);
            const isDropTarget =
              move.dragging !== null && move.hoverDay !== null && isSameDay(move.hoverDay, day);
            return (
              <td
                key={dateKey(day)}
                aria-label={`${formatDayTitle(day)}, ${list.length} événement${list.length > 1 ? "s" : ""}`}
                className={cn(
                  "relative h-44 rounded-xl border border-border bg-card p-2 align-top",
                  isToday && "border-primary/30",
                  // Focus clavier piloté par la navigation de grille.
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isDropTarget && "bg-accent/40 ring-2 ring-inset ring-primary/50",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  move.onHoverDay(day);
                }}
                onDragLeave={() => move.onHoverDay(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  move.onDropDay(day);
                }}
                {...cellProps(index)}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => onInlineOpen(day)}
                    className="inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <IconPlus className="size-3.5" />
                    Ajouter
                  </button>
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  {list.map((event) => (
                    <EventChip
                      key={event.id}
                      event={event}
                      variant="detailed"
                      onSelect={onSelectEvent}
                      onDragStart={move.onDragStart}
                      onDragEnd={move.onDragEnd}
                      onMoveStep={move.onMoveStep}
                    />
                  ))}
                  {list.length === 0 ? (
                    <p className="px-1 text-[11px] text-muted-foreground">Aucun événement.</p>
                  ) : null}
                </div>
                {isDropTarget && move.dragging ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-md border border-dashed border-primary bg-accent/60 px-2 py-1 text-xs text-accent-foreground"
                  >
                    <span className="truncate font-medium">{move.dragging.title}</span>
                    <span className="ml-auto tabular-nums">
                      {ghostLabel(move.dragging, dropTarget(move.dragging, day, zone), zone)}
                    </span>
                  </div>
                ) : null}
                {isInline ? (
                  <CellQuickCreate
                    day={day}
                    busy={busy}
                    submitError={submitError}
                    onCreate={onCreate}
                    onCancel={onInlineCancel}
                    className="absolute inset-x-1 top-8 z-10"
                  />
                ) : null}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}
