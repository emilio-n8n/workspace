import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClassroomError,
  createAssignment,
  createCourse,
  getCourse,
  gradeSubmission,
  joinByCode,
  listSubmissions,
  regenerateJoinCode,
  removeMember,
  submitAssignment,
} from "../src/index.ts";

const { user, organization, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
  actorChloe: Actor;
  actorDiego: Actor;
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

  return {
    orgId,
    otherOrgId,
    actorAlice: await makeUser("Alice", orgId),
    actorBruno: await makeUser("Bruno", orgId),
    actorChloe: await makeUser("Chloe", otherOrgId),
    actorDiego: await makeUser("Diego", orgId),
  };
}

/** Cours d'Alice avec Bruno (même organisation) et Chloé (autre organisation). */
async function courseWithBruno(name: string): Promise<{ id: string; joinCode: string }> {
  const course = await createCourse(f.actorAlice, { name });
  const detail = await getCourse(f.actorAlice, course.id);
  const joinCode = detail.joinCode;
  if (!joinCode) throw new Error("code manquant");
  await joinByCode(f.actorBruno, joinCode);
  return { id: course.id, joinCode };
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
  await db.delete(user).where(eq(user.id, f.actorDiego.userId));
});

afterAll(async () => {
  await closeDb();
});

describe("classroom — notes d'un cours", () => {
  it("donne à l'élève sa moyenne pondérée et au professeur le carnet de la classe", async () => {
    const { id: courseId } = await courseWithBruno("Statistiques");
    const detail = await getCourse(f.actorAlice, courseId);
    if (!detail.joinCode) throw new Error("code manquant");
    await joinByCode(f.actorChloe, detail.joinCode);

    // Trois devoirs de poids différents pour vérifier la pondération.
    const first = await createAssignment(f.actorAlice, courseId, { title: "Devoir 1", points: 20 });
    const second = await createAssignment(f.actorAlice, courseId, {
      title: "Devoir 2",
      points: 100,
    });
    await createAssignment(f.actorAlice, courseId, { title: "Devoir 3", points: 20 });

    await submitAssignment(f.actorBruno, first.id, "Copie de Bruno");
    await submitAssignment(f.actorBruno, second.id, "Copie de Bruno");
    await submitAssignment(f.actorChloe, first.id, "Copie de Chloé");

    const firstRows = await listSubmissions(f.actorAlice, first.id);
    const secondRows = await listSubmissions(f.actorAlice, second.id);
    const brunoFirst = firstRows.find((row) => row.studentName === "Bruno");
    const brunoSecond = secondRows.find((row) => row.studentName === "Bruno");
    const chloeFirst = firstRows.find((row) => row.studentName === "Chloe");
    if (!brunoFirst || !brunoSecond || !chloeFirst) throw new Error("copies manquantes");
    // Bruno : 10/20 puis 40/100 → 50 points sur 120 → 8,33 sur 20.
    await gradeSubmission(f.actorAlice, brunoFirst.id, { grade: 10 });
    await gradeSubmission(f.actorAlice, brunoSecond.id, { grade: 40 });
    await gradeSubmission(f.actorAlice, chloeFirst.id, { grade: 20 });

    const studentView = await getCourse(f.actorBruno, courseId);
    expect(studentView.myGrades).toMatchObject({
      earned: 50,
      possible: 120,
      graded: 2,
      total: 3,
    });
    expect(studentView.myGrades?.average).toBe(8.33);
    // Un élève ne voit jamais le carnet des autres.
    expect(studentView.classGrades).toBeNull();

    const teacherView = await getCourse(f.actorAlice, courseId);
    expect(teacherView.myGrades).toBeNull();
    const grades = teacherView.classGrades;
    if (!grades) throw new Error("carnet manquant");
    // Classe entière : 70 points sur 140 (les trois copies corrigées).
    expect(grades.summary).toMatchObject({ earned: 70, possible: 140, graded: 3, total: 6 });
    expect(grades.summary.average).toBe(10);
    // Chaque élève, trié par nom, avec sa propre moyenne.
    expect(grades.students.map((row) => row.name)).toEqual(["Bruno", "Chloe"]);
    expect(grades.students.find((row) => row.name === "Bruno")?.average).toBe(8.33);
    expect(grades.students.find((row) => row.name === "Chloe")?.average).toBe(20);
  });

  it("garde la note hors du champ de vision des autres élèves", async () => {
    const { id: courseId } = await courseWithBruno("Discrétion");
    const detail = await getCourse(f.actorAlice, courseId);
    if (!detail.joinCode) throw new Error("code manquant");
    await joinByCode(f.actorChloe, detail.joinCode);

    const assignment = await createAssignment(f.actorAlice, courseId, {
      title: "Copie secrète",
      points: 20,
    });
    await submitAssignment(f.actorBruno, assignment.id, "Réponse de Bruno");
    await submitAssignment(f.actorChloe, assignment.id, "Réponse de Chloé");
    const rows = await listSubmissions(f.actorAlice, assignment.id);
    const bruno = rows.find((row) => row.studentName === "Bruno");
    if (!bruno) throw new Error("copie manquante");
    await gradeSubmission(f.actorAlice, bruno.id, {
      grade: 18,
      feedback: "Très bon travail, continue ainsi.",
    });

    // Le professeur relit le commentaire privé côté correction.
    const teacherRows = await listSubmissions(f.actorAlice, assignment.id);
    expect(teacherRows.find((row) => row.studentName === "Bruno")?.feedback).toBe(
      "Très bon travail, continue ainsi.",
    );
    // L'élève concerné le retrouve sur sa copie.
    const brunoView = await getCourse(f.actorBruno, courseId);
    expect(brunoView.assignments[0]?.mySubmission?.feedback).toBe(
      "Très bon travail, continue ainsi.",
    );
    // Chloé ne voit que sa propre copie : jamais celle de Bruno.
    const chloeView = await getCourse(f.actorChloe, courseId);
    expect(chloeView.assignments[0]?.mySubmission?.content).toBe("Réponse de Chloé");
    expect(chloeView.assignments[0]?.mySubmission?.feedback).toBeNull();
    // Et aucun élève ne peut lister les copies d'un devoir.
    await expect(listSubmissions(f.actorChloe, assignment.id)).rejects.toThrow(ClassroomError);
  });
});

