import { createRoomFn } from "@workspace/meet/server";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  Input,
  type SegmentedTabItem,
  SegmentedTabs,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type CalendarOption,
  createCalendarFn,
  createEventFn,
  deleteEventFn,
  type EventView,
  getMeetUrlFn,
  listCalendarsFn,
  listEventsFn,
  setAttendanceFn,
  updateEventFn,
} from "../server.ts";
import { AgendaView } from "./agenda-view.tsx";
import { CalendarSidebar } from "./calendar-sidebar.tsx";
import { DayColumns } from "./day-columns.tsx";
import { EventDetailDialog } from "./event-detail-dialog.tsx";
import {
  type EditorState,
  EventEditorDialog,
  editorFromEvent,
  emptyEditor,
} from "./event-editor-dialog.tsx";
import { MonthGrid } from "./month-grid.tsx";
import { type QuickDraft, quickDraftRange, splitEmails } from "./quick-create.ts";
import { QuickAddBar } from "./quick-create-form.tsx";
import { CalendarTimeZoneProvider } from "./timezone-context.tsx";
import { useEventMove } from "./use-event-move.ts";
import { usePersistentViewMode } from "./use-persistent-view.ts";
import {
  rangeFor,
  shiftCursor,
  startOfMonth,
  VIEW_LABELS,
  type ViewMode,
  viewHeading,
} from "./view-state.ts";

const MODE_TABS: SegmentedTabItem<ViewMode>[] = [
  { id: "day", label: VIEW_LABELS.day },
  { id: "week", label: VIEW_LABELS.week },
  { id: "month", label: VIEW_LABELS.month },
  { id: "agenda", label: VIEW_LABELS.agenda },
];

/**
 * Calendar — vues Jour / Semaine / Mois / Agenda commutables, mini calendrier
 * de navigation, création rapide en ligne et dialogue complet.
 *
 * Les événements visibles sont ceux des agendas de l'organisation, de l'agenda
 * personnel et les invitations reçues.
 */
