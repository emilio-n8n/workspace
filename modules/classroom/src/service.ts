import { randomBytes, randomUUID } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getAppUrls } from "@workspace/config";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import { createNotification } from "@workspace/notifications";
import type { Actor } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ClassroomCourseRow,
  type ClassroomSubmissionRow,
  classroomAssignments,
  classroomCourses,
  classroomMembers,
  classroomSubmissionAttachments,
  classroomSubmissions,
} from "./schema.ts";

export type ClassroomErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class ClassroomError extends Error {
  readonly code: ClassroomErrorCode;
  constructor(code: ClassroomErrorCode, message: string) {
    super(message);
    this.name = "ClassroomError";
    this.code = code;
  }
}

export type CourseRole = "teacher" | "student";

export type CourseSummary = {
  id: string;
  name: string;
  section: string | null;
  role: CourseRole;
  studentCount: number;
  assignmentCount: number;
  createdAt: string;
};

export type MemberView = { userId: string; name: string; email: string; role: CourseRole };

export type SubmissionView = {
  content: string;
  submittedAt: string;
  grade: number | null;
  feedback: string | null;
  /** Métadonnées des pièces jointes — le binaire se télécharge via la route dédiée. */
  attachments: SubmissionAttachmentMeta[];
};

/** Métadonnées d'une pièce jointe exposées à l'UI (jamais la clé de stockage). */
export type SubmissionAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

/** Jeton provisoire renvoyé par `uploadSubmissionAttachment` puis transmis à `submitAssignment`. */
export type SubmissionAttachmentToken = {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type SubmissionAttachmentDownload = {
  filename: string;
  contentType: string;
  body: Buffer;
};

export type AssignmentView = {
  id: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  points: number;
  submissionCount: number;
  mySubmission: SubmissionView | null;
};

export type CourseDetail = {
  id: string;
  name: string;
  section: string | null;
  joinCode: string | null;
  role: CourseRole;
  members: MemberView[];
  assignments: AssignmentView[];
};

const db = () => getDb();

/** Alphabet sans caractères ambigus : ni I, L, O, ni 0, 1. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Longueur des codes d'accès. */
export const JOIN_CODE_LENGTH = 8;

/** Nombre de tentatives avant d'abandonner la génération d'un code unique. */
const JOIN_CODE_ATTEMPTS = 5;

/** Bornes des pièces jointes : 5 fichiers de 10 Mio au maximum. */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILENAME_LENGTH = 255;
const MAX_CONTENT_TYPE_LENGTH = 200;

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function assertName(name: string, label = "Le nom"): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 150) {
    throw new ClassroomError("validation", `${label} doit contenir entre 1 et 150 caractères.`);
  }
  return trimmed;
}

/**
 * Tire un code au hasard par échantillonnage par rejet : seuls les octets
 * strictement inférieurs à 248 sont acceptés (248 = 8 × 31), ce qui rend
 * `octet % 31` uniforme.
 */
export function randomJoinCode(length = JOIN_CODE_LENGTH): string {
  let code = "";
  while (code.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte >= 248) continue;
      code += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
      if (code.length === length) break;
    }
  }
  return code;
}

