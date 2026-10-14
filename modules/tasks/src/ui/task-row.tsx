import { Badge, cn } from "@workspace/ui";
import type { DragEvent, KeyboardEvent } from "react";
import type { DropEdge } from "../dnd.ts";
import { handleHint } from "../dnd.ts";
import type { TaskView } from "../server.ts";
import { LabelChip, PriorityDot } from "./task-visuals.tsx";

/** Au-delà de deux pastilles, la ligne devient illisible : on compte le reste. */
const MAX_VISIBLE_LABELS = 2;

export function isOverdue(task: TaskView): boolean {
  return task.status !== "done" && task.dueAt !== null && new Date(task.dueAt) < new Date();
}

export function formatDue(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Réglages de glisser-déposer d'une ligne (ordre manuel, sans regroupement). */
export type TaskRowDrag = {
  enabled: boolean;
  dragging: boolean;
  dropEdge: DropEdge | null;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

/** Ligne de tâche partagée entre une liste et l'agrégat « Mes tâches ». */
export function TaskRow({
  task,
  subtitle,
  busy,
  assigneeName,
  onToggle,
  onOpen,
  drag,
}: {
  task: TaskView;
  subtitle?: string;
  busy: boolean;
  assigneeName?: string;
  onToggle: () => void;
  onOpen: () => void;
  drag?: TaskRowDrag;
}) {
  const overdue = isOverdue(task);
  const labels = task.labels ?? [];
  const visibleLabels = labels.slice(0, MAX_VISIBLE_LABELS);
  const hiddenCount = labels.length - visibleLabels.length;
  const hasSubtasks = task.subtaskTotal > 0;

  return (
    <li
      className={cn(
        "relative flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/30",
        drag?.dragging && "opacity-50",
      )}
      onDragOver={drag?.enabled ? drag.onDragOver : undefined}
      onDrop={drag?.enabled ? drag.onDrop : undefined}
    >
      {drag?.dropEdge ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 h-0.5 bg-primary",
            drag.dropEdge === "top" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}

      {drag?.enabled ? (
        <button
          type="button"
          draggable
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          onKeyDown={drag.onHandleKeyDown}
          title={`Réordonner « ${task.title} ». ${handleHint()}`}
          aria-label={`Réordonner « ${task.title} »`}
          className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <span aria-hidden className="block text-xs leading-none tracking-tighter">
            ⠿
          </span>
        </button>
      ) : null}

      <input
        type="checkbox"
        className="accent-primary"
        checked={task.status === "done"}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={
          task.status === "done"
            ? `Réouvrir « ${task.title} »`
            : `Marquer « ${task.title} » terminée`
        }
        onChange={onToggle}
      />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block truncate text-sm",
            task.status === "done" && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </button>

      {task.status === "in_progress" ? <Badge variant="accent">En cours</Badge> : null}

      {hasSubtasks ? (
        <span
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
          title={`Sous-tâches : ${task.subtaskDone} sur ${task.subtaskTotal} terminées`}
          aria-label={`Sous-tâches : ${task.subtaskDone} sur ${task.subtaskTotal} terminées`}
        >
          {task.subtaskDone}/{task.subtaskTotal}
        </span>
      ) : null}

      <PriorityDot priority={task.priority} />

      {labels.length > 0 ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {visibleLabels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
          {hiddenCount > 0 ? (
            <span
              className="text-[10px] text-muted-foreground"
              title={labels
                .slice(MAX_VISIBLE_LABELS)
                .map((label) => label.name)
                .join(", ")}
            >
              +{hiddenCount}
            </span>
          ) : null}
        </span>
      ) : null}

      {task.dueAt ? (
        <span
          className={cn(
            "shrink-0 text-xs",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue ? <span className="sr-only">En retard — </span> : null}
          {formatDue(task.dueAt)}
        </span>
      ) : null}

      {assigneeName ? (
        <span
          title={`Assignée à ${assigneeName}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground"
        >
          {assigneeName.slice(0, 1).toUpperCase()}
        </span>
      ) : null}
    </li>
  );
}
