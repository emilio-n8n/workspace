import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClassroomError,
  createAssignment,
  createCourse,
  getCourse,
  gradeSubmission,
  joinByCode,
  listSubmissions,
  submitAssignment,
  updateAssignment,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
  /** Élève inscrit dans une AUTRE organisation (espace personnel). */
  actorChloe: Actor;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();
  const orgId = tag("org");
  const otherOrgId = tag("org");
  await db.insert(organization).values([
    { id: orgId, name: tag("Org "), slug: orgId, createdAt: now },
    { id: otherOrgId, name: tag("Org "), slug: otherOrgId, createdAt: now },
  ]);

  const makeUser = async (name: string, org: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { userId: id, orgId: org };
  };

  const alice = await makeUser("Alice", orgId);
  const bruno = await makeUser("Bruno", orgId);
  const chloe = await makeUser("Chloe", otherOrgId);
  return { orgId, otherOrgId, actorAlice: alice, actorBruno: bruno, actorChloe: chloe };
}

/** Cours d'Alice où Bruno (même organisation) est élève. */
async function courseWithBruno(name: string): Promise<{ id: string }> {
  const course = await createCourse(f.actorAlice, { name });
  const detail = await getCourse(f.actorAlice, course.id);
  const joinCode = detail.joinCode;
  if (!joinCode) throw new Error("code manquant");
  await joinByCode(f.actorBruno, joinCode);
  return { id: course.id };
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
});

afterAll(async () => {
  await closeDb();
});

describe("classroom — édition d'un devoir", () => {
  it("modifie champ par champ et efface consigne ou échéance à la demande", async () => {
    const { id: courseId } = await courseWithBruno("Maths");
    const created = await createAssignment(f.actorAlice, courseId, {
      title: "Exercice 1",
      instructions: "Faire les calculs.",
      dueAt: "2026-10-12T23:59:00.000Z",
      points: 20,
    });

    // Seul le titre change : le reste est intact.
    await updateAssignment(f.actorAlice, created.id, { title: "Exercice 1 (corrigé)" });
    let view = await getCourse(f.actorAlice, courseId);
    let assignment = view.assignments.find((row) => row.id === created.id);
    expect(assignment?.title).toBe("Exercice 1 (corrigé)");
    expect(assignment?.instructions).toBe("Faire les calculs.");
    expect(assignment?.points).toBe(20);
    expect(assignment?.dueAt).toBe("2026-10-12T23:59:00.000Z");

    // Une consigne vide efface la consigne, une échéance nulle la retire.
    await updateAssignment(f.actorAlice, created.id, { instructions: "", dueAt: null });
    view = await getCourse(f.actorAlice, courseId);
    assignment = view.assignments.find((row) => row.id === created.id);
    expect(assignment?.instructions).toBe("");
    expect(assignment?.dueAt).toBeNull();
    // Le devoir réécrit est toujours visible pour l'élève.
    expect((await getCourse(f.actorBruno, courseId)).assignments).toHaveLength(1);
  });

  it("refuse un titre vide, un barème hors bornes et une échéance illisible", async () => {
    const { id: courseId } = await courseWithBruno("SVT");
    const created = await createAssignment(f.actorAlice, courseId, { title: "À corriger" });

    await expect(updateAssignment(f.actorAlice, created.id, { title: "  " })).rejects.toThrow(
      /titre/i,
    );
    await expect(
      updateAssignment(f.actorAlice, created.id, { title: "x".repeat(151) }),
    ).rejects.toThrow(ClassroomError);
    await expect(updateAssignment(f.actorAlice, created.id, { points: -1 })).rejects.toThrow(
      /barème/i,
    );
    await expect(updateAssignment(f.actorAlice, created.id, { points: 1001 })).rejects.toThrow(
      /barème/i,
    );
    await expect(updateAssignment(f.actorAlice, created.id, { points: 12.5 })).rejects.toThrow(
      /barème/i,
    );
    await expect(
      updateAssignment(f.actorAlice, created.id, { dueAt: "pas-une-date" }),
    ).rejects.toThrow(/échéance/i);
    // Rien n'a bougé pendant les refus.
    const view = await getCourse(f.actorAlice, courseId);
    expect(view.assignments[0]).toMatchObject({ title: "À corriger", points: 100 });
  });

  it("réserve l'édition aux enseignants du cours", async () => {
    const { id: courseId } = await courseWithBruno("Français");
    const created = await createAssignment(f.actorAlice, courseId, { title: "Interdit" });

    await expect(updateAssignment(f.actorBruno, created.id, { title: "Piraté" })).rejects.toThrow(
      ClassroomError,
    );
    await expect(
      updateAssignment({ userId: tag("usr"), orgId: f.orgId }, created.id, { title: "Piraté" }),
    ).rejects.toThrow(ClassroomError);

    expect((await getCourse(f.actorAlice, courseId)).assignments[0]?.title).toBe("Interdit");
  });
});

