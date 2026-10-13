import { Alert, Button, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useEffect, useState } from "react";
import type { AssignmentView } from "../server.ts";
import { createAssignmentFn, updateAssignmentFn } from "../server.ts";
import { dueDateInputToIso, toDateInputValue } from "./format.ts";
import {
  MAX_ASSIGNMENT_INSTRUCTIONS,
  MAX_ASSIGNMENT_POINTS,
  MAX_ASSIGNMENT_TITLE,
} from "./limits.ts";

type Draft = {
  title: string;
  instructions: string;
  /** Échéance au format d'un `<input type="date">` (vide = sans échéance). */
  due: string;
  points: string;
};

const EMPTY_DRAFT: Draft = { title: "", instructions: "", due: "", points: "100" };

function draftFrom(assignment: AssignmentView | null): Draft {
  if (!assignment) return EMPTY_DRAFT;
  return {
    title: assignment.title,
    instructions: assignment.instructions,
    due: toDateInputValue(assignment.dueAt),
    points: String(assignment.points),
  };
}

/** Validation côté client, alignée sur le service (bornes et messages). */
function validate(draft: Draft): string | null {
  const title = draft.title.trim();
  if (title.length === 0) return "Le titre est obligatoire.";
  if (title.length > MAX_ASSIGNMENT_TITLE) {
    return `Le titre ne peut pas dépasser ${MAX_ASSIGNMENT_TITLE} caractères.`;
  }
  if (draft.instructions.length > MAX_ASSIGNMENT_INSTRUCTIONS) {
    return `Les consignes ne peuvent pas dépasser ${MAX_ASSIGNMENT_INSTRUCTIONS} caractères.`;
  }
  const points = Number(draft.points);
  if (!Number.isInteger(points) || points < 0 || points > MAX_ASSIGNMENT_POINTS) {
    return `Le barème doit être un nombre entier entre 0 et ${MAX_ASSIGNMENT_POINTS}.`;
  }
  return null;
}

/**
 * Devoir en création comme en édition — un seul formulaire pour les deux, où
 * vider un champ efface la consigne ou l'échéance. Les erreurs de saisie sont
 * annoncées en français sans fermer la modal.
 */
export function AssignmentDialog({
  open,
  onClose,
  courseId,
  assignment,
  onSaved,
  onRequestDelete,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  /** Devoir à modifier ; `null` pour une création. */
  assignment: AssignmentView | null;
  onSaved: () => void | Promise<void>;
  onRequestDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(assignment));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = assignment !== null;

  // Chaque ouverture repart des valeurs enregistrées : jamais le brouillon
  // abandonné par une annulation.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(assignment));
      setError(null);
    }
  }, [open, assignment]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const fields = {
        title: draft.title.trim(),
        instructions: draft.instructions,
        dueAt: dueDateInputToIso(draft.due),
        points: Number(draft.points),
      };
      if (editing && assignment) {
        await updateAssignmentFn({ data: { assignmentId: assignment.id, ...fields } });
      } else {
        await createAssignmentFn({ data: { courseId, ...fields } });
      }
      onClose();
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Modifier le devoir" : "Nouveau devoir"}
      footer={
        <>
          {editing && onRequestDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={onRequestDelete}
            >
              Supprimer
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="assignment-form" loading={busy}>
            {editing ? "Enregistrer" : "Créer le devoir"}
          </Button>
        </>
      }
    >
      <form id="assignment-form" onSubmit={submit} method="post" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="assignment-title">Titre</Label>
          <Input
            id="assignment-title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            maxLength={MAX_ASSIGNMENT_TITLE}
            placeholder="Exercices du chapitre 3"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="assignment-instructions">Consignes</Label>
          <textarea
            id="assignment-instructions"
            value={draft.instructions}
            onChange={(event) =>
              setDraft((current) => ({ ...current, instructions: event.target.value }))
            }
            rows={5}
            maxLength={MAX_ASSIGNMENT_INSTRUCTIONS}
            placeholder="Ce qui est attendu, les ressources à utiliser… (facultatif)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignment-due">Échéance</Label>
            <Input
              id="assignment-due"
              type="date"
              value={draft.due}
              onChange={(event) => setDraft((current) => ({ ...current, due: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Videz le champ pour un devoir sans échéance.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignment-points">Barème (points)</Label>
            <Input
              id="assignment-points"
              type="number"
              min={0}
              max={MAX_ASSIGNMENT_POINTS}
              value={draft.points}
              onChange={(event) =>
                setDraft((current) => ({ ...current, points: event.target.value }))
              }
            />
          </div>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}
