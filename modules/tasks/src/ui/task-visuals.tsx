import { cn } from "@workspace/ui";
import type { TaskLabelColor } from "../schema.ts";

/**
 * Puces de couleur — priorités et étiquettes.
 *
 * Règle absolue : aucune couleur codée en dur. Chaque puce pointe vers un
 * TOKEN sémantique du design system, ce qui garantit la parité thème clair /
 * thème sombre sans dupliquer quoi que ce soit ici.
 */

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
};

/** Priorité → token de couleur (haute = destructive, moyenne = attention). */
const PRIORITY_DOT_CLASS: Record<string, string> = {
  high: "bg-destructive",
  medium: "bg-attention",
  low: "bg-muted-foreground",
};

export const LABEL_COLOR_LABELS: Record<TaskLabelColor, string> = {
  green: "Vert",
  blue: "Bleu",
  amber: "Ambre",
  violet: "Violet",
  red: "Rouge",
  slate: "Ardoise",
};

/** Palette d'étiquettes → tokens sémantiques (jamais une valeur en dur). */
const LABEL_DOT_CLASS: Record<TaskLabelColor, string> = {
  green: "bg-primary",
  blue: "bg-chart-3",
  amber: "bg-attention",
  violet: "bg-chart-5",
  red: "bg-destructive",
  slate: "bg-muted-foreground",
};

/** Ordre de la palette proposée à la création (même jeu que l'enum SQL). */
export const TASK_LABEL_COLOR_VALUES: readonly TaskLabelColor[] = [
  "green",
  "blue",
  "amber",
  "violet",
  "red",
  "slate",
];

/** Priorité inconnue (donnée incomplète) : rendu neutre, jamais invisible. */
export function priorityDotClass(priority: string): string {
  return PRIORITY_DOT_CLASS[priority] ?? PRIORITY_DOT_CLASS.medium ?? "bg-muted-foreground";
}

export function labelDotClass(color: string): string {
  return LABEL_DOT_CLASS[color as TaskLabelColor] ?? LABEL_DOT_CLASS.blue ?? "bg-muted-foreground";
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? PRIORITY_LABELS.medium ?? "Moyenne";
}

/** Puce de priorité — la couleur demeure une information secondaire : le libellé texte reste lisible. */
export function PriorityDot({
  priority,
  withLabel = true,
  className,
}: {
  priority: string;
  withLabel?: boolean;
  className?: string;
}) {
  const label = priorityLabel(priority);
  return (
    <span
      role="img"
      aria-label={`Priorité ${label}`}
      title={`Priorité ${label}`}
      className={cn("flex shrink-0 items-center gap-1", className)}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", priorityDotClass(priority))}
      />
      {withLabel ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      ) : null}
    </span>
  );
}

/** Pastille d'étiquette : puce de couleur + nom, tronquée si le nom est long. */
export function LabelChip({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", labelDotClass(color))} />
      <span className="truncate">{name}</span>
    </span>
  );
}
