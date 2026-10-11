import { Badge, Button, cn, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type CalendarOption,
  createCalendarFn,
  createEventFn,
  deleteEventFn,
  type EventView,
  listCalendarsFn,
  listEventsFn,
  setAttendanceFn,
  updateEventFn,
} from "../server.ts";

type ViewMode = "month" | "week";

const DAY_LABELS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const MONTH_LABELS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const ATTENDANCE_LABELS: Record<string, string> = {
  invited: "Invité",
  accepted: "A accepté",
  declined: "A refusé",
};

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeek(date: Date): Date {
  const base = startOfDay(date);
  const day = (base.getDay() + 6) % 7;
  return addDays(base, -day);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(date: Date, timeZone?: string): string {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  });
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUtcDateInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Bornes d'un événement « journée entière » : minuit UTC du jour choisi et
 * minuit UTC du lendemain. Les événements sur plusieurs jours restent hors
 * périmètre.
 */
function allDayRange(date: string): { startsAt: string; endsAt: string } {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type EditorState = {
  eventId: string | null;
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  attendees: string;
  calendarId: string;
};

function emptyEditor(date: Date, calendarId: string): EditorState {
  return {
    eventId: null,
    title: "",
    date: toDateInput(date),
    allDay: false,
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    description: "",
    attendees: "",
    calendarId,
  };
}

/**
 * Calendar — vue mois et semaine, création/édition d'événements, invitations
 * et réponses (accepter / refuser). Les événements visibles sont ceux des
 * agendas de l'organisation, de l'agenda personnel et les invitations reçues.
 */
export function CalendarView() {
  const [mode, setMode] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<EventView[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EventView | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaName, setAgendaName] = useState("");
  const [agendaShared, setAgendaShared] = useState(true);

  const range = useMemo(() => {
    if (mode === "month") {
      const start = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      return {
        from: start,
        to: addDays(start, 42),
        days: Array.from({ length: 42 }, (_, index) => addDays(start, index)),
      };
    }
    const start = startOfWeek(cursor);
    return {
      from: start,
      to: addDays(start, 7),
      days: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    };
  }, [mode, cursor]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      let options = await listCalendarsFn();
      if (options.length === 0) {
        await createCalendarFn({ data: { name: "Mon agenda", shared: false } });
        options = await listCalendarsFn();
      }
      const list = await listEventsFn({
        data: { from: range.from.toISOString(), to: range.to.toISOString() },
      });
      setCalendars(options);
      setEvents(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventView[]>();
    for (const event of events) {
      // « Journée entière » : la date est le préfixe UTC de l'instant stocké.
      const dayKey = event.allDay
        ? event.startsAt.slice(0, 10)
        : toDateInput(new Date(event.startsAt));
      const list = map.get(dayKey) ?? [];
      list.push(event);
      map.set(dayKey, list);
    }
    return map;
  }, [events]);

  function openCreate(day?: Date) {
    const fallback = calendars.find((calendar) => calendar.isMine) ?? calendars[0];
    if (!fallback) return;
    setEditorError(null);
    setEditor(emptyEditor(day ?? new Date(), fallback.id));
  }

  function openEdit(event: EventView) {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    setEditorError(null);
    setEditor({
      eventId: event.id,
      title: event.title,
      date: event.allDay ? toUtcDateInput(start) : toDateInput(start),
      allDay: event.allDay,
      startTime: toTimeInput(start),
      endTime: toTimeInput(end),
      location: event.location ?? "",
      description: event.description ?? "",
      attendees: "",
      calendarId: event.calendarId,
    });
  }

  async function onSaveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setEditorError(null);
    try {
      let startsAt: string;
      let endsAt: string;
      if (editor.allDay) {
        // DATE seule : minuit UTC du jour, fin = minuit UTC du lendemain.
        ({ startsAt, endsAt } = allDayRange(editor.date));
      } else {
        startsAt = new Date(`${editor.date}T${editor.startTime}:00`).toISOString();
        endsAt = new Date(`${editor.date}T${editor.endTime}:00`).toISOString();
      }

      if (editor.eventId) {
        await updateEventFn({
          data: {
            eventId: editor.eventId,
            patch: {
              title: editor.title.trim(),
              description: editor.description,
              location: editor.location,
              startsAt,
              endsAt,
              allDay: editor.allDay,
            },
          },
        });
      } else {
        const attendees = editor.attendees
          .split(/[,;\s]+/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        await createEventFn({
          data: {
            calendarId: editor.calendarId,
            title: editor.title.trim(),
            description: editor.description,
            location: editor.location,
            startsAt,
            endsAt,
            allDay: editor.allDay,
            attendees,
          },
        });
      }
      setEditor(null);
      await refresh();
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function respond(status: "accepted" | "declined") {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setAttendanceFn({ data: { eventId: selected.id, status } });
      setSelected(updated);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Réponse impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await deleteEventFn({ data: { eventId: selected.id } });
      setSelected(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmDelete() {
    await removeSelected();
    setDeleteOpen(false);
  }

  async function onCreateAgenda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (agendaName.trim().length === 0) return;
    setBusy(true);
    try {
      await createCalendarFn({ data: { name: agendaName.trim(), shared: agendaShared } });
      setAgendaName("");
      setAgendaOpen(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date();
  const weekStart = startOfWeek(cursor);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          {mode === "month"
            ? `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`
            : `Semaine du ${weekStart.getDate()} ${MONTH_LABELS[weekStart.getMonth()]}`}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label="Période précédente"
            onClick={() =>
              setCursor((previous) =>
                mode === "month"
                  ? new Date(previous.getFullYear(), previous.getMonth() - 1, 1)
                  : addDays(previous, -7),
              )
            }
          >
            ‹
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Aujourd'hui
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Période suivante"
            onClick={() =>
              setCursor((previous) =>
                mode === "month"
                  ? new Date(previous.getFullYear(), previous.getMonth() + 1, 1)
                  : addDays(previous, 7),
              )
            }
          >
            ›
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(["month", "week"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {value === "month" ? "Mois" : "Semaine"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => openCreate(new Date())}>
            Nouvel événement
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {calendars.map((calendar) => (
          <span key={calendar.id} className="rounded-full border border-border px-2 py-0.5">
            {calendar.name}
            {calendar.isOrg ? " · organisation" : ""}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAgendaOpen(true)}
          className="font-medium text-primary hover:underline"
        >
          ＋ Agenda partagé
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : mode === "month" ? (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-7 border-b border-border bg-muted/50">
              {DAY_LABELS.map((label) => (
                <span
                  key={label}
                  className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {range.days.map((day) => {
                const key = toDateInput(day);
                const dayEvents = eventsByDay.get(key) ?? [];
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameDay(day, today);
                const fullDate = day.toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                });
                return (
                  <div
                    key={key}
                    className={cn(
                      "min-h-28 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0",
                      !inMonth && "bg-muted/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openCreate(day)}
                      aria-label={`Créer un événement le ${fullDate}`}
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
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setSelected(event)}
                          className="truncate rounded bg-accent px-1.5 py-0.5 text-left text-xs text-accent-foreground transition-opacity hover:opacity-85"
                        >
                          {event.allDay ? event.title : `${fmtTime(event.startsAt)} ${event.title}`}
                        </button>
                      ))}
                      {dayEvents.length > 3 ? (
                        <span className="px-1 text-[11px] text-muted-foreground">
                          +{dayEvents.length - 3} autre(s)
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun événement sur cette période.</p>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
          {range.days.map((day) => {
            const key = toDateInput(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                className="flex min-h-44 flex-col gap-2 rounded-xl border border-border bg-card p-2"
              >
                <p
                  className={cn(
                    "text-xs font-medium",
                    isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {DAY_LABELS[(day.getDay() + 6) % 7]} {day.getDate()}
                </p>
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelected(event)}
                    className="rounded bg-accent px-2 py-1 text-left text-xs text-accent-foreground transition-opacity hover:opacity-85"
                  >
                    {event.allDay ? (
                      event.title
                    ) : (
                      <>
                        <span className="font-medium">{fmtTime(event.startsAt)}</span> {event.title}
                      </>
                    )}
                  </button>
                ))}
                {dayEvents.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">—</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* --- Détails d'un événement ------------------------------------------- */}
      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? "Événement"}
      >
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{selected.calendarName}</Badge>
              {selected.myStatus ? (
                <Badge variant={selected.myStatus === "accepted" ? "accent" : "outline"}>
                  {ATTENDANCE_LABELS[selected.myStatus]}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm">
              {selected.allDay
                ? `${fmtDay(new Date(selected.startsAt), "UTC")} · journée entière`
                : `${fmtDay(new Date(selected.startsAt))} · ${fmtTime(selected.startsAt)} – ${fmtTime(selected.endsAt)}`}
            </p>
            {selected.location ? (
              <p className="text-sm text-muted-foreground">Lieu : {selected.location}</p>
            ) : null}
            {selected.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {selected.description}
              </p>
            ) : null}
            {selected.attendees.length > 0 ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Invités
                </h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {selected.attendees.map((attendee) => (
                    <li key={attendee.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{attendee.name ?? attendee.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {ATTENDANCE_LABELS[attendee.status] ?? attendee.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {selected.myStatus && selected.myStatus !== "accepted" ? (
                <Button size="sm" loading={busy} onClick={() => void respond("accepted")}>
                  Accepter
                </Button>
              ) : null}
              {selected.myStatus && selected.myStatus !== "declined" ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy}
                  onClick={() => void respond("declined")}
                >
                  Refuser
                </Button>
              ) : null}
              {selected.canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    openEdit(selected);
                    setSelected(null);
                  }}
                >
                  Modifier
                </Button>
              ) : null}
              {selected.canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Supprimer
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* --- Confirmation de suppression --------------------------------------- */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer l'événement ?"
      >
        <p className="text-sm text-muted-foreground">
          {selected
            ? `« ${selected.title} » sera définitivement supprimé.`
            : "Cette action est définitive."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Annuler
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void onConfirmDelete()}>
            Supprimer
          </Button>
        </div>
      </Dialog>

      {/* --- Création / édition ----------------------------------------------- */}
      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.eventId ? "Modifier l'événement" : "Nouvel événement"}
      >
        {editor ? (
          <form onSubmit={onSaveEditor} method="post" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-title">Titre</Label>
              <Input
                id="event-title"
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                maxLength={255}
                autoFocus
              />
            </div>
            {!editor.eventId ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-calendar">Agenda</Label>
                <select
                  id="event-calendar"
                  value={editor.calendarId}
                  onChange={(event) => setEditor({ ...editor, calendarId: event.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                      {calendar.isOrg ? " (organisation)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={editor.date}
                  onChange={(event) => setEditor({ ...editor, date: event.target.value })}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-start">Début</Label>
                <Input
                  id="event-start"
                  type="time"
                  value={editor.startTime}
                  disabled={editor.allDay}
                  onChange={(event) => setEditor({ ...editor, startTime: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-end">Fin</Label>
                <Input
                  id="event-end"
                  type="time"
                  value={editor.endTime}
                  disabled={editor.allDay}
                  onChange={(event) => setEditor({ ...editor, endTime: event.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={editor.allDay}
                onChange={(event) => setEditor({ ...editor, allDay: event.target.checked })}
              />
              Journée entière
            </label>
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-location">Lieu</Label>
              <Input
                id="event-location"
                value={editor.location}
                onChange={(event) => setEditor({ ...editor, location: event.target.value })}
                maxLength={255}
              />
            </div>
            {!editor.eventId ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-attendees">Invités (e-mails séparés par des virgules)</Label>
                <Input
                  id="event-attendees"
                  value={editor.attendees}
                  onChange={(event) => setEditor({ ...editor, attendees: event.target.value })}
                  placeholder="alice@exemple.org, bruno@exemple.org"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-description">Description</Label>
              <textarea
                id="event-description"
                value={editor.description}
                onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                rows={3}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {editorError ? (
              <p role="alert" className="text-sm text-destructive">
                {editorError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
                Annuler
              </Button>
              <Button type="submit" loading={busy} disabled={editor.title.trim().length === 0}>
                {editor.eventId ? "Enregistrer" : "Créer l'événement"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      {/* --- Nouvel agenda partagé -------------------------------------------- */}
      <Dialog open={agendaOpen} onClose={() => setAgendaOpen(false)} title="Nouvel agenda">
        <form onSubmit={onCreateAgenda} method="post" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="agenda-name">Nom de l'agenda</Label>
            <Input
              id="agenda-name"
              value={agendaName}
              onChange={(event) => setAgendaName(event.target.value)}
              placeholder="Agenda d'équipe"
              maxLength={120}
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={agendaShared}
              onChange={(event) => setAgendaShared(event.target.checked)}
            />
            Visible par tous les membres de l'organisation
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAgendaOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={agendaName.trim().length === 0}>
              Créer l'agenda
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
