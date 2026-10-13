import { Badge } from "@workspace/ui";
import {
  type AssignmentStatusCode,
  type StatusTone,
  type SubmissionStatusCode,
  statusLabel,
  statusTone,
} from "../status.ts";

/**
 * Pastille de statut d'une copie ou d'un devoir. La teinte vient toujours
 * d'un token sémantique (`accent` corrigé, `attention` en retard, `destructive`
 * non rendu, `outline` neutre) : contraste vérifié dans les deux thèmes.
 */
const TONE_VARIANT: Record<StatusTone, "default" | "accent" | "outline" | "destructive"> = {
  accent: "accent",
  attention: "default",
  neutral: "outline",
  danger: "destructive",
};

/** Surcharges de la variante (Tailwind garde la dernière classe en conflit). */
const TONE_CLASS: Record<StatusTone, string> = {
  accent: "",
  attention: "bg-attention text-attention-foreground",
  neutral: "",
  danger: "",
};

export function StatusBadge({
  code,
  className,
}: {
  code: SubmissionStatusCode | AssignmentStatusCode;
  className?: string;
}) {
  const tone = statusTone(code);
  return (
    <Badge
      variant={TONE_VARIANT[tone]}
      className={TONE_CLASS[tone] ? [TONE_CLASS[tone], className].join(" ") : className}
    >
      {statusLabel(code)}
    </Badge>
  );
}