describe("classroom — jointure inter-organisation (régression E2E)", () => {
  it("laisse un élève d'un autre espace voir le devoir, rendre sa copie et être noté", async () => {
    // Le scénario exact de la suite E2E : un enseignant crée « Exercice 1 »,
    // un élève inscrit dans une autre organisation rejoint avec le code.
    const course = await createCourse(f.actorAlice, { name: "Maths E2E" });
    const detail = await getCourse(f.actorAlice, course.id);
    const joinCode = detail.joinCode;
    if (!joinCode) throw new Error("code manquant");

    await createAssignment(f.actorAlice, course.id, {
      title: "Exercice 1",
      instructions: "Faire les calculs.",
      points: 20,
    });

    const joined = await joinByCode(f.actorChloe, joinCode);
    expect(joined.courseId).toBe(course.id);

    // L'intitulé du devoir est visible chez l'élève, avec son statut.
    const studentView = await getCourse(f.actorChloe, course.id);
    expect(studentView.assignments.map((row) => row.title)).toContain("Exercice 1");
    expect(studentView.assignments[0]?.status).toBe("todo");
    // Le code d'accès n'est jamais exposé à un élève.
    expect(studentView.joinCode).toBeNull();

    const assignmentId = studentView.assignments[0]?.id;
    if (!assignmentId) throw new Error("devoir manquant");

    // L'élève rend sa copie, l'enseignant (autre organisation) la note.
    await submitAssignment(f.actorChloe, assignmentId, "Ma réponse E2E");
    const [submission] = await listSubmissions(f.actorAlice, assignmentId);
    expect(submission?.studentName).toBe("Chloe");
    expect(submission?.status).toBe("submitted");
    if (!submission) throw new Error("copie manquante");

    await gradeSubmission(f.actorAlice, submission.id, { grade: 15 });
    const graded = await getCourse(f.actorChloe, course.id);
    expect(graded.assignments[0]?.status).toBe("graded");
    expect(graded.assignments[0]?.mySubmission?.grade).toBe(15);
  });

  it("compte les copies d'un devoir même quand les élèves sont d'ailleurs", async () => {
    const { id: courseId } = await courseWithBruno("Physique");
    const detail = await getCourse(f.actorAlice, courseId);
    const joinCode = detail.joinCode;
    if (!joinCode) throw new Error("code manquant");
    await joinByCode(f.actorChloe, joinCode);

    const assignment = await createAssignment(f.actorAlice, courseId, { title: "Devoir" });
    await submitAssignment(f.actorBruno, assignment.id, "Copie de Bruno");
    await submitAssignment(f.actorChloe, assignment.id, "Copie de Chloé");

    const view = await getCourse(f.actorAlice, courseId);
    expect(view.assignments[0]?.submissionCount).toBe(2);
    expect(view.assignments[0]?.counts).toMatchObject({ submitted: 2, onTime: 2, graded: 0 });
    // Les deux copies sont corrigeables par l'enseignant.
    const rows = await listSubmissions(f.actorAlice, assignment.id);
    expect(rows.map((row) => row.studentName).sort()).toEqual(["Bruno", "Chloe"]);
  });
});
