import type { EventView } from "../server.ts";
import { dateKey, groupEventsByDay } from "./date-grid.ts";
import { EventChip } from "./event-chip.tsx";
import { formatDayTitle, isSameDay } from "./view-state.ts";

export type AgendaViewProps = {
  /** Jours couverts par la vue (le curseur et les jours suivants). */
  days: Date[];
  today: Date;
  events: EventView[];
  onSelectEvent: (event: EventView) => void;
};

/** Nombre maximal de journées affichées par la vue agenda. */
const MAX_AGENDA_SECTIONS = 60;

/**
 * Vue agenda — liste chronologique des jours qui portent des événements, du
 * jour courant aux jours suivants. Les jours vides sont sautés : la liste
 * reste courte même sur une période chargée.
 *
 * Chaque jour est une entrée de liste ; les événements sont des boutons
 * atteignables au clavier dans l'ordre de lecture.
 */
export function AgendaView({ days, today, events, onSelectEvent }: AgendaViewProps) {
  const byDay = groupEventsByDay(events);
  const busyDays = days
    .filter((day) => (byDay.get(dateKey(day)) ?? []).length > 0)
    .slice(0, MAX_AGENDA_SECTIONS);

  if (busyDays.length === 0) {
    return (
      <p
        role="status"
        className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground"
      >
        Aucun événement sur les {days.length} prochains jours.
      </p>
    );
  }

  return (
    <section aria-label="Agenda" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {busyDays.map((day) => {
          const list = byDay.get(dateKey(day)) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <li
              key={dateKey(day)}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
            >
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {formatDayTitle(day)}
                {isToday ? <span className="ml-2 text-primary">aujourd'hui</span> : null}
              </h3>
              <ul className="flex flex-col gap-1">
                {list.map((event) => (
                  <li key={event.id}>
                    <EventChip
                      event={event}
                      variant="detailed"
                      onSelect={onSelectEvent}
                      className="py-1.5"
                      extraLabel={
                        event.myStatus
                          ? `, votre réponse : ${event.myStatus === "accepted" ? "accepté" : event.myStatus === "declined" ? "refusé" : "invité"}`
                          : ""
                      }
                    />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
