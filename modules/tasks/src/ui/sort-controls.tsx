import { Label } from "@workspace/ui";
import { Fragment, type ReactNode } from "react";
import {
  TASK_GROUPS,
  TASK_SORTS,
  type TaskGroup,
  type TaskGroupId,
  type TaskSortId,
} from "../organize.ts";
import type { TaskView } from "../server.ts";

/**
 * Contrôles de tri et de regroupement.
 *
 * Ce sont des `<select>` natifs accompagnés d'un `<label>` : étiquetés,
 * annoncés correctement par les lecteurs d'écran et utilisables au clavier
 * sans primitive supplémentaire.
 */
export function SortBar({
  sort,
  group,
  groupOptions,
  onSortChange,
  onGroupChange,
}: {
  sort: TaskSortId;
  group: TaskGroupId;
  groupOptions: readonly TaskGroupId[];
  onSortChange: (sort: TaskSortId) => void;
  onGroupChange: (group: TaskGroupId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="task-sort" className="text-xs">
          Trier par
        </Label>
        <select
          id="task-sort"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as TaskSortId)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {TASK_SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="task-group" className="text-xs">
          Regrouper par
        </Label>
        <select
          id="task-group"
          value={group}
          onChange={(event) => onGroupChange(event.target.value as TaskGroupId)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {TASK_GROUPS.filter((option) => groupOptions.includes(option.id)).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Sections de regroupement. Chaque section porte un titre de niveau 3 associé
 * à sa liste (`aria-labelledby`), pour qu'un lecteur d'écran annonce
 * « En retard, 3 tâches » avant d'énumérer les lignes.
 */
export function TaskSections<T extends TaskView>({
  groups,
  renderRow,
}: {
  groups: TaskGroup<T>[];
  renderRow: (task: T) => ReactNode;
}) {
  return (
    <>
      {groups.map((group, index) => (
        <section
          // L'identifiant DOM est dérivé de la position : un groupe « par liste »
          // porte un nom d'utilisateur, qui n'a rien à faire dans un `id`.
          key={group.id}
          aria-labelledby={`task-group-heading-${index}`}
          className="border-b border-border/60 last:border-b-0"
        >
          <h3
            id={`task-group-heading-${index}`}
            className="sticky top-0 z-10 flex items-baseline gap-2 bg-card/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur"
          >
            <span>{group.label}</span>
            <span className="tabular-nums">{group.tasks.length}</span>
          </h3>
          <ul className="flex flex-col">
            {group.tasks.map((task) => (
              <Fragment key={task.id}>{renderRow(task)}</Fragment>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Regroupements offerts selon l'écran : « par liste » n'a de sens que dans l'agrégat. */
export const LIST_GROUP_OPTIONS: readonly TaskGroupId[] = ["none", "due", "priority"];
export const MY_TASKS_GROUP_OPTIONS: readonly TaskGroupId[] = ["none", "due", "priority", "list"];
