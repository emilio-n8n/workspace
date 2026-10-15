// biome-ignore-all lint/a11y/useSemanticElements: éléments interactifs stylés ; le rôle et le clavier sont posés explicitement à côté.
import { Button, cn, Input, Label } from "@workspace/ui";
import {
  isFiltering,
  TASK_DUE_FILTERS,
  TASK_STATUS_FILTERS,
  type TaskDueFilter,
  type TaskFilterCriteria,
} from "../filters.ts";
import type { TaskLabelView } from "../server.ts";
import { labelDotClass } from "./task-visuals.tsx";

/**
 * Filtres de la liste — UNE rangée compacte (état, recherche, échéance,
 * étiquettes), posée dans la barre d'outils de `tasks-view`. Le modèle Slides
 * s'applique : petits boutons `ghost`/`secondary` séparés par de fins filets,
 * pas de pavés empilés.
 *
 * L'état reste TOUJOURS visible sans puces redondantes : un bouton d'état
 * enfoncé, un champ rempli ou une étiquette allumée le disent, et le compteur
 * « affichées / total » accompagne « Tout effacer » dès qu'un filtre agit
 * (un filtre oublié fait croire à une liste vide).
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
  function toggleLabel(labelId: string, checked: boolean) {
    onChange({
      labelIds: checked
        ? [...criteria.labelIds, labelId]
        : criteria.labelIds.filter((current) => current !== labelId),
    });
  }

  return (
    <div role="group" aria-label="Filtres" className="flex items-center gap-1">
      {TASK_STATUS_FILTERS.map((item) => (
        <Button
          key={item.id}
          variant={criteria.status === item.id ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={criteria.status === item.id}
          onClick={() => onChange({ status: item.id })}
        >
          {item.label}
        </Button>
      ))}

      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

      <Label htmlFor="task-search" className="sr-only">
        Rechercher
      </Label>
      <Input
        id="task-search"
        type="search"
        value={criteria.query}
        onChange={(event) => onChange({ query: event.target.value })}
        placeholder="Titre ou notes…"
        className="h-8 w-44 text-xs"
      />

      <Label htmlFor="task-due-filter" className="sr-only">
        Échéance
      </Label>
      <select
        id="task-due-filter"
        value={criteria.due}
        onChange={(event) => onChange({ due: event.target.value as TaskDueFilter })}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {TASK_DUE_FILTERS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      {labels.length > 0 ? (
        <>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
          <div role="group" aria-label="Étiquettes" className="flex items-center gap-1">
            {labels.map((label) => {
              const active = criteria.labelIds.includes(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLabel(label.id, !active)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                    active
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", labelDotClass(label.color))}
                  />
                  <span className="max-w-32 truncate">{label.name}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {isFiltering(criteria) ? (
        <>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Tout effacer
          </Button>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            {shown} / {total}
          </span>
        </>
      ) : null}
    </div>
  );
}