async function generateJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
    const code = randomJoinCode();
    const [existing] = await db()
      .select({ id: classroomCourses.id })
      .from(classroomCourses)
      .where(eq(classroomCourses.joinCode, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new ClassroomError("conflict", "Génération du code impossible, réessayez.");
}

async function requireCourse(
  actor: Actor,
  courseId: string,
): Promise<{ course: ClassroomCourseRow; role: CourseRole }> {
  const [course] = await db()
    .select()
    .from(classroomCourses)
    .where(eq(classroomCourses.id, courseId))
    .limit(1);
  if (!course || course.orgId !== actor.orgId) {
    throw new ClassroomError("not_found", "Cours introuvable.");
  }
  const [membership] = await db()
    .select({ role: classroomMembers.role })
    .from(classroomMembers)
    .where(and(eq(classroomMembers.courseId, courseId), eq(classroomMembers.userId, actor.userId)))
    .limit(1);
  if (!membership) {
    throw new ClassroomError("forbidden", "Vous ne faites pas partie de ce cours.");
  }
  return { course, role: membership.role === "teacher" ? "teacher" : "student" };
}

async function requireTeacher(actor: Actor, courseId: string) {
  const context = await requireCourse(actor, courseId);
  if (context.role !== "teacher") {
    throw new ClassroomError("forbidden", "Action réservée aux enseignants du cours.");
  }
  return context;
}

async function requireTeacherByAssignment(actor: Actor, assignmentId: string) {
  const [assignment] = await db()
    .select()
    .from(classroomAssignments)
    .where(eq(classroomAssignments.id, assignmentId))
    .limit(1);
  if (!assignment) throw new ClassroomError("not_found", "Devoir introuvable.");
  await requireTeacher(actor, assignment.courseId);
  return assignment;
}

// ---------------------------------------------------------------------------
// Cours et membres
// ---------------------------------------------------------------------------

export async function createCourse(
  actor: Actor,
  input: { name: string; section?: string | null },
): Promise<CourseSummary> {
  const name = assertName(input.name);
  const section = input.section?.trim() ? input.section.trim().slice(0, 150) : null;

  for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = await generateJoinCode();
    try {
      const created = await withTransaction(async (tx) => {
        const [course] = await tx
          .insert(classroomCourses)
          .values({ orgId: actor.orgId, name, section, joinCode, ownerId: actor.userId })
          .returning();
        if (!course) throw new ClassroomError("conflict", "Création du cours impossible.");
        await tx
          .insert(classroomMembers)
          .values({ courseId: course.id, userId: actor.userId, role: "teacher" });
        return course;
      });

      await recordAudit({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "classroom.course.create",
        resourceType: "course",
        resourceId: created.id,
        result: "success",
      });

      return {
        id: created.id,
        name: created.name,
        section: created.section,
        role: "teacher",
        studentCount: 0,
        assignmentCount: 0,
        createdAt: created.createdAt.toISOString(),
      };
    } catch (error) {
      // Collision de code (23505) : on régénère, avec une transaction neuve.
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new ClassroomError("conflict", "Création du cours impossible, réessayez.");
}

export async function joinByCode(actor: Actor, code: string): Promise<{ courseId: string }> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4 || clean.length > 12) {
    throw new ClassroomError("validation", "Code d'accès invalide.");
  }

  const [course] = await db()
    .select()
    .from(classroomCourses)
    .where(eq(classroomCourses.joinCode, clean))
    .limit(1);
  if (!course || course.orgId !== actor.orgId) {
    throw new ClassroomError("not_found", "Aucun cours ne correspond à ce code.");
  }

  // Rejoindre deux fois reste idempotent : la contrainte unique absorbe le doublon.
  const inserted = await db()
    .insert(classroomMembers)
    .values({ courseId: course.id, userId: actor.userId, role: "student" })
    .onConflictDoNothing({
      target: [classroomMembers.courseId, classroomMembers.userId],
    })
    .returning({ id: classroomMembers.id });

  // Seule une adhésion réelle est journalisée : un second appel idempotent ne
  // produit aucune ligne d'audit.
  if (inserted.length > 0) {
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "classroom.course.join",
      resourceType: "course",
      resourceId: course.id,
      result: "success",
    });
  }
  return { courseId: course.id };
}

