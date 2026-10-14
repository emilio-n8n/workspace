import { Button, cn, IconClose, Input, Label } from "@workspace/ui";
import {
  activeFilters,
  isFiltering,
  TASK_DUE_FILTERS,
  type TaskDueFilter,
  type TaskFilterCriteria,
} from "../filters.ts";
import type { TaskLabelView } from "../server.ts";
import { labelDotClass } from "./task-visuals.tsx";

/**
 * Barre de recherche et de filtres combinés : texte, échéance, étiquettes.
 * L'état est TOUJOURS visible — puces retirables + compteur — parce qu'un
 * filtre oublié fait croire à une liste vide.
 */
export function FilterBar({
  criteria,
  labels,
  shown,
  total,
  onChange,
  onReset,
}: {
  criteria: TaskFilterCriteria;
  labels: TaskLabelView[];
  shown: number;
  total: number;
  onChange: (patch: Partial<TaskFilterCriteria>) => void;
  onReset: () => void;
}) {
  const labelNames = new Map(labels.map((label) => [label.id, label.name]));
  const chips = activeFilters(criteria, labelNames);

  function removeChip(id: string) {
    if (id === "query") onChange({ query: "" });
    else if (id === "status") onChange({ status: "all" });
    else if (id === "due") onChange({ due: "all" });
    else if (id.startsWith("label:")) {
      const labelId = id.slice("label:".length);
      onChange({ labelIds: criteria.labelIds.filter((current) => current !== labelId) });
    }
  }

  function toggleLabel(labelId: string, checked: boolean) {
    onChange({
      labelIds: checked
        ? [...criteria.labelIds, labelId]
        : criteria.labelIds.filter((current) => current !== labelId),
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="task-search" className="text-xs">
            Rechercher
          </Label>
          <Input
            id="task-search"
            type="search"
            value={criteria.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Titre ou notes…"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="task-due-filter" className="text-xs">
            Échéance
          </Label>
          <select
            id="task-due-filter"
            value={criteria.due}
            onChange={(event) => onChange({ due: event.target.value as TaskDueFilter })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_DUE_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {labels.length > 0 ? (
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">Étiquettes</legend>
          <span aria-hidden className="text-xs text-muted-foreground">
            Étiquettes
          </span>
          {labels.map((label) => (
            <span key={label.id} className="flex items-center gap-1.5">
              <input
                id={`filter-label-${label.id}`}
                type="checkbox"
                className="accent-primary"
                checked={criteria.labelIds.includes(label.id)}
                onChange={(event) => toggleLabel(label.id, event.target.checked)}
              />
              <Label
                htmlFor={`filter-label-${label.id}`}
                className="flex items-center gap-1.5 text-xs font-normal"
              >
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", labelDotClass(label.color))}
                />
                {label.name}
              </Label>
            </span>
          ))}
        </fieldset>
      ) : null}

      {isFiltering(criteria) ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtres actifs :</span>
          <ul className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  onClick={() => removeChip(chip.id)}
                  aria-label={`Retirer le filtre ${chip.label}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="max-w-40 truncate">{chip.label}</span>
                  <IconClose className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Tout effacer
          </Button>
          <span className="text-xs text-muted-foreground" aria-hidden>
            {shown} / {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
