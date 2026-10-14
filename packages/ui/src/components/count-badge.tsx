import { cn } from "../cn.ts";
import { pluralizeFr } from "../lib/french-text.ts";

/** Pastille de comptage — total d'éléments, non lus, tâches restantes… */
export function CountBadge({
  count,
  max = 99,
  label = "éléments",
  destructive = false,
  className,
}: {
  count: number;
  /** À partir de `max + 1`, affiche « max+ » (défaut : 99). */
  max?: number;
  /** Libellé annoncé aux lecteurs d'écran (défaut : « éléments »). */
  label?: string;
  /** Rouge au lieu du vert (signalement, échecs). */
  destructive?: boolean;
  className?: string;
}) {
  const shown = count > max ? `${max}+` : `${count}`;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        destructive
          ? "bg-destructive text-destructive-foreground"
          : "bg-primary text-primary-foreground",
        className,
      )}
    >
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{pluralizeFr(count, label)}</span>
    </span>
  );
}

/** Point d'état — badge rond signalant un statut (en ligne, non lu, échec). */
export function DotBadge({
  label,
  tone = "primary",
  className,
}: {
  /** Nom annoncé au lecteur d'écran (défaut : « État à signaler »). */
  label?: string;
  /** Couleur du point via token sémantique (défaut : primaire). */
  tone?: "primary" | "accent" | "destructive" | "attention";
  className?: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    primary: "bg-primary text-primary-foreground",
    accent: "bg-accent text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    attention: "bg-attention text-attention-foreground",
  };
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex size-2 rounded-full", toneClasses[tone], className)}
    />
  );
}
