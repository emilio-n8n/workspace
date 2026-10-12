import { cn } from "../cn.ts";

export type SeparatorProps = {
  /** Sens du filet (défaut : horizontal). */
  orientation?: "horizontal" | "vertical";
  className?: string;
};

/**
 * Séparateur — filet visuel d'un pixel, horizontal ou vertical, exposé aux
 * technologies d'assistance comme séparateur.
 */
export function Separator({ orientation = "horizontal", className }: SeparatorProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: rôle explicite volontaire, <hr> ne peut pas exprimer la variante verticale.
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-5 w-px",
        className,
      )}
    />
  );
}
