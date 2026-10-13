import { Button, Dialog, Input, Label } from "@workspace/ui";
import type { FormEvent } from "react";
import type { CalendarOption, EventView, Recurrence } from "../server.ts";
import { RECURRENCE_LABELS, RECURRENCE_OPTIONS } from "./event-labels.ts";
import { toDateInput, toTimeInput } from "./quick-create.ts";
import { parseDateInput } from "./view-state.ts";

/** État du formulaire d'édition / création complète. */
export type EditorState = {
  eventId: string | null;
  title: string;
  /** Date locale `aaaa-mm-jj`. */
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  attendees: string;
  calendarId: string;
  recurrence: Recurrence;
  /** Date locale `aaaa-mm-jj`, vide quand la récurrence est « Aucune ». */
  recurrenceUntil: string;
  /** Case « visioconférence » (création uniquement, jamais pour une édition). */
  meetRoom: boolean;
};

/** Brouillon vide pour un jour donné (création). */
export function emptyEditor(date: Date, calendarId: string): EditorState {
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
    recurrence: "none",
    recurrenceUntil: "",
    meetRoom: false,
  };
}

/** Brouillon prérempli depuis un événement existant (édition). */
export function editorFromEvent(event: EventView): EditorState {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return {
    eventId: event.id,
    title: event.title,
    // Journée entière : date stockée en UTC, relue sans décalage.
    date: toDateInput(
      event.allDay ? (parseDateInput(event.startsAt.slice(0, 10)) ?? start) : start,
    ),
    allDay: event.allDay,
    startTime: toTimeInput(start),
    endTime: toTimeInput(end),
    location: event.location ?? "",
    description: event.description ?? "",
    attendees: "",
    calendarId: event.calendarId,
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil
      ? toDateInput(
          parseDateInput(event.recurrenceUntil.slice(0, 10)) ?? new Date(event.recurrenceUntil),
        )
      : "",
    meetRoom: false,
  };
}

export type EventEditorDialogProps = {
  /** `null` = dialogue fermé. */
  editor: EditorState | null;
  calendars: CalendarOption[];
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<EditorState>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

/**
 * Dialogue de création / édition complète d'un événement : tous les champs,
 * y compris les invités, la répétition et la visioconférence.
 */
export function EventEditorDialog({
  editor,
  calendars,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}: EventEditorDialogProps) {
  return (
    <Dialog
      open={editor !== null}
      onClose={onClose}
      title={editor?.eventId ? "Modifier l'événement" : "Nouvel événement"}
    >
      {editor ? (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onSubmit();
          }}
          method="post"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-title">Titre</Label>
            <Input
              id="event-title"
              value={editor.title}
              onChange={(event) => onChange({ title: event.target.value })}
              maxLength={255}
              autoFocus
            />
          </div>
          {editor.eventId === null ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-calendar">Agenda</Label>
              <select
                id="event-calendar"
                value={editor.calendarId}
                onChange={(event) => onChange({ calendarId: event.target.value })}
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
                onChange={(event) => onChange({ date: event.target.value })}
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
                onChange={(event) => onChange({ startTime: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-end">Fin</Label>
              <Input
                id="event-end"
                type="time"
                value={editor.endTime}
                disabled={editor.allDay}
                onChange={(event) => onChange({ endTime: event.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={editor.allDay}
              onChange={(event) => onChange({ allDay: event.target.checked })}
            />
            Journée entière
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-recurrence">Répétition</Label>
              <select
                id="event-recurrence"
                value={editor.recurrence}
                onChange={(event) => {
                  const recurrence = event.target.value as Recurrence;
                  onChange({
                    recurrence,
                    // « Aucune » efface la fin de série ; la date reste
                    // requise dès qu'une répétition est choisie.
                    recurrenceUntil: recurrence === "none" ? "" : editor.recurrenceUntil,
                  });
                }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {RECURRENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {RECURRENCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {editor.recurrence !== "none" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-recurrence-until">Répéter jusqu'au</Label>
                <Input
                  id="event-recurrence-until"
                  type="date"
                  value={editor.recurrenceUntil}
                  onChange={(event) => onChange({ recurrenceUntil: event.target.value })}
                  required
                />
              </div>
            ) : null}
          </div>
          {editor.recurrence !== "none" ? (
            <p className="text-xs text-muted-foreground">
              Modifier ou supprimer une répétition s'applique à toute la série.
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-location">Lieu</Label>
            <Input
              id="event-location"
              value={editor.location}
              onChange={(event) => onChange({ location: event.target.value })}
              maxLength={255}
            />
          </div>
          {editor.eventId === null ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-attendees">Invités (e-mails séparés par des virgules)</Label>
              <Input
                id="event-attendees"
                value={editor.attendees}
                onChange={(event) => onChange({ attendees: event.target.value })}
                placeholder="alice@exemple.org, bruno@exemple.org"
              />
            </div>
          ) : null}
          {editor.eventId === null ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={editor.meetRoom}
                onChange={(event) => onChange({ meetRoom: event.target.checked })}
              />
              Créer une salle de visioconférence
            </label>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="event-description">Description</Label>
            <textarea
              id="event-description"
              value={editor.description}
              onChange={(event) => onChange({ description: event.target.value })}
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={editor.title.trim().length === 0}>
              {editor.eventId ? "Enregistrer" : "Créer l'événement"}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
