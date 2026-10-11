import { randomBytes } from "node:crypto";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ClassroomCourseRow,
  type ClassroomSubmissionRow,
  classroomAssignments,
  classroomCourses,
  classroomMembers,
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
  await db()
    .insert(classroomMembers)
    .values({ courseId: course.id, userId: actor.userId, role: "student" })
    .onConflictDoNothing({
      target: [classroomMembers.courseId, classroomMembers.userId],
    });
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
  return created;
}

export async function deleteAssignment(actor: Actor, assignmentId: string): Promise<void> {
  await requireTeacherByAssignment(actor, assignmentId);
  await db().delete(classroomAssignments).where(eq(classroomAssignments.id, assignmentId));
}

export async function submitAssignment(
  actor: Actor,
  assignmentId: string,
  content: string,
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

  await db()
    .insert(classroomSubmissions)
    .values({ assignmentId, studentId: actor.userId, content: clean })
    .onConflictDoUpdate({
      target: [classroomSubmissions.assignmentId, classroomSubmissions.studentId],
      // Une copie peut toujours être remplacée, mais la note déjà posée est
      // conservée : l'enseignant re-note explicitement s'il le souhaite.
      set: { content: clean, submittedAt: new Date() },
    });
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

  return rows.map((row) => ({
    ...row,
    submittedAt: row.submittedAt.toISOString(),
    points: assignment.points,
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
  return { ok: true };
}
