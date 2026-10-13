import { cn, Label } from "@workspace/ui";
import { useId } from "react";
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
 * Champ « Notes du présentateur » d'une diapositive. Les notes ne sont jamais
 * montrées au spectateur : elles servent en mode présentation, et une pastille
 * les signale dans la bande de vignettes.
 */
export function SlideNotesField({ slide, index, canEdit, onNotesChange }: SlideNotesFieldProps) {
  const baseId = useId();
  const counterId = `${baseId}-counter`;
  const hintId = `${baseId}-hint`;
  const remaining = notesRemaining(slide.notes);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor="slide-notes">Notes du présentateur</Label>
        <span
          id={counterId}
          className={cn(
            "text-[11px] tabular-nums",
            remaining === 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {notesCounterLabel(slide.notes)}
        </span>
      </div>
      <textarea
        id="slide-notes"
        value={slide.notes}
        disabled={!canEdit}
        onChange={(event) => onNotesChange(event.target.value)}
        rows={4}
        maxLength={MAX_NOTES_CHARS}
        placeholder="Ce que vous voulez dire pendant cette diapositive."
        aria-label={`Notes du présentateur — ${slideTitle(slide, index)}`}
        aria-describedby={`${counterId} ${hintId}`}
        className="resize-y rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
      />
      <p id={hintId} className="text-[11px] text-muted-foreground">
        {canEdit
          ? "Visible par vous seul, en mode présentation."
          : "Lecture seule : ces notes ne sont pas modifiables."}
      </p>
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
