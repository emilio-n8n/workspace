import { cn } from "@workspace/ui";
import {
  type DayEventLike,
  dateKey,
  GRID_COLUMNS,
  groupEventsByDay,
  miniCalendarDays,
  WEEKDAY_LABELS,
} from "./date-grid.ts";
import { useDayGrid } from "./use-day-grid.ts";
import { addMonths, dayCellLabel, formatMonthYear, isSameDay, isSameMonth } from "./view-state.ts";

export type MiniCalendarProps = {
  /** Mois affiché par le mini calendrier. */
  month: Date;
  /** Jour sélectionné (curseur de la vue principale). */
  selected: Date;
  today: Date;
  /** Événements de la période, pour les pastilles de densité. */
  events: DayEventLike[];
  onMonthChange: (month: Date) => void;
  onSelectDay: (day: Date) => void;
};

/**
 * Mini calendrier de la barre latérale — navigation par mois et sélection d'un
 * jour. Les jours porteurs d'événements sont marqués d'un point ; le jour
 * sélectionné et le jour courant sont distingués.
 *
 * Clavier : flèches entre les jours, Début / Fin de semaine, Page haut / bas
 * pour changer de mois, Entrée pour sélectionner le jour focalisé.
 */
export function MiniCalendar({
  month,
  selected,
  today,
  events,
  onMonthChange,
  onSelectDay,
}: MiniCalendarProps) {
  const days = miniCalendarDays(month);
  const byDay = groupEventsByDay(events);
  const { cellProps } = useDayGrid({
    count: days.length,
    columns: GRID_COLUMNS,
    onPage: (direction) => onMonthChange(addMonths(month, direction)),
    onActivate: (index) => {
      const day = days[index];
      if (day) onSelectDay(day);
    },
  });
  const monthLabel = formatMonthYear(month);

  return (
    <section aria-label="Mini calendrier" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="Mois précédent"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>‹</span>
        </button>
        {/* Le mois changeant est annoncé : la grille entière ne l'est pas. */}
        <h2
          aria-live="polite"
          className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >
          {monthLabel}
        </h2>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="Mois suivant"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden>›</span>
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable. */}
      <table role="grid" aria-label={monthLabel} className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {monthLabel} — flèches pour parcourir les jours, Entrée pour sélectionner, Page haut ou
          bas pour changer de mois.
        </caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                scope="col"
                className="text-center text-[10px] font-medium uppercase text-muted-foreground"
              >
                <span aria-hidden>{label.charAt(0)}</span>
                <span className="sr-only">{label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk(days, GRID_COLUMNS).map((week, weekIndex) => (
            <tr key={dateKey(week[0] ?? days[0] ?? new Date())}>
              {week.map((day, dayIndex) => {
                const index = weekIndex * GRID_COLUMNS + dayIndex;
                const count = (byDay.get(dateKey(day)) ?? []).length;
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selected);
                const inMonth = isSameMonth(day, month);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: Entrée et Espace sont pris en charge par la navigation de grille (cellProps).
                  <td
                    key={dateKey(day)}
                    aria-label={cellLabel(dayCellLabel(day, isToday), count, isSelected)}
                    className={cn(
                      "h-7 rounded-md text-center align-middle text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      !inMonth && "text-muted-foreground/50",
                      isSelected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : isToday
                          ? "bg-accent font-semibold text-accent-foreground"
                          : "text-foreground hover:bg-muted",
                    )}
                    {...cellProps(index)}
                    onClick={() => onSelectDay(day)}
                  >
                    <span className="flex flex-col items-center gap-0.5 leading-none">
                      <span aria-hidden>{day.getDate()}</span>
                      {count > 0 ? (
                        <span
                          aria-hidden
                          className={cn(
                            "size-1 rounded-full",
                            isSelected ? "bg-primary-foreground" : "bg-primary",
                          )}
                        />
                      ) : null}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Libellé accessible d'une case : date, état du jour, sélection et événements. */
function cellLabel(label: string, count: number, selected: boolean): string {
  const events = count === 0 ? "aucun événement" : `${count} événement${count > 1 ? "s" : ""}`;
  return `${label}, ${selected ? "sélectionné, " : ""}${events}`;
}

/** Découpe les jours en semaines (une ligne de la grille). */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
