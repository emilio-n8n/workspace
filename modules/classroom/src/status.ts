/**
 * Statuts des copies et des devoirs — logique pure, sans base de données,
 * partagée par le service (remplissage des vues) et par l'interface (libellés
 * et pastilles). Une seule vérité pour « en retard » : la comparant à
 * l'échéance, jamais l'inverse.
 */

/**
 * Statut d'une copie rendue. « Noté » précède toujours « En retard » : une
 * copie corrigée reste corrigée, même remise après l'échéance.
 */
export type SubmissionStatusCode = "graded" | "late" | "submitted";

/** Statut d'un devoir vu par un élève. */
export type AssignmentStatusCode = "graded" | "late" | "submitted" | "missing" | "todo";

/** Tonalité sémantique d'un statut, mappée sur les tokens par l'interface. */
export type StatusTone = "accent" | "attention" | "neutral" | "danger";

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatusCode, string> = {
  graded: "Noté",
  late: "En retard",
  submitted: "Rendu",
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatusCode, string> = {
  graded: "Noté",
  late: "En retard",
  submitted: "Rendu",
  missing: "Non rendu",
  todo: "À rendre",
};

/**
 * Une copie remise strictement après l'échéance est en retard. Sans échéance,
 * aucune copie n'est jamais en retard ; une date illisible non plus (on refuse
 * de deviner).
 */
export function isLateSubmission(submittedAt: string, dueAt: string | null): boolean {
  if (!dueAt) return false;
  return instant(submittedAt) > instant(dueAt);
}

/** L'échéance est-elle dépassée à l'instant `now` (l'horloge de l'appelant) ? */
export function isOverdue(dueAt: string | null, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  return now.getTime() > instant(dueAt);
}

/** Statut d'une copie rendue, priorités : noté > en retard > rendu. */
export function submissionStatus(input: {
  submittedAt: string;
  dueAt: string | null;
  grade: number | null;
}): SubmissionStatusCode {
  if (input.grade !== null) return "graded";
  return isLateSubmission(input.submittedAt, input.dueAt) ? "late" : "submitted";
}

/** Statut d'un devoir pour un élève — `submission` vaut `null` sans copie. */
export function assignmentStatus(input: {
  submission: { submittedAt: string; grade: number | null } | null;
  dueAt: string | null;
  now?: Date;
}): AssignmentStatusCode {
  if (!input.submission) return isOverdue(input.dueAt, input.now) ? "missing" : "todo";
  if (input.submission.grade !== null) return "graded";
  return isLateSubmission(input.submission.submittedAt, input.dueAt) ? "late" : "submitted";
}

/** Tonalité de la pastille : amended=corrigé, ambre=en retard, neutre=à rendre. */
export function statusTone(code: SubmissionStatusCode | AssignmentStatusCode): StatusTone {
  switch (code) {
    case "graded":
      return "accent";
    case "late":
      return "attention";
    case "missing":
      return "danger";
    default:
      return "neutral";
  }
}

/** Libellé français d'un statut de copie ou de devoir. */
export function statusLabel(code: SubmissionStatusCode | AssignmentStatusCode): string {
  return code in SUBMISSION_STATUS_LABEL
    ? SUBMISSION_STATUS_LABEL[code as SubmissionStatusCode]
    : ASSIGNMENT_STATUS_LABEL[code as AssignmentStatusCode];
}

/** Instant epoch d'une date ISO ; `NaN` pour une valeur illisible. */
function instant(iso: string): number {
  return new Date(iso).getTime();
}