export async function listCourses(actor: Actor): Promise<CourseSummary[]> {
  const rows = await db()
    .select({ course: classroomCourses, role: classroomMembers.role })
    .from(classroomMembers)
    .innerJoin(classroomCourses, eq(classroomCourses.id, classroomMembers.courseId))
    .where(and(eq(classroomMembers.userId, actor.userId), eq(classroomCourses.orgId, actor.orgId)));
  if (rows.length === 0) return [];

  const courseIds = rows.map((row) => row.course.id);
  const [studentCounts, assignmentCounts] = await Promise.all([
    db()
      .select({
        courseId: classroomMembers.courseId,
        value: sql<number>`count(*)`.mapWith(Number),
      })
      .from(classroomMembers)
      .where(
        and(inArray(classroomMembers.courseId, courseIds), eq(classroomMembers.role, "student")),
      )
      .groupBy(classroomMembers.courseId),
    db()
      .select({
        courseId: classroomAssignments.courseId,
        value: sql<number>`count(*)`.mapWith(Number),
      })
      .from(classroomAssignments)
      .where(inArray(classroomAssignments.courseId, courseIds))
      .groupBy(classroomAssignments.courseId),
  ]);

  const studentsByCourse = new Map(studentCounts.map((row) => [row.courseId, row.value]));
  const assignmentsByCourse = new Map(assignmentCounts.map((row) => [row.courseId, row.value]));

  return rows
    .map(({ course, role }) => ({
      id: course.id,
      name: course.name,
      section: course.section,
      role: role === "teacher" ? ("teacher" as const) : ("student" as const),
      studentCount: studentsByCourse.get(course.id) ?? 0,
      assignmentCount: assignmentsByCourse.get(course.id) ?? 0,
      createdAt: course.createdAt.toISOString(),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getCourse(actor: Actor, courseId: string): Promise<CourseDetail> {
  const { course, role } = await requireCourse(actor, courseId);

  const memberRows = await db()
    .select({
      userId: core.user.id,
      name: core.user.name,
      email: core.user.email,
      role: classroomMembers.role,
    })
    .from(classroomMembers)
    .innerJoin(core.user, eq(core.user.id, classroomMembers.userId))
    .where(eq(classroomMembers.courseId, courseId))
    .orderBy(asc(core.user.name));

  const assignmentRows = await db()
    .select()
    .from(classroomAssignments)
    .where(eq(classroomAssignments.courseId, courseId))
    .orderBy(desc(classroomAssignments.createdAt));

  const assignmentIds = assignmentRows.map((assignment) => assignment.id);
  const submissionCounts = new Map<string, number>();
  const mySubmissions = new Map<string, ClassroomSubmissionRow>();
  let myAttachments = new Map<string, SubmissionAttachmentMeta[]>();

  if (assignmentIds.length > 0) {
    const [counts, mine] = await Promise.all([
      db()
        .select({
          assignmentId: classroomSubmissions.assignmentId,
          value: sql<number>`count(*)`.mapWith(Number),
        })
        .from(classroomSubmissions)
        .where(inArray(classroomSubmissions.assignmentId, assignmentIds))
        .groupBy(classroomSubmissions.assignmentId),
      db()
        .select()
        .from(classroomSubmissions)
        .where(
          and(
            eq(classroomSubmissions.studentId, actor.userId),
            inArray(classroomSubmissions.assignmentId, assignmentIds),
          ),
        ),
    ]);
    for (const row of counts) submissionCounts.set(row.assignmentId, row.value);
    for (const row of mine) mySubmissions.set(row.assignmentId, row);
    // Les pièces jointes de mes copies, en une seule requête (pas de N+1).
    myAttachments = await attachmentsBySubmission(mine.map((row) => row.id));
  }

  const assignments: AssignmentView[] = assignmentRows.map((assignment) => {
    const mine = mySubmissions.get(assignment.id);
    return {
      id: assignment.id,
      title: assignment.title,
      instructions: assignment.instructions,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      points: assignment.points,
      submissionCount: submissionCounts.get(assignment.id) ?? 0,
      mySubmission: mine
        ? {
            content: mine.content,
            submittedAt: mine.submittedAt.toISOString(),
            grade: mine.grade,
            feedback: mine.feedback,
            attachments: myAttachments.get(mine.id) ?? [],
          }
        : null,
    };
  });

  return {
    id: course.id,
    name: course.name,
    section: course.section,
    joinCode: role === "teacher" ? course.joinCode : null,
    role,
    members: memberRows.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role === "teacher" ? "teacher" : "student",
    })),
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Devoirs et copies
// ---------------------------------------------------------------------------

export async function createAssignment(
  actor: Actor,
  courseId: string,
  input: { title: string; instructions?: string; dueAt?: string | null; points?: number },
): Promise<{ id: string }> {
  await requireTeacher(actor, courseId);

  const title = assertName(input.title, "Le titre");
  const instructions = (input.instructions ?? "").slice(0, 20_000);
  const points = Math.round(Math.min(1000, Math.max(0, input.points ?? 100)));

  let dueAt: Date | null = null;
  if (input.dueAt) {
    const parsed = new Date(input.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new ClassroomError("validation", "Échéance invalide.");
    }
    dueAt = parsed;
  }

  const [created] = await db()
    .insert(classroomAssignments)
    .values({ courseId, title, instructions, dueAt, points })
    .returning({ id: classroomAssignments.id });
  if (!created) throw new ClassroomError("conflict", "Création du devoir impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.assignment.create",
    resourceType: "assignment",
    resourceId: created.id,
    result: "success",
  });

  return created;
}

export async function deleteAssignment(actor: Actor, assignmentId: string): Promise<void> {
  await requireTeacherByAssignment(actor, assignmentId);
  await db().delete(classroomAssignments).where(eq(classroomAssignments.id, assignmentId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.assignment.delete",
    resourceType: "assignment",
    resourceId: assignmentId,
    result: "success",
  });
}

// ---------------------------------------------------------------------------
// Pièces jointes — validation commune (upload, rendu, lecture)
// ---------------------------------------------------------------------------

function assertAttachmentFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw new ClassroomError("validation", "Nom de fichier invalide.");
  }
  const filename = value.trim();
  if (filename.length === 0 || filename.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new ClassroomError(
      "validation",
      `Nom de fichier invalide (1 à ${MAX_ATTACHMENT_FILENAME_LENGTH} caractères).`,
    );
  }
  if (/[/\\]/.test(filename) || filename.includes("\0")) {
    throw new ClassroomError(
      "validation",
      "Le nom du fichier ne peut pas contenir de séparateur de chemin.",
    );
  }
  return filename;
}

function assertContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new ClassroomError("validation", "Type de contenu invalide.");
  }
  const contentType = value.trim();
  if (contentType.length === 0 || contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new ClassroomError(
      "validation",
      `Type de contenu invalide (1 à ${MAX_CONTENT_TYPE_LENGTH} caractères).`,
    );
  }
  return contentType;
}

/**
 * Valide les jetons d'upload avant rattachement : bornés à 5, chacun préfixé
 * par `classroom/<orgId>/` — un jeton d'une autre organisation ne passe jamais.
 */
function assertAttachmentTokens(
  actor: Actor,
  attachments: SubmissionAttachmentToken[],
): SubmissionAttachmentToken[] {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ClassroomError("validation", `${MAX_ATTACHMENTS} pièces jointes au maximum.`);
  }
  const prefix = `classroom/${actor.orgId}/`;
  return attachments.map((attachment) => {
    if (!attachment.storageKey.startsWith(prefix)) {
      throw new ClassroomError("validation", "Clé de pièce jointe invalide.");
    }
    if (
      !Number.isInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0 ||
      attachment.sizeBytes > MAX_ATTACHMENT_BYTES
    ) {
      throw new ClassroomError("validation", "Taille de pièce jointe invalide.");
    }
    return {
      storageKey: attachment.storageKey,
      filename: assertAttachmentFilename(attachment.filename),
      contentType: assertContentType(attachment.contentType),
      sizeBytes: attachment.sizeBytes,
    };
  });
}

/** Métadonnées des pièces jointes de plusieurs copies (une seule requête). */
async function attachmentsBySubmission(
  submissionIds: string[],
): Promise<Map<string, SubmissionAttachmentMeta[]>> {
  const result = new Map<string, SubmissionAttachmentMeta[]>();
  if (submissionIds.length === 0) return result;
  const rows = await db()
    .select()
    .from(classroomSubmissionAttachments)
    .where(inArray(classroomSubmissionAttachments.submissionId, submissionIds))
    .orderBy(asc(classroomSubmissionAttachments.createdAt), asc(classroomSubmissionAttachments.id));
  for (const row of rows) {
    const list = result.get(row.submissionId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    });
    result.set(row.submissionId, list);
  }
  return result;
}

/**
 * Téléverse une pièce jointe et renvoie un jeton provisoire (non encore lié à
 * une copie) : `submitAssignment` le rattache à la copie rendue. Les
 * métadonnées (nom, type, taille) sont portées par le jeton ; le binaire vit
 * dans le stockage sous `classroom/<orgId>/<uuid>`.
 */
