import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type PageHeaderProps = {
  /** Titre de la page, rendu comme unique <h1> (font-display). */
  title: string;
  /** Description courte affichée sous le titre. */
  description?: ReactNode;
  /** Actions alignées à droite (boutons, menus). */
  actions?: ReactNode;
  /** Cible du lien de retour optionnel. */
  backHref?: string;
  /** Libellé du lien de retour (défaut : « Retour »). */
  backLabel?: string;
  className?: string;
};

/**
 * En-tête de page — le <h1> standard de l'application : lien de retour
 * optionnel, titre en font-display, description et actions alignées à droite.
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "Retour",
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start gap-2", className)}>
      {backHref ? (
        <a
          href={backHref}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {backLabel}
        </a>
      ) : null}
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
