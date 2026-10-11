import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClassroomError,
  CODE_ALPHABET,
  createAssignment,
  createCourse,
  deleteAssignment,
  getCourse,
  gradeSubmission,
  joinByCode,
  listCourses,
  listSubmissions,
  randomJoinCode,
  submitAssignment,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
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

  const makeUser = async (name: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const alice = await makeUser("Alice");
  const bruno = await makeUser("Bruno");
  const chloe = await makeUser("Chloe");

  return {
    orgId,
    otherOrgId,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  await cleanup(f);
});

afterAll(async () => {
  await closeDb();
});

describe("classroom — cours", () => {
  it("crée un cours enseigné, avec code d'accès", async () => {
    const course = await createCourse(f.actorAlice, { name: "Maths", section: "2de A" });
    expect(course.role).toBe("teacher");

    const detail = await getCourse(f.actorAlice, course.id);
    expect(detail.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(detail.members).toHaveLength(1);

    const courses = await listCourses(f.actorAlice);
    expect(courses).toHaveLength(1);
    expect(courses[0]?.role).toBe("teacher");
  });

  it("génère des codes à 8 caractères sans caractères ambigus", () => {
    // L'alphabet ne contient ni I, ni L, ni O, ni 0, ni 1.
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
    expect(CODE_ALPHABET).toHaveLength(31);

    const observed = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const code = randomJoinCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(code).not.toMatch(/[ILO01]/);
      for (const char of code) {
        expect(CODE_ALPHABET).toContain(char);
        observed.add(char);
      }
    }
    // 500 codes = 4 000 tirages : l'échantillonnage couvre tout l'alphabet.
    expect([...observed].sort().join("")).toBe([...CODE_ALPHABET].sort().join(""));
  });

  it("rejoint par code (idempotent) et refuse les codes invalides", async () => {
    const course = await createCourse(f.actorAlice, { name: "Histoire" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");

    const joined = await joinByCode(f.actorBruno, code.toLowerCase());
    expect(joined.courseId).toBe(course.id);
    const again = await joinByCode(f.actorBruno, code);
    expect(again.courseId).toBe(course.id);
    expect((await listCourses(f.actorBruno))[0]?.role).toBe("student");
    // onConflictDoNothing : pas de membre en double après deux jointures.
    const teacherView = await getCourse(f.actorAlice, course.id);
    expect(teacherView.members.filter((member) => member.role === "student")).toHaveLength(1);

    await expect(joinByCode(f.actorBruno, "XXXX99")).rejects.toThrow(ClassroomError);
    // Le cours d'une autre organisation est invisible.
    await expect(joinByCode(f.actorChloe, code)).rejects.toThrow(ClassroomError);
    await expect(getCourse(f.actorChloe, course.id)).rejects.toThrow(ClassroomError);
  });
});

describe("classroom — devoirs et copies", () => {
  it("réserve la création de devoirs aux enseignants", async () => {
    const course = await createCourse(f.actorAlice, { name: "SVT" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);

    await expect(createAssignment(f.actorBruno, course.id, { title: "Interdit" })).rejects.toThrow(
      ClassroomError,
    );

    const assignment = await createAssignment(f.actorAlice, course.id, {
      title: "Exercices 1",
      instructions: "Revoir le chapitre 2",
      points: 20,
    });
    expect(assignment.id).toBeTruthy();
  });

  it("rend une copie (mise à jour possible), la liste et la note", async () => {
    const course = await createCourse(f.actorAlice, { name: "Français" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);

    const assignment = await createAssignment(f.actorAlice, course.id, {
      title: "Rédaction",
      points: 20,
    });

    await expect(
      submitAssignment(f.actorAlice, assignment.id, "Je suis le professeur"),
    ).rejects.toThrow(ClassroomError);

    await submitAssignment(f.actorBruno, assignment.id, "Première version");
    await submitAssignment(f.actorBruno, assignment.id, "Version corrigée");

    const studentView = await getCourse(f.actorBruno, course.id);
    expect(studentView.assignments[0]?.mySubmission?.content).toBe("Version corrigée");

    const teacherView = await getCourse(f.actorAlice, course.id);
    expect(teacherView.assignments[0]?.submissionCount).toBe(1);

    const submissions = await listSubmissions(f.actorAlice, assignment.id);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.studentName).toBe("Bruno");
    expect(submissions[0]?.points).toBe(20);

    await expect(listSubmissions(f.actorBruno, assignment.id)).rejects.toThrow(ClassroomError);

    const submission = submissions[0];
    if (!submission) throw new Error("copie manquante");
    await gradeSubmission(f.actorAlice, submission.id, { grade: 18, feedback: "Très bien" });

    const graded = await getCourse(f.actorBruno, course.id);
    expect(graded.assignments[0]?.mySubmission?.grade).toBe(18);
    expect(graded.assignments[0]?.mySubmission?.feedback).toBe("Très bien");
  });

  it("conserve la note quand l'élève rend une nouvelle copie", async () => {
    const course = await createCourse(f.actorAlice, { name: "Physique" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);

    const assignment = await createAssignment(f.actorAlice, course.id, {
      title: "Compte rendu",
      points: 20,
    });
    await submitAssignment(f.actorBruno, assignment.id, "Première version");

    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    if (!submission) throw new Error("copie manquante");
    await gradeSubmission(f.actorAlice, submission.id, { grade: 15, feedback: "Bien" });

    await submitAssignment(f.actorBruno, assignment.id, "Version améliorée");

    const [after] = await listSubmissions(f.actorAlice, assignment.id);
    expect(after?.content).toBe("Version améliorée");
    expect(after?.grade).toBe(15);
    expect(after?.feedback).toBe("Bien");

    const studentView = await getCourse(f.actorBruno, course.id);
    expect(studentView.assignments[0]?.mySubmission?.content).toBe("Version améliorée");
    expect(studentView.assignments[0]?.mySubmission?.grade).toBe(15);
    expect(studentView.assignments[0]?.mySubmission?.feedback).toBe("Bien");
  });

  it("refuse une note hors bornes ou non entière, sans écrêter", async () => {
    const course = await createCourse(f.actorAlice, { name: "Chimie" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);

    const assignment = await createAssignment(f.actorAlice, course.id, {
      title: "TP",
      points: 20,
    });
    await submitAssignment(f.actorBruno, assignment.id, "Copie");
    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    if (!submission) throw new Error("copie manquante");

    await expect(gradeSubmission(f.actorAlice, submission.id, { grade: 21 })).rejects.toThrow(
      "La note doit être comprise entre 0 et 20.",
    );
    await expect(gradeSubmission(f.actorAlice, submission.id, { grade: -1 })).rejects.toThrow(
      ClassroomError,
    );
    await expect(gradeSubmission(f.actorAlice, submission.id, { grade: 10.5 })).rejects.toThrow(
      "La note doit être un nombre entier.",
    );
    await expect(
      gradeSubmission(f.actorAlice, submission.id, { grade: Number.NaN }),
    ).rejects.toThrow(ClassroomError);
    await expect(
      gradeSubmission(f.actorAlice, submission.id, { grade: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(ClassroomError);

    // Aucun écrêtage silencieux : la copie reste non notée.
    const [untouched] = await listSubmissions(f.actorAlice, assignment.id);
    expect(untouched?.grade).toBeNull();

    // Les bornes restent acceptées.
    await gradeSubmission(f.actorAlice, submission.id, { grade: 20 });
    const [graded] = await listSubmissions(f.actorAlice, assignment.id);
    expect(graded?.grade).toBe(20);
  });

  it("supprime un devoir (enseignant) et nettoie les copies", async () => {
    const course = await createCourse(f.actorAlice, { name: "Arts" });
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Dessin" });
    await deleteAssignment(f.actorAlice, assignment.id);
    const detail = await getCourse(f.actorAlice, course.id);
    expect(detail.assignments).toHaveLength(0);
  });
});
