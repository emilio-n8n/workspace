import { cn, Label } from "@workspace/ui";
import { useId, useState } from "react";
import { type EditorSlide, slideTitle } from "../editor-model.ts";
import {
  MAX_NOTES_CHARS,
  notesCounterLabel,
  notesRemaining,
  presenterNote,
} from "../slide-notes.ts";

export type SlideNotesFieldProps = {
  slide: EditorSlide;
  index: number;
  canEdit: boolean;
  onNotesChange: (notes: string) => void;
};

/**
 * Barre « Notes du présentateur » : repliée par défaut, dépliée au clic pour
 * saisir ce qu'on dira pendant la diapositive. Les notes ne sont jamais
 * montrées au spectateur ; une pastille les signale dans la colonne des
 * diapositives et elles s'affichent en mode présentation.
 */
export function SlideNotesField({ slide, index, canEdit, onNotesChange }: SlideNotesFieldProps) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const counterId = `${baseId}-counter`;
  const remaining = notesRemaining(slide.notes);
  const hasNotes = slide.notes.trim().length > 0;

  return (
    <div className="print-hide border-t border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className={cn("transition-transform duration-150", open && "rotate-90")}
          >
            ▸
          </span>
          Notes du présentateur
        </button>
        <span
          id={counterId}
          className={cn(
            "text-[11px] tabular-nums",
            remaining === 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {notesCounterLabel(slide.notes)}
        </span>
        {!open ? (
          <span className="truncate text-[11px] italic text-muted-foreground/80">
            {hasNotes ? slide.notes : "Aucune note pour cette diapositive."}
          </span>
        ) : null}
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
          {canEdit ? "Visibles par vous seul, en présentation." : "Lecture seule."}
        </span>
      </div>
      {open ? (
        <div className="px-3 pb-3">
          <Label htmlFor="slide-notes" className="sr-only">
            Notes du présentateur
          </Label>
          <textarea
            id="slide-notes"
            value={slide.notes}
            disabled={!canEdit}
            onChange={(event) => onNotesChange(event.target.value)}
            rows={3}
            maxLength={MAX_NOTES_CHARS}
            placeholder="Ce que vous voulez dire pendant cette diapositive."
            aria-label={`Notes du présentateur — ${slideTitle(slide, index)}`}
            aria-describedby={counterId}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      ) : null}
    </div>
  );
}

export type PresenterNotesProps = {
  slide: EditorSlide;
  index: number;
  /** Identifiant utilisé par le bouton qui affiche ou masque le panneau. */
  id: string;
};

/**
 * Notes de la diapositive courante pendant la présentation (lecture seule :
 * une modification ferait doublon avec l'autosave de l'éditeur).
 */
export function PresenterNotes({ slide, index, id }: PresenterNotesProps) {
  const note = presenterNote(slide.notes);
  const title = slideTitle(slide, index);
  return (
    <section
      id={id}
      aria-label="Notes du présentateur"
      className="flex max-h-[45vh] w-full max-w-sm shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-rail-active bg-rail-active/60 p-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-rail-foreground/70">
        Notes — {title}
      </h2>
      <p
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed",
          note.empty && "italic text-rail-foreground/70",
        )}
      >
        {note.text}
      </p>
    </section>
  );
}
