import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
export type StatusBadgeSize = "sm" | "md";

const statusBadgeVariants = cva("inline-flex items-center gap-1.5 rounded-md font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      info: "border border-border bg-accent text-accent-foreground",
      success: "border border-accent/50 bg-accent/40 text-accent-foreground",
      warning: "border border-attention/50 bg-attention/10 text-foreground",
      danger: "border border-destructive/40 bg-destructive/10 text-destructive",
    },
    size: {
      sm: "px-1.5 py-0.5 text-xs",
      md: "px-2 py-1 text-xs",
    },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export type StatusBadgeVariants = VariantProps<typeof statusBadgeVariants>;

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
  StatusBadgeVariants & {
    /** Pastille d'état colorée affichée devant le libellé (signaler, non vu…). */
    dot?: boolean;
  };

/**
 * Badge d'état — pastille sémantique (« Actif », « Non lu », « En attente »)
 * avec cinq tons assortis aux tokens. Contrairement à `Badge`, le libellé est
 * normatif : les tons `warning` et `danger` ne s'utilisent qu'avec un texte
 * explicite.
 */
export function StatusBadge({
  className,
  tone = "neutral",
  size = "sm",
  dot = false,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ tone, size }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-current",
            tone === "neutral" ? "bg-muted-foreground" : undefined,
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
