import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type AlertTone = "info" | "success" | "warning" | "danger";

export type AlertProps = {
  /** Tonalité sémantique du bandeau (défaut : info). */
  tone?: AlertTone;
  /** Titre optionnel, mis en gras au-dessus du corps. */
  title?: string;
  children: ReactNode;
  className?: string;
};

const toneClasses: Record<AlertTone, string> = {
  info: "border-border bg-muted text-foreground",
  success: "border-border bg-accent/40 text-accent-foreground",
  warning: "border-attention/50 bg-attention/10 text-foreground",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

const toneRoles: Record<AlertTone, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "status",
  danger: "alert",
};

/**
 * Bandeau d'alerte en ligne — remplace les encarts répétés avec quatre
 * tonalités (info, succès, avertissement, danger) et l'annonce ARIA adaptée.
 */
export function Alert({ tone = "info", title, children, className }: AlertProps) {
  return (
    <div
      role={toneRoles[tone]}
      className={cn("rounded-md border px-3 py-2 text-sm", toneClasses[tone], className)}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children}
    </div>
  );
}
