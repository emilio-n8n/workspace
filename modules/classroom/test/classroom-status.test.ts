import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUS_LABEL,
  assignmentStatus,
  isLateSubmission,
  isOverdue,
  SUBMISSION_STATUS_LABEL,
  statusLabel,
  statusTone,
  submissionStatus,
} from "../src/status.ts";

/** Échéance fixe : 12 octobre 2026 à 23:59 (fin de journée, comme le formulaire). */
const DUE = "2026-10-12T23:59:00.000Z";
const BEFORE = "2026-10-11T08:00:00.000Z";
const AFTER = "2026-10-13T09:30:00.000Z";
const NOW = new Date("2026-10-13T00:00:00.000Z");

describe("classroom — statuts d'une copie", () => {
  it("est en retard seulement après l'échéance, jamais avant", () => {
    expect(isLateSubmission(BEFORE, DUE)).toBe(false);
    expect(isLateSubmission(AFTER, DUE)).toBe(true);
    // Sans échéance, aucune copie n'est en retard.
    expect(isLateSubmission(AFTER, null)).toBe(false);
    // Date illisible : on refuse de deviner plutôt que d'inventer un retard.
    expect(isLateSubmission("pas-une-date", DUE)).toBe(false);
  });

  it("classe noté avant en retard : une copie corrigée reste corrigée", () => {
    expect(submissionStatus({ submittedAt: AFTER, dueAt: DUE, grade: 15 })).toBe("graded");
    expect(submissionStatus({ submittedAt: AFTER, dueAt: DUE, grade: null })).toBe("late");
    expect(submissionStatus({ submittedAt: BEFORE, dueAt: DUE, grade: null })).toBe("submitted");
    expect(submissionStatus({ submittedAt: AFTER, dueAt: null, grade: null })).toBe("submitted");
  });

  it("donne le libellé et la tonalité de chaque statut", () => {
    expect(SUBMISSION_STATUS_LABEL.graded).toBe("Noté");
    expect(SUBMISSION_STATUS_LABEL.late).toBe("En retard");
    expect(SUBMISSION_STATUS_LABEL.submitted).toBe("Rendu");

    expect(statusLabel("graded")).toBe("Noté");
    expect(statusLabel("late")).toBe("En retard");
    expect(statusTone("graded")).toBe("accent");
    expect(statusTone("late")).toBe("attention");
    expect(statusTone("submitted")).toBe("neutral");
    expect(statusTone("missing")).toBe("danger");
  });
});

describe("classroom — statut d'un devoir pour un élève", () => {
  it("distingue à rendre, non rendu, rendu, en retard et noté", () => {
    expect(assignmentStatus({ submission: null, dueAt: DUE, now: NOW })).toBe("missing");
    expect(assignmentStatus({ submission: null, dueAt: null })).toBe("todo");
    expect(
      assignmentStatus({ submission: { submittedAt: BEFORE, grade: null }, dueAt: DUE, now: NOW }),
    ).toBe("submitted");
    expect(
      assignmentStatus({ submission: { submittedAt: AFTER, grade: null }, dueAt: DUE, now: NOW }),
    ).toBe("late");
    expect(
      assignmentStatus({ submission: { submittedAt: AFTER, grade: 12 }, dueAt: DUE, now: NOW }),
    ).toBe("graded");
    // Une copie rendue reste « rendue » même si l'échéance est passée.
    expect(
      assignmentStatus({ submission: { submittedAt: BEFORE, grade: null }, dueAt: DUE, now: NOW }),
    ).toBe("submitted");
  });

  it("n'est « non rendu » qu'une fois l'échéance dépassée", () => {
    // Avant l'échéance, un devoir sans copie reste à rendre.
    expect(assignmentStatus({ submission: null, dueAt: DUE, now: new Date(BEFORE) })).toBe("todo");
    // Après, il est manqué.
    expect(assignmentStatus({ submission: null, dueAt: DUE, now: NOW })).toBe("missing");
    expect(isOverdue(DUE, NOW)).toBe(true);
    expect(isOverdue(DUE, new Date(BEFORE))).toBe(false);
    expect(isOverdue(null, NOW)).toBe(false);
  });

  it("expose un libellé pour chaque statut de devoir", () => {
    expect(ASSIGNMENT_STATUS_LABEL.todo).toBe("À rendre");
    expect(ASSIGNMENT_STATUS_LABEL.missing).toBe("Non rendu");
    for (const code of ["graded", "late", "submitted", "missing", "todo"] as const) {
      expect(statusLabel(code)).toMatch(/\S/);
    }
  });
});
