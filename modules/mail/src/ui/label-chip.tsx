import { cn } from "@workspace/ui";
import type { MessageLabelRef } from "../server.ts";
import { labelChipLabel, labelDotClasses } from "./label-tokens.ts";

export type LabelChipProps = {
  label: MessageLabelRef;
  /** Bouton de retrait (depuis la lecture ou la liste). */
  onRemove?: (labelId: string) => void;
  /** Clic sur la puce : filtre la liste sur ce libellé. */
  onFilter?: (labelId: string) => void;
  /** État actif (filtre en cours). */
  active?: boolean;
  className?: string;
};

/**
 * Puce de libellé — le nom porte le sens, la pastille le distingue d'un coup
 * d'œil. Aucune information ne dépend de la seule perception des couleurs.
 */
export function LabelChip({
  label,
  onRemove,
  onFilter,
  active = false,
  className,
}: LabelChipProps) {
  const body = (
    <>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", labelDotClasses(label.color))}
      />
      <span className="min-w-0 truncate">{label.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Retirer le libellé ${label.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(label.id);
          }}
          className="shrink-0 rounded opacity-70 transition-opacity hover:opacity-100"
        >
          ✕
        </button>
      ) : null}
    </>
  );

  const classes = cn(
    "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
    active ? "bg-accent text-accent-foreground" : "bg-muted text-foreground",
    className,
  );

  if (onFilter) {
    return (
      <button
        type="button"
        className={cn(classes, "transition-colors hover:bg-accent hover:text-accent-foreground")}
        title={labelChipLabel(label)}
        aria-pressed={active}
        onClick={() => onFilter(label.id)}
      >
        {body}
      </button>
    );
  }

  return (
    <span className={classes} title={labelChipLabel(label)}>
      {body}
    </span>
  );
}