export function CalendarView() {
  const [mode, setMode] = usePersistentViewMode();
  const [cursor, setCursor] = useState(() => new Date());
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(new Date()));
  const [today] = useState(() => new Date());
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
  /** Jour dont la case affiche le formulaire de création rapide. */
  const [inlineDay, setInlineDay] = useState<Date | null>(null);

  const range = useMemo(() => rangeFor(mode, cursor), [mode, cursor]);

  // Le mini calendrier suit le curseur dès qu'il sort du mois affiché.
  useEffect(() => {
    setMiniMonth((current) =>
      current.getFullYear() === cursor.getFullYear() && current.getMonth() === cursor.getMonth()
        ? current
        : startOfMonth(cursor),
    );
  }, [cursor]);

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

  const move = useEventMove({ onMoved: refresh });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const defaultCalendarId = useMemo(
    () => calendars.find((calendar) => calendar.isMine)?.id ?? calendars[0]?.id,
    [calendars],
  );

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const shift = useCallback(
    (direction: 1 | -1) => {
      setCursor((previous) => shiftCursor(previous, mode, direction));
    },
    [mode],
  );

  const goToDay = useCallback((day: Date) => {
    setCursor(day);
    setInlineDay(null);
  }, []);

  const changeMode = useCallback(
    (next: ViewMode) => {
      setMode(next);
      setInlineDay(null);
    },
    [setMode],
  );

  // -------------------------------------------------------------------------
  // Création / édition
  // -------------------------------------------------------------------------

  /** Crée un événement depuis un brouillon de création rapide. */
  const createQuick = useCallback(
    async (draft: QuickDraft) => {
      const { startsAt, endsAt, allDay } = quickDraftRange(draft);
      setBusy(true);
      setError(null);
      try {
        await createEventFn({
          data: {
            calendarId: defaultCalendarId ?? null,
            title: draft.title.trim(),
            startsAt,
            endsAt,
            allDay,
          },
        });
        setInlineDay(null);
        await refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Création impossible.");
      } finally {
        setBusy(false);
      }
    },
    [defaultCalendarId, refresh],
  );

  function openFullEditor(day?: Date) {
    if (!defaultCalendarId) return;
    setEditorError(null);
    // Le formulaire en ligne cède la place au dialogue complet.
    setInlineDay(null);
    setEditor(emptyEditor(day ?? cursor, defaultCalendarId));
  }

  /** Ouvre l'éditeur complet prérempli depuis la barre d'ajout rapide. */
  function openDetailsFromQuick(draft: QuickDraft, calendarId: string | undefined) {
    if (!calendarId) return;
    setEditorError(null);
    setInlineDay(null);
    setEditor({ ...emptyEditor(new Date(), calendarId), ...draft });
  }

  async function onSaveEditor() {
    if (!editor) return;
    setBusy(true);
    setEditorError(null);
    // Rempli si la salle Meet n'a pas pu être créée : l'événement est tout de
    // même enregistré, l'avertissement est affiché après la fermeture du
    // dialogue (état d'erreur existant de la vue).
    let meetWarning: string | null = null;
    try {
      // L'état de l'éditeur est compatible avec un brouillon de création
      // rapide : même logique de conversion (journée entière → minuits UTC).
      const { startsAt, endsAt } = quickDraftRange(editor);

      // Fin de série : fin de la journée locale choisie (l'occurrence de ce
      // jour-là reste incluse), `null` quand la répétition est « Aucune ».
      let recurrenceUntil: string | null = null;
      if (editor.recurrence !== "none") {
        if (editor.recurrenceUntil.length === 0) {
          setEditorError("Choisissez une date de fin de répétition.");
          return;
        }
        recurrenceUntil = new Date(`${editor.recurrenceUntil}T23:59:59`).toISOString();
      }

      if (editor.eventId) {
        // Édition : la récurrence (et toute modification) porte sur la série
        // entière — il n'existe pas de dérogation par occurrence.
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
              recurrence: editor.recurrence,
              recurrenceInterval: editor.recurrenceInterval,
              recurrenceUntil,
            },
          },
        });
      } else {
        const attendees = splitEmails(editor.attendees);

        // Visioconférence en un clic : la salle Meet est créée avant
        // l'événement, puis son lien est ajouté au lieu. Les salles Meet sont
        // des liens à portée d'organisation (tout membre peut les rejoindre).
        let location = editor.location;
        if (editor.meetRoom) {
          try {
            const room = await createRoomFn({
              data: { name: editor.title.trim() || "Réunion" },
            });
            const meetUrl = await getMeetUrlFn();
            const link = `${meetUrl}/room/${room.slug}`;
            const prefix = location.trim();
            // Le lieu est borné à 255 caractères par l'API : si l'ajout du lien
            // dépasse, le texte saisi est tronqué pour garder le lien intact.
            const maxPrefix = Math.max(0, 255 - link.length - 1);
            location = prefix.length > 0 ? `${prefix.slice(0, maxPrefix)}\n${link}` : link;
          } catch {
            meetWarning =
              "Événement créé sans visioconférence : la salle Meet n'a pas pu être créée.";
          }
        }

        await createEventFn({
          data: {
            calendarId: editor.calendarId,
            title: editor.title.trim(),
            description: editor.description,
            location,
            startsAt,
            endsAt,
            allDay: editor.allDay,
            attendees,
            recurrence: editor.recurrence,
            recurrenceInterval: editor.recurrenceInterval,
            recurrenceUntil,
          },
        });
      }
      setEditor(null);
      await refresh();
      if (meetWarning) setError(meetWarning);
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Réponses, suppression, agendas
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------

  const heading = viewHeading(mode, cursor);
  const gridLabel = `Calendrier — ${heading}`;

  return (
    <CalendarTimeZoneProvider>
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-semibold tracking-tight">{heading}</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label="Période précédente"
              onClick={() => shift(-1)}
            >
              ‹
            </Button>
            <Button variant="outline" size="sm" onClick={() => goToDay(new Date())}>
              Aujourd'hui
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Période suivante"
              onClick={() => shift(1)}
            >
              ›
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SegmentedTabs
              items={MODE_TABS}
              value={mode}
              onChange={changeMode}
              ariaLabel="Affichage du calendrier"
            />
          </div>
        </header>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <CalendarSidebar
            month={miniMonth}
            cursor={cursor}
            today={today}
            events={events}
            mode={mode}
            onModeChange={changeMode}
            onMonthChange={setMiniMonth}
            onSelectDay={goToDay}
            onNewEvent={() => openFullEditor(cursor)}
            onCreateAgenda={() => setAgendaOpen(true)}
            calendars={calendars}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {error ? (
              <Alert tone="danger">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{error}</span>
                  <Button size="sm" variant="outline" onClick={() => void refresh()}>
                    Réessayer
                  </Button>
                </div>
              </Alert>
            ) : null}

            {mode !== "month" ? (
              <QuickAddBar
                day={cursor}
                calendars={calendars}
                busy={busy}
                submitError={null}
                onCreate={(draft) => void createQuick(draft)}
                onOpenDetails={openDetailsFromQuick}
              />
            ) : null}

            {loading ? (
              <div role="status" className="flex flex-col gap-2" aria-live="polite">
                <p className="text-sm text-muted-foreground">Chargement…</p>
                <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/40" />
              </div>
            ) : mode === "month" ? (
              <MonthGrid
                days={range.days}
                month={cursor}
                today={today}
                events={events}
                submitError={error}
                busy={busy}
                inlineDay={inlineDay}
                onInlineOpen={(day) => {
                  setInlineDay(day);
                  setCursor(day);
                }}
                onInlineCancel={() => setInlineDay(null)}
                onCreate={(draft) => void createQuick(draft)}
                onSelectEvent={setSelected}
                onPage={shift}
                ariaLabel={gridLabel}
                move={move}
              />
            ) : mode === "agenda" ? (
              <AgendaView
                days={range.days}
                today={today}
                events={events}
                onSelectEvent={setSelected}
                move={move}
              />
            ) : (
              <DayColumns
                days={range.days}
                today={today}
                events={events}
                submitError={error}
                busy={busy}
                inlineDay={inlineDay}
                onInlineOpen={(day) => {
                  setInlineDay(day);
                  setCursor(day);
                }}
                onInlineCancel={() => setInlineDay(null)}
                onCreate={(draft) => void createQuick(draft)}
                onSelectEvent={setSelected}
                onPage={shift}
                ariaLabel={gridLabel}
                move={move}
              />
            )}

            {mode === "month" && events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun événement sur cette période.</p>
            ) : null}
          </div>
        </div>

        {/* --- Détails d'un événement ------------------------------------------- */}
        <EventDetailDialog
          event={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onEdit={(event) => {
            setEditorError(null);
            setEditor(editorFromEvent(event));
            setSelected(null);
          }}
          onDelete={(event) => {
            setSelected(event);
            setDeleteOpen(true);
          }}
          onRespond={(status) => void respond(status)}
        />

        {/* --- Confirmation de suppression --------------------------------------- */}
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => void onConfirmDelete()}
          title="Supprimer l'événement ?"
          message={
            selected
              ? `« ${selected.title} » sera définitivement supprimé.`
              : "Cette action est définitive."
          }
          confirmLabel="Supprimer"
          busy={busy}
          destructive
        />

        {/* --- Création / édition complète -------------------------------------- */}
        <EventEditorDialog
          editor={editor}
          calendars={calendars}
          busy={busy}
          error={editorError}
          onChange={(patch) =>
            setEditor((current) => (current ? { ...current, ...patch } : current))
          }
          onClose={() => setEditor(null)}
          onSubmit={() => void onSaveEditor()}
        />

        {/* --- Nouvel agenda partagé -------------------------------------------- */}
        <Dialog open={agendaOpen} onClose={() => setAgendaOpen(false)} title="Nouvel agenda">
          <form onSubmit={onCreateAgenda} method="post" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="agenda-name" className="text-sm font-medium leading-none">
                Nom de l'agenda
              </label>
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
              <button
                type="button"
                onClick={() => setAgendaOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={busy || agendaName.trim().length === 0}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                Créer l'agenda
              </button>
            </div>
          </form>
        </Dialog>
      </div>
    </CalendarTimeZoneProvider>
  );
}
