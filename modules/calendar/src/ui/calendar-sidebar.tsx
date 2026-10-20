import { cn, IconClose, IconPlus } from "@workspace/ui";
import type { CalendarOption } from "../server.ts";
import type { DayEventLike } from "./date-grid.ts";
import { MiniCalendar } from "./mini-calendar.tsx";
import { formatZoneDelta } from "./timezone.ts";
import { useDisplayTimeZone } from "./timezone-context.tsx";
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from "./view-state.ts";

export type CalendarSidebarProps = {
  /** Mois affiché par le mini calendrier. */
  month: Date;
  cursor: Date;
  today: Date;
  events: DayEventLike[];
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onMonthChange: (month: Date) => void;
  onSelectDay: (day: Date) => void;
  /** Ferme la barre latérale ; réouverture depuis la barre d'outils. */
  onClose: () => void;
  onCreateAgenda: () => void;
  calendars: CalendarOption[];
};

/** Couleurs des pastilles d'agenda, prises dans les jetons sémantiques. */
const CALENDAR_DOT_CLASSES = [
  "bg-primary",
  "bg-attention",
  "bg-chart-2",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-3",
] as const;

/**
 * Barre latérale du calendrier : mini calendrier de navigation, sélecteur de
 * vue, fuseau d'affichage et liste des agendas visibles. Fermable (croix) et
 * réouverte depuis la barre d'outils ; son contenu défile sur place.
 */
export function CalendarSidebar({
  month,
  cursor,
  today,
  events,
  mode,
  onModeChange,
  onMonthChange,
  onSelectDay,
  onClose,
  onCreateAgenda,
  calendars,
}: CalendarSidebarProps) {
  const { zone, options, changeZone } = useDisplayTimeZone();

  return (
    <aside
      aria-label="Navigation du calendrier"
      className="flex max-h-[45vh] w-60 shrink-0 flex-col gap-4 overflow-y-auto border-b border-border bg-card p-3 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r"
    >
      <div className="flex items-center justify-between gap-1">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Navigation
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la navigation"
          title="Fermer la navigation"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconClose />
        </button>
      </div>

      <MiniCalendar
        month={month}
        selected={cursor}
        today={today}
        events={events}
        onMonthChange={onMonthChange}
        onSelectDay={onSelectDay}
      />

      <div className="flex flex-col gap-1">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Affichage
        </h2>
        <div className="flex flex-wrap gap-1">
          {VIEW_MODES.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={mode === view}
              onClick={() => onModeChange(view)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === view
                  ? "border-primary/40 bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="calendar-time-zone"
          className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Fuseau horaire
        </label>
        <select
          id="calendar-time-zone"
          value={zone}
          onChange={(event) => changeZone(event.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="px-1 text-[11px] text-muted-foreground">{formatZoneDelta(zone)}</p>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Mes agendas
        </h2>
        <ul className="flex flex-col gap-0.5">
          {calendars.map((calendar, index) => (
            <li
              key={calendar.id}
              className="flex items-center gap-2 truncate rounded-md px-1 py-1 text-xs text-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  CALENDAR_DOT_CLASSES[index % CALENDAR_DOT_CLASSES.length],
                )}
              />
              <span className="truncate">{calendar.name}</span>
              {calendar.isOrg ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  organisation
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onCreateAgenda}
          className="inline-flex items-center gap-1 mt-1 rounded-md px-1 py-1 text-left text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconPlus className="size-3.5" />
          Agenda partagé
        </button>
      </div>
    </aside>
  );
}
