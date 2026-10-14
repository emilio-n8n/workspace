import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type EmptyStateBlockProps = {
  /** Icône illustrative, rendue en 24 px dans la teinte atténuée. */
  icon?: ReactNode;
  title: string;
  /** Explication courte, limitée à la largeur de lecture. */
  description?: ReactNode;
  /** Action principale (bouton, lien) affichée sous le texte. */
  action?: ReactNode;
  /** Action secondaire, à gauche de l'action principale. */
  secondaryAction?: ReactNode;
  /** Variante discrète : ni bordure ni fond, pour l'intérieur d'une carte. */
  bare?: boolean;
  className?: string;
};

/**
 * État vide enrichi — grand frère de `EmptyState` : une deuxième action, une
 * description en texte libre et une variante discrète (`bare`) pour les
 * panneaux déjà bordés. `role="status"` annonce le message dès son apparition
 * (liste filtrée sans résultat, dossier vide), ce qu'un simple paragraphe ne
 * fait pas.
 */
export function EmptyStateBlock({
  icon,
  title,
  description,
  action,
  secondaryAction,
  bare = false,
  className,
}: EmptyStateBlockProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 p-8 text-center",
        bare ? undefined : "rounded-xl border border-border bg-card",
        className,
      )}
    >
      {icon ? <span className="text-muted-foreground [&_svg]:size-6">{icon}</span> : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction}
          {action}
        </div>
      ) : null}
    </div>
  );
}