export async function uploadSubmissionAttachment(
  actor: Actor,
  input: { filename: string; contentType: string; body: Buffer },
): Promise<SubmissionAttachmentToken> {
  const filename = assertAttachmentFilename(input.filename);
  const contentType = assertContentType(input.contentType);
  if (input.body.length > MAX_ATTACHMENT_BYTES) {
    throw new ClassroomError(
      "validation",
      `Pièce jointe trop volumineuse (${MAX_ATTACHMENT_BYTES / (1024 * 1024)} Mo maximum).`,
    );
  }
  const storageKey = `classroom/${actor.orgId}/${randomUUID()}`;
  await getStorage().put({ key: storageKey, body: input.body, contentType });
  return { storageKey, filename, contentType, sizeBytes: input.body.length };
}

/** Pièce jointe d'une copie — l'élève propriétaire ou un enseignant du cours, jamais un tiers. */
async function requireReadableSubmissionAttachment(actor: Actor, attachmentId: string) {
  const [row] = await db()
    .select({
      attachment: classroomSubmissionAttachments,
      studentId: classroomSubmissions.studentId,
      courseId: classroomAssignments.courseId,
    })
    .from(classroomSubmissionAttachments)
    .innerJoin(
      classroomSubmissions,
      eq(classroomSubmissions.id, classroomSubmissionAttachments.submissionId),
    )
    .innerJoin(classroomAssignments, eq(classroomAssignments.id, classroomSubmissions.assignmentId))
    .innerJoin(classroomCourses, eq(classroomCourses.id, classroomAssignments.courseId))
    .where(
      and(
        eq(classroomSubmissionAttachments.id, attachmentId),
        eq(classroomCourses.orgId, actor.orgId),
      ),
    )
    .limit(1);
  if (!row) throw new ClassroomError("not_found", "Pièce jointe introuvable.");
  if (row.studentId === actor.userId) return row.attachment;

  const [membership] = await db()
    .select({ role: classroomMembers.role })
    .from(classroomMembers)
    .where(
      and(eq(classroomMembers.courseId, row.courseId), eq(classroomMembers.userId, actor.userId)),
    )
    .limit(1);
  if (membership?.role !== "teacher") {
    throw new ClassroomError(
      "forbidden",
      "Cette pièce jointe est réservée à l'élève et aux enseignants du cours.",
    );
  }
  return row.attachment;
}

/** Téléchargement d'une pièce jointe — réservé à l'élève propriétaire et aux enseignants du cours. */
export async function getSubmissionAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<SubmissionAttachmentDownload> {
  const attachment = await requireReadableSubmissionAttachment(actor, attachmentId);
  const body = await getStorage().get(attachment.storageKey);
  if (!body) throw new ClassroomError("not_found", "Pièce jointe introuvable.");
  return { filename: attachment.filename, contentType: attachment.contentType, body };
}

export async function submitAssignment(
  actor: Actor,
  assignmentId: string,
  content: string,
  attachments: SubmissionAttachmentToken[] = [],
): Promise<{ ok: true }> {
  const [assignment] = await db()
    .select()
    .from(classroomAssignments)
    .where(eq(classroomAssignments.id, assignmentId))
    .limit(1);
  if (!assignment) throw new ClassroomError("not_found", "Devoir introuvable.");

  const { role } = await requireCourse(actor, assignment.courseId);
  if (role === "teacher") {
    throw new ClassroomError("validation", "Les enseignants ne rendent pas de copie.");
  }

  const clean = content.trim();
  if (clean.length < 1 || clean.length > 50_000) {
    throw new ClassroomError("validation", "La copie doit contenir entre 1 et 50 000 caractères.");
  }
  const tokens = assertAttachmentTokens(actor, attachments);

  const { submissionId, attached } = await withTransaction(async (tx) => {
    const [submission] = await tx
      .insert(classroomSubmissions)
      .values({ assignmentId, studentId: actor.userId, content: clean })
      .onConflictDoUpdate({
        target: [classroomSubmissions.assignmentId, classroomSubmissions.studentId],
        // Une copie peut toujours être remplacée, mais la note déjà posée est
        // conservée : l'enseignant re-note explicitement s'il le souhaite.
        set: { content: clean, submittedAt: new Date() },
      })
      .returning({ id: classroomSubmissions.id });
    if (!submission) throw new ClassroomError("conflict", "Remise de la copie impossible.");

    // Les pièces jointes sont rattachées dans la même transaction que la copie :
    // pas de copie sans ses fichiers, pas de fichiers orphelins. Une nouvelle
    // remise ajoute ses fichiers à ceux déjà rendus (aucune suppression
    // silencieuse d'un fichier précédemment déposé).
    const rows =
      tokens.length > 0
        ? await tx
            .insert(classroomSubmissionAttachments)
            .values(
              tokens.map((attachment) => ({
                submissionId: submission.id,
                storageKey: attachment.storageKey,
                filename: attachment.filename,
                contentType: attachment.contentType,
                sizeBytes: attachment.sizeBytes,
              })),
            )
            .returning({ id: classroomSubmissionAttachments.id })
        : [];
    return { submissionId: submission.id, attached: rows };
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.submission.submit",
    resourceType: "assignment",
    resourceId: assignmentId,
    result: "success",
  });

  // La remise est déjà journalisée par `classroom.submission.submit` : le
  // second évènement n'est émis que lorsqu'un dépôt de fichiers apporte une
  // information supplémentaire (jamais de doublon pour une copie nue).
  if (tokens.length > 0) {
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "classroom.submission.attach",
      resourceType: "submission",
      resourceId: submissionId,
      result: "success",
      metadata: { count: attached.length },
    });
  }

  return { ok: true };
}