describe("classroom — gestion des personnes", () => {
  it("retire un élève (audité), lui ferme l'accès et conserve ses copies notées", async () => {
    const { id: courseId } = await courseWithBruno("Retrait");
    const assignment = await createAssignment(f.actorAlice, courseId, {
      title: "Devoir",
      points: 20,
    });
    await submitAssignment(f.actorBruno, assignment.id, "Copie de Bruno");
    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    if (!submission) throw new Error("copie manquante");
    await gradeSubmission(f.actorAlice, submission.id, { grade: 16 });

    await removeMember(f.actorAlice, courseId, f.actorBruno.userId);

    // L'élève retiré perd l'accès au cours…
    await expect(getCourse(f.actorBruno, courseId)).rejects.toThrow(ClassroomError);
    // …mais le travail rendu et corrigé reste dans le carnet du professeur.
    const rows = await listSubmissions(f.actorAlice, assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentName: "Bruno", grade: 16 });

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.orgId, f.orgId), eq(auditEvents.action, "classroom.member.remove")),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "member",
      resourceId: f.actorBruno.userId,
      result: "success",
      metadata: { courseId },
    });
  });

  it("refuse de se retirer soi-même, de retirer le propriétaire ou un inconnu", async () => {
    const { id: courseId } = await courseWithBruno("Refus");
    // Se retirer soi-même, même en tant qu'enseignant : un cours sans gardien.
    await expect(removeMember(f.actorAlice, courseId, f.actorAlice.userId)).rejects.toThrow(
      /Vous ne pouvez pas vous retirer/,
    );
    // Un élève ne gère pas les membres.
    await expect(removeMember(f.actorBruno, courseId, f.actorDiego.userId)).rejects.toThrow(
      ClassroomError,
    );
    // Un inconnu du cours n'est pas retirable.
    await expect(removeMember(f.actorAlice, courseId, f.actorDiego.userId)).rejects.toThrow(
      "Ce membre ne fait pas partie du cours.",
    );
    // Rien n'a bougé : les deux membres sont toujours là.
    const detail = await getCourse(f.actorAlice, courseId);
    expect(detail.members).toHaveLength(2);
  });

  it("régénère le code d'invitation : l'ancien meurt, le nouveau ouvre", async () => {
    const { id: courseId, joinCode: oldCode } = await courseWithBruno("Nouveau code");

    const { joinCode } = await regenerateJoinCode(f.actorAlice, courseId);
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(joinCode).not.toBe(oldCode);

    // L'ancien code ne fait plus entrer personne.
    await expect(joinByCode(f.actorDiego, oldCode)).rejects.toThrow(/Aucun cours/);
    // Le nouveau, oui.
    await expect(joinByCode(f.actorDiego, joinCode)).resolves.toEqual({ courseId });

    // Le code affiché au professeur est bien le nouveau.
    expect((await getCourse(f.actorAlice, courseId)).joinCode).toBe(joinCode);

    const audits = await getDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, f.orgId),
          eq(auditEvents.action, "classroom.course.regenerate_code"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "course",
      resourceId: courseId,
      result: "success",
    });
  });

  it("réserve la régénération du code aux enseignants du cours", async () => {
    const { id: courseId } = await courseWithBruno("Code protégé");
    await expect(regenerateJoinCode(f.actorBruno, courseId)).rejects.toThrow(ClassroomError);
    await expect(regenerateJoinCode(f.actorChloe, courseId)).rejects.toThrow(ClassroomError);
  });
});
