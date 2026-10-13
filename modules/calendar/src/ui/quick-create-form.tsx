import { Button, cn, Input, Label } from "@workspace/ui";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarOption } from "../server.ts";
import { formatAgendaDay } from "./event-labels.ts";
import {
  defaultQuickDraft,
  parseQuickInput,
  parseTimeInput,
  type QuickDraft,
  validateQuickDraft,
} from "./quick-create.ts";
import { parseDateInput } from "./view-state.ts";

/** Action de création : le parent appelle le serveur puis rafraîchit la liste. */
export type QuickCreateHandler = (draft: QuickDraft) => void | Promise<void>;

type QuickCreateCoreProps = {
  /** Jour proposé par défaut (celui affiché par la vue courante). */
  day: Date;
  busy: boolean;
  /** Message d'erreur remonté par le parent (échec d'enregistrement). */
  submitError: string | null;
  onCreate: QuickCreateHandler;
};

// ---------------------------------------------------------------------------
// Barre d'ajout rapide
// ---------------------------------------------------------------------------

export type QuickAddBarProps = QuickCreateCoreProps & {
  calendars: CalendarOption[];
  /** Ouvre l'éditeur complet prérempli (dialogue détaillé). */
  onOpenDetails?: (draft: QuickDraft, calendarId: string | undefined) => void;
};

/**
 * Barre d'ajout rapide, toujours visible au-dessus des vues Jour / Semaine /
 * Agenda : une ligne de saisie en langage naturel, avec l'interprétation
 * affichée en direct (« demain 9h » → « 14 octobre · 09:00 – 10:00 »).
 * Aucune modale, aucun aller-retour : Entrée crée l'événement.
 */
export function QuickAddBar({
  day,
  calendars,
  busy,
  submitError,
  onCreate,
  onOpenDetails,
}: QuickAddBarProps) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const defaultCalendarId = calendars.find((calendar) => calendar.isMine)?.id ?? calendars[0]?.id;

  const draft = useMemo(() => parseQuickInput(value, day), [value, day]);
  const previewDay = parseDateInput(draft.date) ?? day;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateQuickDraft(draft);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    void onCreate(draft);
    setValue("");
  }

  return (
    <section aria-label="Ajout rapide d'un événement" className="flex flex-col gap-1">
      <form
        onSubmit={submit}
        aria-label="Ajout rapide d'un événement"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-soft"
      >
        <span aria-hidden className="text-sm font-medium text-muted-foreground">
          ＋
        </span>
        <label htmlFor="quick-add-input" className="sr-only">
          Ajouter un événement
        </label>
        <Input
          id="quick-add-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          placeholder="Ajouter un événement — ex. « Point d'équipe demain 9h »"
          aria-describedby="quick-add-preview"
          className="h-8 min-w-56 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          autoComplete="off"
        />
        <p id="quick-add-preview" className="text-xs text-muted-foreground">
          {value.trim().length === 0
            ? "Date et heure lues dans votre saisie."
            : `${formatAgendaDay(previewDay, day)} · ${draft.startTime} – ${draft.endTime}`}
        </p>
        {onOpenDetails ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenDetails({ ...draft }, defaultCalendarId)}
          >
            Plus de détails
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={busy || value.trim().length === 0}>
          Créer
        </Button>
      </form>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Création rapide dans une case de la grille
// ---------------------------------------------------------------------------

export type CellQuickCreateProps = QuickCreateCoreProps & {
  onCancel: () => void;
  className?: string;
};

/**
 * Formulaire de création rapide affiché dans une case de la grille du mois :
 * titre, date, début, fin, journée entière. Le focus va au titre à
 * l'ouverture, Échap annule.
 */
export function CellQuickCreate({
  day,
  busy,
  submitError,
  onCreate,
  onCancel,
  className,
}: CellQuickCreateProps) {
  const [draft, setDraft] = useState<QuickDraft>(() => defaultQuickDraft(day));
  const [message, setMessage] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const startMinutes = parseTimeInput(draft.startTime) ?? 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateQuickDraft(draft);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    void onCreate(draft);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-popover p-2 text-left shadow-lift",
        className,
      )}
    >
      <Label htmlFor={`cell-quick-${draft.date}`} className="sr-only">
        Titre de l'événement
      </Label>
      <Input
        id={`cell-quick-${draft.date}`}
        ref={titleRef}
        value={draft.title}
        onChange={(event) => {
          setDraft({ ...draft, title: event.target.value });
          setMessage(null);
        }}
        placeholder="Nouvel événement"
        maxLength={255}
        className="h-7 text-xs"
      />
      <Input
        type="date"
        aria-label="Date"
        value={draft.date}
        onChange={(event) => setDraft({ ...draft, date: event.target.value })}
        className="h-7 text-xs"
      />
      <div className="flex items-center gap-1">
        <Input
          type="time"
          aria-label="Heure de début"
          value={draft.startTime}
          disabled={draft.allDay}
          onChange={(event) => {
            const next = parseTimeInput(event.target.value);
            // La fin suit le début pour garder une durée positive.
            const duration = Math.max(
              1,
              (parseTimeInput(draft.endTime) ?? startMinutes + 60) - startMinutes,
            );
            setDraft({
              ...draft,
              startTime: event.target.value,
              endTime: next === null ? draft.endTime : toTimeValue(next + duration),
            });
          }}
          className="h-7 text-xs"
        />
        <Input
          type="time"
          aria-label="Heure de fin"
          value={draft.endTime}
          disabled={draft.allDay}
          onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
          className="h-7 text-xs"
        />
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          className="accent-primary"
          checked={draft.allDay}
          onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
        />
        Journée entière
      </label>
      {(message ?? submitError) ? (
        <p role="alert" className="text-[11px] text-destructive">
          {message ?? submitError}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          Annuler
        </Button>
        <Button
          type="submit"
          size="sm"
          className="h-7 px-2 text-xs"
          loading={busy}
          disabled={draft.title.trim().length === 0}
        >
          Créer
        </Button>
      </div>
    </form>
  );
}

/** Minutes depuis minuit → `hh:mm` (utilisé pour garder la durée). */
function toTimeValue(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
