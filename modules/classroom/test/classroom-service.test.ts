import { randomBytes, randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClassroomError,
  CODE_ALPHABET,
  createAssignment,
  createCourse,
  deleteAssignment,
  getCourse,
  getSubmissionAttachment,
  gradeSubmission,
  joinByCode,
  listCourses,
  listSubmissions,
  MAX_ATTACHMENT_BYTES,
  randomJoinCode,
  submitAssignment,
  uploadSubmissionAttachment,
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
  const diego = await makeUser("Diego");

  return {
    orgId,
    otherOrgId,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
    actorDiego: { userId: diego, orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
  await db.delete(user).where(eq(user.id, f.actorDiego.userId));
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

    // Le code fait franchir la frontière d'organisation : chaque inscription
    // ouvre son propre espace personnel, un élève rejoint donc le cours d'un
    // enseignant d'une autre organisation. Sans ça, aucun devoir ne lui serait
    // jamais visible une fois la jointure faite (régression E2E « Exercice 1 »).
    const crossOrg = await joinByCode(f.actorChloe, code);
    expect(crossOrg.courseId).toBe(course.id);
    const crossOrgView = await getCourse(f.actorChloe, course.id);
    expect(crossOrgView.role).toBe("student");
    expect(crossOrgView.assignments).toHaveLength(0);
    // Le cours rejoint apparaît dans SA liste, pas seulement dans celle du prof.
    expect((await listCourses(f.actorChloe)).map((row) => row.id)).toContain(course.id);
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

    // L'élève noté reçoit une notification (table cœur).
    const [notification] = await getDb()
      .select()
      .from(coreSchema.notifications)
      .where(eq(coreSchema.notifications.userId, f.actorBruno.userId));
    expect(notification).toMatchObject({
      orgId: f.orgId,
      kind: "graded",
      title: "Copie notée : Rédaction",
      body: "Note : 18/20",
      href: "http://localhost:3012",
      readAt: null,
    });

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

    // La suppression est journalisée (création + suppression).
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const deletions = rows.filter((row) => row.action === "classroom.assignment.delete");
    expect(deletions).toHaveLength(1);
    expect(deletions[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      resourceType: "assignment",
      resourceId: assignment.id,
      result: "success",
    });
  });
});

describe("classroom — audit", () => {
  it("journalise la création du cours et l'adhésion par code", async () => {
    const course = await createCourse(f.actorAlice, { name: "Audit" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);
    // Adhésion idempotente : la seconde tentative n'est pas une mutation.
    await joinByCode(f.actorBruno, code);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    expect(rows).toHaveLength(2);

    const created = rows.find((row) => row.action === "classroom.course.create");
    expect(created).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      resourceType: "course",
      resourceId: course.id,
      result: "success",
    });

    const joined = rows.find((row) => row.action === "classroom.course.join");
    expect(joined).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorBruno.userId,
      resourceType: "course",
      resourceId: course.id,
      result: "success",
    });
  });

  it("journalise la remise et la notation d'une copie (métadonnée : note)", async () => {
    const course = await createCourse(f.actorAlice, { name: "Journal" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Exercice" });
    await submitAssignment(f.actorBruno, assignment.id, "Ma copie");
    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    if (!submission) throw new Error("copie manquante");
    await gradeSubmission(f.actorAlice, submission.id, { grade: 17, feedback: "Bien" });

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));

    const submitted = rows.find((row) => row.action === "classroom.submission.submit");
    expect(submitted).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorBruno.userId,
      resourceType: "assignment",
      resourceId: assignment.id,
      result: "success",
    });

    const graded = rows.find((row) => row.action === "classroom.submission.grade");
    expect(graded).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      resourceType: "submission",
      resourceId: submission.id,
      result: "success",
      metadata: { grade: 17 },
    });
  });

  it("n'audite pas les lectures (listSubmissions, listCourses)", async () => {
    const course = await createCourse(f.actorAlice, { name: "Lecture seule" });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Devoir" });
    await submitAssignment(f.actorBruno, assignment.id, "Copie");

    const countRows = async () =>
      (await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId))).length;
    const before = await countRows();
    // Les quatre mutations préparatoires (cours, adhésion, devoir, copie) sont
    // les seules lignes attendues.
    expect(before).toBe(4);

    await listSubmissions(f.actorAlice, assignment.id);
    await listCourses(f.actorBruno);
    await getCourse(f.actorBruno, course.id);

    expect(await countRows()).toBe(before);
  });
});

