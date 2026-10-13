import { Badge, cn } from "@workspace/ui";
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

/** Ligne de tâche partagée entre une liste et l'agrégat « Mes tâches ». */
export function TaskRow({
  task,
  subtitle,
  busy,
  assigneeName,
  onToggle,
  onOpen,
}: {
  task: TaskView;
  subtitle?: string;
  busy: boolean;
  assigneeName?: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const overdue = isOverdue(task);
  const labels = task.labels ?? [];
  const visibleLabels = labels.slice(0, MAX_VISIBLE_LABELS);
  const hiddenCount = labels.length - visibleLabels.length;

  return (
    <li className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/30">
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
