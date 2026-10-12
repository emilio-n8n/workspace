import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type EmptyStateProps = {
  /** Icône illustrative, rendue en 20 px dans la teinte atténuée. */
  icon?: ReactNode;
  /** Titre court de l'état vide. */
  title: string;
  /** Phrase d'explication optionnelle, limitée à la largeur de lecture. */
  hint?: string;
  /** Action principale (bouton, lien) affichée sous le texte. */
  action?: ReactNode;
  className?: string;
};

/**
 * État vide — bloc centré présenté comme une carte pour signaler l'absence de
 * contenu : icône, titre, indice et action optionnelle.
 */
export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-8 text-center",
        className,
      )}
    >
      {icon ? <span className="text-muted-foreground [&_svg]:size-5">{icon}</span> : null}
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-md text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