export type TeacherSubmissionView = {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  content: string;
  submittedAt: string;
  grade: number | null;
  feedback: string | null;
  points: number;
  /** Métadonnées des pièces jointes (téléchargement via la route dédiée). */
  attachments: SubmissionAttachmentMeta[];
};

export async function listSubmissions(
  actor: Actor,
  assignmentId: string,
): Promise<TeacherSubmissionView[]> {
  const assignment = await requireTeacherByAssignment(actor, assignmentId);
  const rows = await db()
    .select({
      id: classroomSubmissions.id,
      studentId: classroomSubmissions.studentId,
      studentName: core.user.name,
      studentEmail: core.user.email,
      content: classroomSubmissions.content,
      submittedAt: classroomSubmissions.submittedAt,
      grade: classroomSubmissions.grade,
      feedback: classroomSubmissions.feedback,
    })
    .from(classroomSubmissions)
    .innerJoin(core.user, eq(core.user.id, classroomSubmissions.studentId))
    .where(eq(classroomSubmissions.assignmentId, assignmentId))
    .orderBy(asc(core.user.name));

  // Pièces jointes en une seule requête pour toute la liste (pas de N+1).
  const attachments = await attachmentsBySubmission(rows.map((row) => row.id));

  return rows.map((row) => ({
    ...row,
    submittedAt: row.submittedAt.toISOString(),
    points: assignment.points,
    attachments: attachments.get(row.id) ?? [],
  }));
}

export async function gradeSubmission(
  actor: Actor,
  submissionId: string,
  input: { grade: number; feedback?: string | null },
): Promise<{ ok: true }> {
  const [submission] = await db()
    .select()
    .from(classroomSubmissions)
    .where(eq(classroomSubmissions.id, submissionId))
    .limit(1);
  if (!submission) throw new ClassroomError("not_found", "Copie introuvable.");
  const assignment = await requireTeacherByAssignment(actor, submission.assignmentId);

  if (!Number.isFinite(input.grade) || !Number.isInteger(input.grade)) {
    throw new ClassroomError("validation", "La note doit être un nombre entier.");
  }
  if (input.grade < 0 || input.grade > assignment.points) {
    throw new ClassroomError(
      "validation",
      `La note doit être comprise entre 0 et ${assignment.points}.`,
    );
  }
  const feedback = input.feedback?.trim() ? input.feedback.trim().slice(0, 5000) : null;

  await db()
    .update(classroomSubmissions)
    .set({ grade: input.grade, feedback, gradedAt: new Date() })
    .where(eq(classroomSubmissions.id, submissionId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.submission.grade",
    resourceType: "submission",
    resourceId: submissionId,
    result: "success",
    metadata: { grade: input.grade },
  });

  // Notification best-effort à l'élève noté.
  await createNotification({
    orgId: actor.orgId,
    userId: submission.studentId,
    kind: "graded",
    title: `Copie notée : ${assignment.title}`,
    body: `Note : ${input.grade}/${assignment.points}`,
    href: getAppUrls().classroom,
  }).catch(() => undefined);

  return { ok: true };
}
