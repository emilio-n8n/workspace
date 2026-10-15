import { Alert, Button, cn, IconTrash, Input, Label, Spinner } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { edgeIds, nudgeIds } from "../dnd.ts";
import {
  createTaskSubtaskFn,
  deleteTaskSubtaskFn,
  listTaskSubtasksFn,
  reorderTaskSubtasksFn,
  type SubtaskView,
  updateTaskSubtaskFn,
} from "../server.ts";
import {
  describeSubtaskChange,
  progressLabel,
  type SubtaskProgress,
  sortSubtasks,
  subtaskProgress,
} from "../subtasks.ts";

/**
 * Sous-tâches d'une tâche — UN niveau, géré depuis l'édition en place de la
 * tâche.
 *
 * Les modifications sont appliquées tout de suite (pas d'étape « Enregistrer ») :
 * cocher une sous-tâche peut terminer la tâche parente côté serveur, et la
 * progression affichée ici doit dire la vérité. Chaque échec est annulé en
 * revenant à l'état précédent et signalé par un message.
 */
export function SubtasksEditor({
  taskId,
  onProgress,
  onError,
}: {
  taskId: string;
  onProgress: (progress: SubtaskProgress) => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<SubtaskView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const requestRef = useRef(0);

  // Le rappel de progression est lu via une référence : le composant ne se
  // recharge pas quand le parent change d'identité de fonction.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  const apply = useCallback((next: readonly SubtaskView[]) => {
    const ordered = sortSubtasks(next);
    setRows(ordered);
    onProgressRef.current(subtaskProgress(ordered));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError(null);
    try {
      const next = await listTaskSubtasksFn({ data: { taskId } });
      if (requestRef.current !== requestId) return;
      apply(next);
    } catch {
      if (requestRef.current !== requestId) return;
      setRows(null);
      setError("Impossible de charger les sous-tâches.");
    }
  }, [taskId, apply]);

  useEffect(() => {
    void load();
    return () => {
      // Un chargement en vol pour une autre tâche ne doit pas écraser l'écran.
      requestRef.current += 1;
    };
  }, [load]);

  function mark(subtaskId: string, busy: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(subtaskId);
      else next.delete(subtaskId);
      return next;
    });
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = title.trim();
    if (clean.length === 0 || creating || rows === null) return;

    setCreating(true);
    try {
      const created = await createTaskSubtaskFn({ data: { taskId, title: clean } });
      setTitle("");
      apply([...rows, created]);
      setAnnouncement(`Sous-tâche « ${created.title} » ajoutée.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Ajout impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function onToggle(row: SubtaskView) {
    const previous = rows ?? [];
    const isDone = !row.isDone;
    const optimistic = previous.map((item) => (item.id === row.id ? { ...item, isDone } : item));
    mark(row.id, true);
    apply(optimistic);
    setAnnouncement(
      describeSubtaskChange({ title: row.title, isDone, progress: subtaskProgress(optimistic) }),
    );
    try {
      await updateTaskSubtaskFn({ data: { subtaskId: row.id, isDone } });
    } catch (caught) {
      apply(previous);
      onError(caught instanceof Error ? caught.message : "Mise à jour impossible.");
    } finally {
      mark(row.id, false);
    }
  }

  async function onRemove(row: SubtaskView) {
    const previous = rows ?? [];
    mark(row.id, true);
    apply(previous.filter((item) => item.id !== row.id));
    setAnnouncement(`Sous-tâche « ${row.title} » supprimée.`);
    try {
      await deleteTaskSubtaskFn({ data: { subtaskId: row.id } });
    } catch (caught) {
      apply(previous);
      onError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      mark(row.id, false);
    }
  }

  async function onMove(row: SubtaskView, direction: -1 | 1 | "first" | "last") {
    const ordered = sortSubtasks(rows ?? []);
    const ids = ordered.map((item) => item.id);
    const from = ordered.findIndex((item) => item.id === row.id);
    if (from < 0) return;

    const nextIds =
      typeof direction === "number"
        ? nudgeIds(ids, from, direction)
        : edgeIds(ids, from, direction);
    if (nextIds === null) return;

    const byId = new Map(ordered.map((item) => [item.id, item]));
    const previous = rows ?? [];
    apply(
      nextIds.map((id) => byId.get(id)).filter((item): item is SubtaskView => item !== undefined),
    );
    setAnnouncement(
      `Sous-tâche « ${row.title} » déplacée en position ${nextIds.indexOf(row.id) + 1} sur ${nextIds.length}.`,
    );
    try {
      apply(await reorderTaskSubtasksFn({ data: { taskId, subtaskIds: nextIds } }));
    } catch (caught) {
      apply(previous);
      onError(caught instanceof Error ? caught.message : "Réorganisation impossible.");
    }
  }

  const progress = subtaskProgress(rows ?? []);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Sous-tâches</legend>

      {error ? (
        <Alert tone="danger" className="flex flex-col items-start gap-2">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
        </Alert>
      ) : rows === null ? (
        <Spinner className="py-1" size={12} label="Chargement des sous-tâches…" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune sous-tâche pour l'instant. Ajoutez la première ci-dessous.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{progressLabel(progress)}</p>
          <ul className="flex flex-col gap-1">
            {rows.map((row, index) => (
              <li
                key={row.id}
                className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1"
              >
                <input
                  id={`subtask-${row.id}`}
                  type="checkbox"
                  className="accent-primary"
                  checked={row.isDone}
                  disabled={pending.has(row.id)}
                  aria-busy={pending.has(row.id) || undefined}
                  aria-label={
                    row.isDone
                      ? `Réouvrir la sous-tâche « ${row.title} »`
                      : `Marquer la sous-tâche « ${row.title} » terminée`
                  }
                  onChange={() => void onToggle(row)}
                />
                <Label
                  htmlFor={`subtask-${row.id}`}
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-normal",
                    row.isDone && "text-muted-foreground line-through",
                  )}
                >
                  {row.title}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  aria-label={`Monter « ${row.title} »`}
                  title="Monter"
                  onClick={() => void onMove(row, -1)}
                >
                  <span aria-hidden>↑</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === rows.length - 1}
                  aria-label={`Descendre « ${row.title} »`}
                  title="Descendre"
                  onClick={() => void onMove(row, 1)}
                >
                  <span aria-hidden>↓</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Supprimer la sous-tâche « ${row.title} »`}
                  title="Supprimer"
                  onClick={() => void onRemove(row)}
                >
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form
        onSubmit={onAdd}
        method="post"
        aria-busy={creating || undefined}
        className="flex items-end gap-2"
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="new-subtask-title" className="text-xs">
            Nouvelle sous-tâche
          </Label>
          <Input
            id="new-subtask-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Étape suivante"
            maxLength={200}
            disabled={creating}
          />
        </div>
        <Button type="submit" size="sm" loading={creating} disabled={title.trim().length === 0}>
          Ajouter
        </Button>
      </form>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  );
}