describe("classroom — pièces jointes", () => {
  /** Cours d'Alice où Bruno est élève, prêt à recevoir un devoir. */
  async function courseWithBruno(name: string): Promise<{ id: string }> {
    const course = await createCourse(f.actorAlice, { name });
    const detail = await getCourse(f.actorAlice, course.id);
    const code = detail.joinCode;
    if (!code) throw new Error("code manquant");
    await joinByCode(f.actorBruno, code);
    return course;
  }

  it("téléverse, rattache au rendu, sert les octets à l'identique et expose les métadonnées", async () => {
    const course = await courseWithBruno("Biologie");
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Rapport" });

    // Contenu binaire non textuel : la restitution doit être octet pour octet.
    const bytes = randomBytes(2048);
    const token = await uploadSubmissionAttachment(f.actorBruno, {
      filename: "rapport.pdf",
      contentType: "application/pdf",
      body: bytes,
    });
    expect(token.storageKey.startsWith(`classroom/${f.orgId}/`)).toBe(true);
    expect(token.sizeBytes).toBe(bytes.length);

    await submitAssignment(f.actorBruno, assignment.id, "Voici mon rapport", [token]);

    // Vue prof : métadonnées exposées, clé de stockage jamais divulguée.
    const submissions = await listSubmissions(f.actorAlice, assignment.id);
    expect(submissions).toHaveLength(1);
    const [meta] = submissions[0]?.attachments ?? [];
    expect(meta).toMatchObject({
      filename: "rapport.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
    });
    expect(meta).not.toHaveProperty("storageKey");

    if (!meta) throw new Error("pièce jointe manquante");
    const downloaded = await getSubmissionAttachment(f.actorAlice, meta.id);
    expect(downloaded.filename).toBe("rapport.pdf");
    expect(downloaded.contentType).toBe("application/pdf");
    expect(downloaded.body.equals(bytes)).toBe(true);

    // L'élève propriétaire peut aussi télécharger sa propre pièce jointe.
    const own = await getSubmissionAttachment(f.actorBruno, meta.id);
    expect(own.body.equals(bytes)).toBe(true);

    // Le rendu de l'élève porte les mêmes métadonnées (sans la clé).
    const studentView = await getCourse(f.actorBruno, course.id);
    const mine = studentView.assignments[0]?.mySubmission;
    expect(mine?.attachments).toHaveLength(1);
    expect(mine?.attachments[0]).toMatchObject({
      filename: "rapport.pdf",
      sizeBytes: bytes.length,
    });
  });

  it("refuse une clé de stockage d'une autre organisation", async () => {
    const course = await courseWithBruno("Géographie");
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Carte" });

    const foreign = {
      storageKey: `classroom/${f.otherOrgId}/${randomUUID()}`,
      filename: "intrus.txt",
      contentType: "text/plain",
      sizeBytes: 4,
    };
    await expect(submitAssignment(f.actorBruno, assignment.id, "Copie", [foreign])).rejects.toThrow(
      ClassroomError,
    );

    // Validation avant écriture : aucune copie n'a été créée.
    await expect(listSubmissions(f.actorAlice, assignment.id)).resolves.toHaveLength(0);
  });

  it("refuse le téléchargement à un membre d'un autre cours ou d'une autre organisation", async () => {
    const courseA = await courseWithBruno("Cours A");
    const assignment = await createAssignment(f.actorAlice, courseA.id, { title: "Devoir A" });

    // Diego est élève d'un AUTRE cours, dans la même organisation.
    const courseB = await createCourse(f.actorAlice, { name: "Cours B" });
    const detailB = await getCourse(f.actorAlice, courseB.id);
    const codeB = detailB.joinCode;
    if (!codeB) throw new Error("code manquant");
    await joinByCode(f.actorDiego, codeB);

    const token = await uploadSubmissionAttachment(f.actorBruno, {
      filename: "copie.txt",
      contentType: "text/plain",
      body: Buffer.from("secret"),
    });
    await submitAssignment(f.actorBruno, assignment.id, "Ma copie", [token]);
    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    const attachmentId = submission?.attachments[0]?.id;
    if (!attachmentId) throw new Error("pièce jointe manquante");

    // Ni un membre d'un autre cours, ni un membre d'une autre organisation.
    await expect(getSubmissionAttachment(f.actorDiego, attachmentId)).rejects.toThrow(
      ClassroomError,
    );
    await expect(getSubmissionAttachment(f.actorChloe, attachmentId)).rejects.toThrow(
      ClassroomError,
    );
    // L'enseignant du cours, lui, accède au fichier.
    await expect(getSubmissionAttachment(f.actorAlice, attachmentId)).resolves.toBeTruthy();
  });

  it("refuse les noms avec séparateur de chemin et les fichiers au-delà de 10 Mo", async () => {
    const body = Buffer.from("x");
    await expect(
      uploadSubmissionAttachment(f.actorBruno, {
        filename: "dossier/fichier.txt",
        contentType: "text/plain",
        body,
      }),
    ).rejects.toThrow(ClassroomError);
    await expect(
      uploadSubmissionAttachment(f.actorBruno, {
        filename: "dossier\\fichier.txt",
        contentType: "text/plain",
        body,
      }),
    ).rejects.toThrow(ClassroomError);
    await expect(
      uploadSubmissionAttachment(f.actorBruno, {
        filename: "nul\0name.txt",
        contentType: "text/plain",
        body,
      }),
    ).rejects.toThrow(ClassroomError);
    await expect(
      uploadSubmissionAttachment(f.actorBruno, {
        filename: "trop-gros.bin",
        contentType: "application/octet-stream",
        body: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
      }),
    ).rejects.toThrow(/trop volumineuse/);
  });

  it("n'audite classroom.submission.attach que si une pièce jointe est déposée", async () => {
    const course = await courseWithBruno("Journal PJ");
    const assignment = await createAssignment(f.actorAlice, course.id, { title: "Mémoire" });

    const attachRows = async () =>
      await getDb()
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, f.orgId),
            eq(auditEvents.action, "classroom.submission.attach"),
          ),
        );

    // Copie sans pièce jointe : déjà couverte par classroom.submission.submit.
    await submitAssignment(f.actorBruno, assignment.id, "Sans fichier");
    expect(await attachRows()).toHaveLength(0);

    // Nouvelle remise avec pièce jointe : exactement une ligne d'audit.
    const token = await uploadSubmissionAttachment(f.actorBruno, {
      filename: "annexe.txt",
      contentType: "text/plain",
      body: Buffer.from("hi"),
    });
    await submitAssignment(f.actorBruno, assignment.id, "Avec fichier", [token]);

    const rows = await attachRows();
    expect(rows).toHaveLength(1);
    const [submission] = await listSubmissions(f.actorAlice, assignment.id);
    expect(rows[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorBruno.userId,
      action: "classroom.submission.attach",
      resourceType: "submission",
      resourceId: submission?.id,
      result: "success",
      metadata: { count: 1 },
    });
  });
});
