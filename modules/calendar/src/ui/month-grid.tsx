import { cn } from "@workspace/ui";
import type { EventView } from "../server.ts";
import {
  dateKey,
  groupEventsByDay,
  overflowLabel,
  visibleEventsPerDay,
  WEEKDAY_LABELS,
} from "./date-grid.ts";
import { EventChip } from "./event-chip.tsx";
import { CellQuickCreate, type CellQuickCreateProps } from "./quick-create-form.tsx";
import { useDayGrid } from "./use-day-grid.ts";
import { dayCellLabel, formatLongDay, isSameDay, isSameMonth } from "./view-state.ts";

export type MonthGridProps = {
  /** Les 42 jours affichés (six semaines entières). */
  days: Date[];
  /** Mois mis en avant (les jours des autres mois sont estompés). */
  month: Date;
  today: Date;
  events: EventView[];
  /** Message d'erreur de création remonté par le parent. */
  submitError: string | null;
  busy: boolean;
  /** Jour dont la case affiche le formulaire de création rapide. */
  inlineDay: Date | null;
  onInlineOpen: (day: Date) => void;
  onInlineCancel: () => void;
  onCreate: CellQuickCreateProps["onCreate"];
  onSelectEvent: (event: EventView) => void;
  /** Page haut / Page bas : mois précédent / suivant. */
  onPage: (direction: 1 | -1) => void;
  /** Titre de la grille pour les lecteurs d'écran. */
  ariaLabel: string;
};

/**
 * Grille du mois — six semaines entières, `role="grid"` porté par un `<table>`
 * (en-têtes de colonnes natifs, cases atteignables au clavier). Chaque case
 * affiche son numéro de jour, jusqu'à trois événements puis un résumé
 * « +N autre(s) ».
 *
 * Clavier : flèches entre les cases, Début / Fin de ligne, Page haut / bas
 * pour changer de mois, Entrée pour créer un événement dans la case focalisée.
 */
export function MonthGrid({
  days,
  month,
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
  ariaLabel,
}: MonthGridProps) {
  const eventsByDay = groupEventsByDay(events);
  const { cellProps } = useDayGrid({
    count: days.length,
    columns: WEEKDAY_LABELS.length,
    onPage,
    onActivate: (index) => {
      const day = days[index];
      if (day) onInlineOpen(day);
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable. */}
      <table role="grid" aria-label={ariaLabel} className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {ariaLabel} — utilisez les flèches pour parcourir les jours, Entrée pour créer un
          événement.
        </caption>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk(days, WEEKDAY_LABELS.length).map((week, weekIndex) => (
            <tr key={dateKey(week[0] ?? days[0] ?? new Date())}>
              {week.map((day, dayIndex) => {
                const index = weekIndex * WEEKDAY_LABELS.length + dayIndex;
                const list = eventsByDay.get(dateKey(day)) ?? [];
                const isToday = isSameDay(day, today);
                const inMonth = isSameMonth(day, month);
                const isInline = inlineDay !== null && isSameDay(inlineDay, day);
                return (
                  <td
                    key={dateKey(day)}
                    aria-label={cellLabel(dayCellLabel(day, isToday), list.length)}
                    className={cn(
                      "relative h-28 border-b border-r border-border p-1.5 align-top",
                      !inMonth && "bg-muted/40",
                      isToday && "bg-accent/30",
                      // Focus clavier piloté par la navigation de grille.
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    )}
                    {...cellProps(index)}
                  >
                    <button
                      type="button"
                      onClick={() => onInlineOpen(day)}
                      aria-label={`Créer un événement le ${formatLongDay(day)}`}
                      className={cn(
                        "mb-1 grid size-6 place-items-center rounded-full text-xs transition-colors",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {day.getDate()}
                    </button>
                    <div className="flex flex-col gap-1">
                      {list.slice(0, visibleEventsPerDay(list)).map((event) => (
                        <EventChip key={event.id} event={event} onSelect={onSelectEvent} />
                      ))}
                      {list.length > visibleEventsPerDay(list) ? (
                        <span className="px-1 text-[11px] text-muted-foreground">
                          {overflowLabel(list.length - visibleEventsPerDay(list))}
                        </span>
                      ) : null}
                    </div>
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
          ))}
        </tbody>
      </table>
      {/* Pas d'état vide ici : six semaines de cases vides seraient illisibles.
          L'absence d'événement est signalée sous la grille par l'appelant. */}
    </div>
  );
}

/** Mention du nombre d'événements dans le libellé accessible d'une case. */
function cellLabel(label: string, count: number): string {
  if (count === 0) return `${label}, aucun événement`;
  return `${label}, ${count} événement${count > 1 ? "s" : ""}`;
}

/** Découpe une liste en tranches de `size` éléments. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
