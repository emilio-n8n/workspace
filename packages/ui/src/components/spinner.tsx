import { cn } from "../cn.ts";

export type SpinnerProps = {
  /** Diamètre de l'anneau en pixels (défaut : 16). */
  size?: number;
  /** Libellé visible à côté de l'anneau ; fourni, il porte aussi l'état annoncé. */
  label?: string;
  className?: string;
};

/**
 * Anneau de chargement — un disque bordé dont une seule portion est teintée,
 * mise en rotation. Purement visuel par défaut (`aria-hidden`) : l'état est
 * porté par la zone qui l'accueille (`LoadingRegion`, `LoadingState`) ou par le
 * libellé fourni ici (`role="status"`).
 *
 * Sous `prefers-reduced-motion`, la rotation ralentit (2 s) au lieu de
 * disparaître : l'activité reste signalée sans mouvement agressif.
 */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        aria-hidden
        className="inline-block shrink-0 animate-spin rounded-full border-2 border-border border-t-primary"
        style={{ width: size, height: size }}
      />
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
    </span>
  );
}

export type LoadingStateProps = {
  /** Libellé visible et annoncé (défaut : « Chargement… »). */
  label?: string;
  /** Précision discrète sous le libellé (facultative). */
  hint?: string;
  /** Diamètre de l'anneau en pixels (défaut : 28). */
  size?: number;
  className?: string;
};

/**
 * État de chargement de page ou de bloc : anneau tournant centré, libellé
 * lisible et précision facultative. `role="status"` + `aria-live` : l'attente
 * est annoncée une fois aux lecteurs d'écran, sans voler le focus.
 *
 * À préférer aux squelettes (`Skeleton*`) quand la forme du contenu est
 * inconnue ou le temps d'attente court ; les squelettes restent la bonne
 * réponse quand la mise en page finale est connue à l'avance.
 */
export function LoadingState({
  label = "Chargement…",
  hint,
  size = 28,
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3 py-10 text-center", className)}
    >
      <Spinner size={size} />
      <span className="text-sm font-medium text-foreground">{label}</span>
      {hint ? <span className="max-w-sm text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
