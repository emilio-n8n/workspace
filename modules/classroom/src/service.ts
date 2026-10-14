/**
 * Classroom — cours, devoirs, copies, fil d'actualité.
 *
 * **Modèle d'accès : l'adhésion, pas l'organisation.** Chaque inscription crée
 * son propre espace personnel (`ensurePersonalOrganization`) : un enseignant et
 * ses élèves vivent donc dans des organisations différentes. Un cours se
 * rejoint avec son code d'accès (8 caractères, 31 symboles, jamais de
 * caractère ambigu) et cette adhésion — et elle seule — ouvre le cours. C'est
 * pourquoi `requireCourse` ne compare jamais `classroom_courses.orgId` à
 * l'organisation de l'acteur : un filtre d'organisation rendrait tout devoir
 * invisible à l'élève qui vient de le rejoindre. La frontière de sécurité,
 * c'est `classroom_members` (un cours, un utilisateur, un rôle).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getAppUrls } from "@workspace/config";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import { createNotification } from "@workspace/notifications";
import type { Actor } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { buildGradebookCsv } from "./csv.ts";
import {
  type GradeSummary,
  type StudentGradeSummary,
  summarizeGrades,
  summarizeGradesByStudent,
} from "./grades.ts";
import {
  type ClassroomAnnouncementRow,
  type ClassroomCourseRow,
  type ClassroomSubmissionRow,
  classroomAnnouncementComments,
  classroomAnnouncements,
  classroomAssignments,
  classroomCourses,
  classroomMembers,
  classroomSubmissionAttachments,
  classroomSubmissions,
} from "./schema.ts";
import {
  type AssignmentStatusCode,
  assignmentStatus,
  type SubmissionStatusCode,
  submissionStatus,
} from "./status.ts";

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

/** Suivi des copies d'un devoir, réservé aux enseignants. */
export type AssignmentCounts = {
  /** Copies rendues, tous statuts confondus. */
  submitted: number;
  /** Copies rendues dans les temps, en attente de correction. */
  onTime: number;
  /** Copies rendues en retard, en attente de correction. */
  late: number;
  /** Copies notées. */
  graded: number;
  /** Élèves qui n'ont encore rien rendu. */
  pending: number;
};

export type AssignmentView = {
  id: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  points: number;
  submissionCount: number;
  mySubmission: SubmissionView | null;
  /** Statut du devoir pour l'élève connecté (toujours renseigné). */
  status: AssignmentStatusCode;
  /** Suivi des copies pour un enseignant, `null` pour un élève. */
  counts: AssignmentCounts | null;
};

export type CourseDetail = {
  id: string;
  name: string;
  section: string | null;
  joinCode: string | null;
  role: CourseRole;
  /** Enseignant qui a créé le cours — exposé aux enseignants seulement. */
  ownerId: string | null;
  members: MemberView[];
  assignments: AssignmentView[];
  /**
   * Notes de l'élève connecté (moyenne du cours, son point de vue) ; `null`
   * pour un enseignant, qui n'a pas de copie.
   */
  myGrades: GradeSummary | null;
  /**
   * Carnet de notes de la classe — moyenne générale et moyennes par élève ;
   * `null` pour un élève : les notes des autres ne le regardent pas.
   */
  classGrades: ClassGrades | null;
};

/** Carnet de notes d'un cours, réservé aux enseignants. */
export type ClassGrades = {
  /** Moyenne de toute la classe, toutes les copies corrigées ensemble. */
  summary: GradeSummary;
  /** Moyenne de chaque élève, triée par nom, avec son nom. */
  students: StudentGradeRow[];
};

/** Moyenne d'un élève, nom résolu — ce que lit l'interface. */
export type StudentGradeRow = StudentGradeSummary & { name: string };

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
/** Consignes d'un devoir, un devoir pouvant être un énoncé long. */
export const MAX_INSTRUCTIONS_LENGTH = 20_000;
/** Barème d'un devoir, en points. */
export const MAX_POINTS = 1000;

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/** Limite de longueur partagée par les champs textuels courts (nom, titre). */
const MAX_NAME_LENGTH = 150;

/** Coupe, borne et refuse le vide — message en français, jamais d'écrêtage. */
function assertText(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new ClassroomError("validation", `${label} doit contenir entre 1 et ${max} caractères.`);
  }
  return trimmed;
}

function assertName(name: string, label = "Le nom"): string {
  return assertText(name, label, MAX_NAME_LENGTH);
}

/**
 * Barème d'un devoir : entier entre 0 et 1000, sans écrêtage silencieux —
 * une valeur hors bornes est refusée, comme pour une note.
 */
function assertPoints(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS) {
    throw new ClassroomError(
      "validation",
      `Le barème doit être un nombre entier entre 0 et ${MAX_POINTS}.`,
    );
  }
  return value;
}

/** Échéance d'un devoir : ISO 8601, ou `null` pour un devoir sans échéance. */
function parseDueAt(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ClassroomError("validation", "Échéance invalide.");
  }
  return parsed;
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
  if (!course) {
    throw new ClassroomError("not_found", "Cours introuvable.");
  }
  // L'organisation du cours n'est PAS comparée à celle de l'acteur : un élève
  // rejoint un cours depuis son propre espace personnel, l'adhésion décide.
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

  // Recherche par code seul : le code est l'invitation, il fait franchir la
  // frontière d'organisation (l'élève vient de son espace personnel). Un code
  // inconnu ne dit rien de plus — même message qu'avant.
  const [course] = await db()
    .select()
    .from(classroomCourses)
    .where(eq(classroomCourses.joinCode, clean))
    .limit(1);
  if (!course) {
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
  // produit aucune ligne d'audit. L'évènement appartient à l'organisation du
  // cours (la ressource vit là), l'acteur, lui, vient d'ailleurs.
  if (inserted.length > 0) {
    await recordAudit({
      orgId: course.orgId,
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
  // Tous les cours dont l'utilisateur est membre, quelle que soit
  // l'organisation : l'élève retrouve le cours qu'il a rejoint par code.
  const rows = await db()
    .select({ course: classroomCourses, role: classroomMembers.role })
    .from(classroomMembers)
    .innerJoin(classroomCourses, eq(classroomCourses.id, classroomMembers.courseId))
    .where(eq(classroomMembers.userId, actor.userId));
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
  /** Suivi des copies, agrégé pour les enseignants seulement. */
  const tracked = new Map<string, { onTime: number; late: number; graded: number }>();
  /** Notes du cours, indexées `élève:devoir` — le carnet de l'enseignant. */
  const gradeByKey = new Map<string, number | null>();
  let myAttachments = new Map<string, SubmissionAttachmentMeta[]>();
  const students = memberRows.filter((member) => member.role === "student");
  const studentCount = students.length;
  const studentNames = new Map(students.map((member) => [member.userId, member.name]));

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

    // Une troisième requête, réservée aux enseignants, suffit à départager les
    // copies rendues dans les temps, en retard et notées (mêmes priorités que
    // `submissionStatus`, jamais une table de vérité séparée), et à nourrir le
    // carnet de notes (une ligne par copie, avec le barème de son devoir).
    if (role === "teacher") {
      const rows = await db()
        .select({
          assignmentId: classroomSubmissions.assignmentId,
          studentId: classroomSubmissions.studentId,
          grade: classroomSubmissions.grade,
          points: classroomAssignments.points,
          submittedAt: classroomSubmissions.submittedAt,
          dueAt: classroomAssignments.dueAt,
        })
        .from(classroomSubmissions)
        .innerJoin(
          classroomAssignments,
          eq(classroomAssignments.id, classroomSubmissions.assignmentId),
        )
        .where(inArray(classroomSubmissions.assignmentId, assignmentIds));
      for (const row of rows) {
        const bucket = tracked.get(row.assignmentId) ?? { onTime: 0, late: 0, graded: 0 };
        const code = submissionStatus({
          submittedAt: row.submittedAt.toISOString(),
          dueAt: row.dueAt?.toISOString() ?? null,
          grade: row.grade,
        });
        if (code === "graded") bucket.graded += 1;
        else if (code === "late") bucket.late += 1;
        else bucket.onTime += 1;
        tracked.set(row.assignmentId, bucket);
        gradeByKey.set(`${row.studentId}:${row.assignmentId}`, row.grade);
      }
    }
  }

  const assignments: AssignmentView[] = assignmentRows.map((assignment) => {
    const mine = mySubmissions.get(assignment.id);
    const submitted = submissionCounts.get(assignment.id) ?? 0;
    return {
      id: assignment.id,
      title: assignment.title,
      instructions: assignment.instructions,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      points: assignment.points,
      submissionCount: submitted,
      mySubmission: mine
        ? {
            content: mine.content,
            submittedAt: mine.submittedAt.toISOString(),
            grade: mine.grade,
            feedback: mine.feedback,
            attachments: myAttachments.get(mine.id) ?? [],
          }
        : null,
      status: assignmentStatus({
        submission: mine
          ? { submittedAt: mine.submittedAt.toISOString(), grade: mine.grade }
          : null,
        dueAt: assignment.dueAt?.toISOString() ?? null,
      }),
      counts:
        role === "teacher"
          ? {
              submitted,
              onTime: tracked.get(assignment.id)?.onTime ?? 0,
              late: tracked.get(assignment.id)?.late ?? 0,
              graded: tracked.get(assignment.id)?.graded ?? 0,
              pending: Math.max(0, studentCount - submitted),
            }
          : null,
    };
  });

  // --- Notes ---------------------------------------------------------------
  // Élève : sa moyenne, devoir par devoir (y compris ceux qu'il n'a pas
  // rendus — ils comptent dans le total, pas dans les points possibles).
  const myGrades: GradeSummary | null =
    role === "student"
      ? summarizeGrades(
          assignmentRows.map((assignment) => ({
            grade: mySubmissions.get(assignment.id)?.grade ?? null,
            points: assignment.points,
          })),
        )
      : null;

  // Enseignant : le carnet complet — chaque élève confronté à chaque devoir,
  // pour qu'un devoir non rendu apparaisse comme tel et non comme un oubli.
  const classGradeEntries = () =>
    students.flatMap((student) =>
      assignmentRows.map((assignment) => {
        const key = `${student.userId}:${assignment.id}`;
        return {
          studentId: student.userId,
          grade: gradeByKey.get(key) ?? null,
          points: assignment.points,
        };
      }),
    );

  const classGrades: ClassGrades | null =
    role === "teacher"
      ? {
          summary: summarizeGrades(classGradeEntries()),
          students: summarizeGradesByStudent(classGradeEntries(), studentNames).map((row) => ({
            ...row,
            name: studentNames.get(row.studentId) ?? "Élève inconnu",
          })),
        }
      : null;

  return {
    id: course.id,
    name: course.name,
    section: course.section,
    joinCode: role === "teacher" ? course.joinCode : null,
    role,
    ownerId: role === "teacher" ? course.ownerId : null,
    members: memberRows.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role === "teacher" ? "teacher" : "student",
    })),
    assignments,
    myGrades,
    classGrades,
  };
}

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

/**
 * Retire un membre du cours. L'enseignant garde ses copies et leurs notes
 * (retirer un élève n'efface pas son travail déjà corrigé) ; l'élève, lui,
 * perd tout accès au cours. Trois refus, tous explicites : se retirer
 * soi-même, retirer l'enseignant propriétaire, retirer un inconnu.
 */
export async function removeMember(actor: Actor, courseId: string, userId: string): Promise<void> {
  const { course } = await requireTeacher(actor, courseId);

  if (userId === actor.userId) {
    throw new ClassroomError("validation", "Vous ne pouvez pas vous retirer vous-même du cours.");
  }
  if (userId === course.ownerId) {
    throw new ClassroomError(
      "forbidden",
      "L'enseignant qui a créé le cours ne peut pas en être retiré.",
    );
  }

  const [member] = await db()
    .select({ id: classroomMembers.id })
    .from(classroomMembers)
    .where(and(eq(classroomMembers.courseId, courseId), eq(classroomMembers.userId, userId)))
    .limit(1);
  if (!member) {
    throw new ClassroomError("not_found", "Ce membre ne fait pas partie du cours.");
  }

  await db().delete(classroomMembers).where(eq(classroomMembers.id, member.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.member.remove",
    resourceType: "member",
    resourceId: userId,
    result: "success",
    metadata: { courseId },
  });
}

/**
 * Régénère le code d'invitation d'un cours. L'ancien code cesse aussitôt de
 * fonctionner et un nouveau lui succède (jamais deux cours sur le même code) ;
 * les membres déjà inscrits gardent leur accès — le code n'est qu'une porte
 * d'entrée. Réservé aux enseignants.
 */
export async function regenerateJoinCode(
  actor: Actor,
  courseId: string,
): Promise<{ joinCode: string }> {
  await requireTeacher(actor, courseId);

  // `generateJoinCode` vérifie l'unicité dans toute la table : le code rendu
  // ne peut pas être celui qui vient d'être remplacé.
  const joinCode = await generateJoinCode();
  await db().update(classroomCourses).set({ joinCode }).where(eq(classroomCourses.id, courseId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.course.regenerate_code",
    resourceType: "course",
    resourceId: courseId,
    result: "success",
  });

  return { joinCode };
}

// ---------------------------------------------------------------------------
// Fil d'actualité : publications et commentaires
// ---------------------------------------------------------------------------

/** Bornes éditoriales du fil : publication longue, commentaire court. */
export const MAX_ANNOUNCEMENT_BODY = 5000;
export const MAX_COMMENT_BODY = 2000;

export type AnnouncementAuthor = { id: string; name: string };

export type AnnouncementCommentView = {
  id: string;
  body: string;
  createdAt: string;
  author: AnnouncementAuthor;
  /** L'auteur du commentaire et les enseignants du cours peuvent le supprimer. */
  canDelete: boolean;
};

export type AnnouncementView = {
  id: string;
  body: string;
  createdAt: string;
  author: AnnouncementAuthor;
  comments: AnnouncementCommentView[];
  /** Seuls les enseignants du cours peuvent supprimer une publication. */
  canDelete: boolean;
};

/**
 * Publication + cours d'origine. La garde est l'adhésion au cours
 * (`requireCourse`) : un enseignant d'une autre organisation n'est pas membre,
 * il ne voit rien.
 */
async function requireAnnouncement(
  actor: Actor,
  announcementId: string,
): Promise<{ announcement: ClassroomAnnouncementRow; role: CourseRole }> {
  const [row] = await db()
    .select({
      announcement: classroomAnnouncements,
      courseId: classroomAnnouncements.courseId,
    })
    .from(classroomAnnouncements)
    .where(eq(classroomAnnouncements.id, announcementId))
    .limit(1);
  if (!row) {
    throw new ClassroomError("not_found", "Publication introuvable.");
  }
  const { role } = await requireCourse(actor, row.announcement.courseId);
  return { announcement: row.announcement, role };
}

/** Publie une annonce dans le fil du cours — réservé aux enseignants. */
export async function createAnnouncement(
  actor: Actor,
  courseId: string,
  input: { body: string },
): Promise<{ id: string }> {
  await requireTeacher(actor, courseId);

  const body = assertText(input.body, "La publication", MAX_ANNOUNCEMENT_BODY);
  const [created] = await db()
    .insert(classroomAnnouncements)
    .values({ courseId, authorId: actor.userId, body })
    .returning({ id: classroomAnnouncements.id });
  if (!created) throw new ClassroomError("conflict", "Publication impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.announcement.create",
    resourceType: "announcement",
    resourceId: created.id,
    result: "success",
  });

  return created;
}

/**
 * Fil du cours, de la publication la plus récente à la plus ancienne, chaque
 * publication portant ses commentaires du plus ancien au plus récent (ordre de
 * lecture d'une conversation).
 */
export async function listAnnouncements(
  actor: Actor,
  courseId: string,
): Promise<AnnouncementView[]> {
  const { role } = await requireCourse(actor, courseId);

  const announcementRows = await db()
    .select()
    .from(classroomAnnouncements)
    .where(eq(classroomAnnouncements.courseId, courseId))
    .orderBy(desc(classroomAnnouncements.createdAt));
  if (announcementRows.length === 0) return [];

  // Auteurs (enseignants) puis commentaires : deux requêtes pour tout le fil,
  // jamais une par publication.
  const authorIds = new Set<string>(announcementRows.map((row) => row.authorId));
  const commentRows = await db()
    .select()
    .from(classroomAnnouncementComments)
    .where(
      inArray(
        classroomAnnouncementComments.announcementId,
        announcementRows.map((r) => r.id),
      ),
    )
    .orderBy(asc(classroomAnnouncementComments.createdAt), asc(classroomAnnouncementComments.id));
  for (const row of commentRows) authorIds.add(row.authorId);

  const names = new Map<string, string>();
  if (authorIds.size > 0) {
    const users = await db()
      .select({ id: core.user.id, name: core.user.name })
      .from(core.user)
      .where(inArray(core.user.id, [...authorIds]));
    for (const user of users) names.set(user.id, user.name);
  }

  const commentsByAnnouncement = new Map<string, AnnouncementCommentView[]>();
  for (const row of commentRows) {
    const list = commentsByAnnouncement.get(row.announcementId) ?? [];
    list.push({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: { id: row.authorId, name: names.get(row.authorId) ?? "Utilisateur supprimé" },
      canDelete: role === "teacher" || row.authorId === actor.userId,
    });
    commentsByAnnouncement.set(row.announcementId, list);
  }

  return announcementRows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.authorId, name: names.get(row.authorId) ?? "Utilisateur supprimé" },
    comments: commentsByAnnouncement.get(row.id) ?? [],
    canDelete: role === "teacher",
  }));
}

/** Commente une publication du cours — ouvert à tous les membres. */
export async function addComment(
  actor: Actor,
  announcementId: string,
  input: { body: string },
): Promise<{ id: string }> {
  const { announcement } = await requireAnnouncement(actor, announcementId);
  const body = assertText(input.body, "Le commentaire", MAX_COMMENT_BODY);

  const [created] = await db()
    .insert(classroomAnnouncementComments)
    .values({ announcementId: announcement.id, authorId: actor.userId, body })
    .returning({ id: classroomAnnouncementComments.id });
  if (!created) throw new ClassroomError("conflict", "Commentaire impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.announcement.comment",
    resourceType: "comment",
    resourceId: created.id,
    result: "success",
    metadata: { announcementId: announcement.id },
  });

  return created;
}

/** Supprime une publication et ses commentaires (cascade) — enseignants seuls. */
export async function deleteAnnouncement(actor: Actor, announcementId: string): Promise<void> {
  const { announcement, role } = await requireAnnouncement(actor, announcementId);
  if (role !== "teacher") {
    throw new ClassroomError("forbidden", "Suppression réservée aux enseignants du cours.");
  }

  await db().delete(classroomAnnouncements).where(eq(classroomAnnouncements.id, announcement.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.announcement.delete",
    resourceType: "announcement",
    resourceId: announcement.id,
    result: "success",
  });
}

/** Supprime un commentaire — son auteur, ou un enseignant du cours. */
export async function deleteComment(actor: Actor, commentId: string): Promise<void> {
  const [row] = await db()
    .select({
      comment: classroomAnnouncementComments,
      courseId: classroomAnnouncements.courseId,
    })
    .from(classroomAnnouncementComments)
    .innerJoin(
      classroomAnnouncements,
      eq(classroomAnnouncements.id, classroomAnnouncementComments.announcementId),
    )
    .where(eq(classroomAnnouncementComments.id, commentId))
    .limit(1);
  if (!row) {
    throw new ClassroomError("not_found", "Commentaire introuvable.");
  }

  // L'adhésion au cours remplace le filtre d'organisation : l'élève qui a
  // commenté depuis son espace personnel doit pouvoir retirer son commentaire.
  const { role } = await requireCourse(actor, row.courseId);
  if (role !== "teacher" && row.comment.authorId !== actor.userId) {
    throw new ClassroomError("forbidden", "Ce commentaire ne vous appartient pas.");
  }

  await db()
    .delete(classroomAnnouncementComments)
    .where(eq(classroomAnnouncementComments.id, row.comment.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.comment.delete",
    resourceType: "comment",
    resourceId: row.comment.id,
    result: "success",
    metadata: { announcementId: row.comment.announcementId },
  });
}

// ---------------------------------------------------------------------------
// Devoirs et copies
// ---------------------------------------------------------------------------

export async function createAssignment(
  actor: Actor,
  courseId: string,
  input: { title: string; instructions?: string; dueAt?: string | null; points?: number },
): Promise<{ id: string }> {
  const { course } = await requireTeacher(actor, courseId);

  const title = assertName(input.title, "Le titre");
  const instructions = (input.instructions ?? "").slice(0, MAX_INSTRUCTIONS_LENGTH);
  const points = assertPoints(input.points);
  const dueAt = parseDueAt(input.dueAt ?? null);

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

  // Notification best-effort aux élèves du cours (jamais l'enseignant qui crée
  // le devoir), déposée dans l'organisation où chacun suit le cours.
  await notifyAssignmentCreated(courseId, course.orgId, title, dueAt);

  return created;
}

/**
 * Modifie un devoir existant. Chaque champ est facultatif : seules les clés
 * fournies sont écrites, et une chaîne vide efface le champ (consignes
 * vidées, échéance retirée) — un enseignant peut donc tout corriger.
 */
export async function updateAssignment(
  actor: Actor,
  assignmentId: string,
  input: { title?: string; instructions?: string; dueAt?: string | null; points?: number },
): Promise<{ ok: true }> {
  await requireTeacherByAssignment(actor, assignmentId);

  const values: {
    title?: string;
    instructions?: string;
    dueAt?: Date | null;
    points?: number;
  } = {};
  if (input.title !== undefined) values.title = assertName(input.title, "Le titre");
  if (input.instructions !== undefined) {
    values.instructions = input.instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);
  }
  if (input.dueAt !== undefined) values.dueAt = parseDueAt(input.dueAt);
  if (input.points !== undefined) values.points = assertPoints(input.points);

  const fields = Object.keys(values);
  if (fields.length === 0) {
    throw new ClassroomError("validation", "Aucune modification à enregistrer.");
  }

  await db()
    .update(classroomAssignments)
    .set(values)
    .where(eq(classroomAssignments.id, assignmentId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.assignment.update",
    resourceType: "assignment",
    resourceId: assignmentId,
    result: "success",
    metadata: { fields: fields.join(", ") },
  });

  return { ok: true };
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
    .where(eq(classroomSubmissionAttachments.id, attachmentId))
    .limit(1);
  if (!row) throw new ClassroomError("not_found", "Pièce jointe introuvable.");
  // Le propriétaire passe toujours ; sinon il faut être enseignant du cours.
  // Le rang est donné par `classroom_members` (pas par l'organisation) : la
  // copie d'un élève d'un autre espace reste lisible par son professeur.
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

/**
 * Retire une pièce jointe d'une copie — seul l'élève qui l'a déposée peut la
 * retirer (l'enseignant consulte et note, il ne modifie pas la copie). Les
 * métadonnées disparaissent immédiatement ; le blob est nettoyé hors ligne.
 */
export async function removeSubmissionAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<void> {
  const [row] = await db()
    .select({
      attachment: classroomSubmissionAttachments,
      studentId: classroomSubmissions.studentId,
    })
    .from(classroomSubmissionAttachments)
    .innerJoin(
      classroomSubmissions,
      eq(classroomSubmissions.id, classroomSubmissionAttachments.submissionId),
    )
    .innerJoin(classroomAssignments, eq(classroomAssignments.id, classroomSubmissions.assignmentId))
    .where(eq(classroomSubmissionAttachments.id, attachmentId))
    .limit(1);
  if (!row) throw new ClassroomError("not_found", "Pièce jointe introuvable.");
  if (row.studentId !== actor.userId) {
    throw new ClassroomError("forbidden", "Seul l'élève qui a déposé ce fichier peut le retirer.");
  }

  await db()
    .delete(classroomSubmissionAttachments)
    .where(eq(classroomSubmissionAttachments.id, row.attachment.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "classroom.submission.detach",
    resourceType: "submission",
    resourceId: row.attachment.submissionId,
    result: "success",
    metadata: { attachmentId: row.attachment.id },
  });
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
  /** Échéance du devoir, pour situer un retard dans le temps. */
  dueAt: string | null;
  /** Statut de la copie : noté, en retard ou rendue (mêmes priorités). */
  status: SubmissionStatusCode;
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
  const dueAt = assignment.dueAt?.toISOString() ?? null;

  return rows.map((row) => ({
    ...row,
    submittedAt: row.submittedAt.toISOString(),
    points: assignment.points,
    dueAt,
    status: submissionStatus({
      submittedAt: row.submittedAt.toISOString(),
      dueAt,
      grade: row.grade,
    }),
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

  // Notification best-effort à l'élève noté, déposée dans SA organisation : un
  // élève qui a rejoint le cours depuis son espace personnel doit la voir dans
  // sa cloche, pas dans celle de son professeur.
  await createNotification({
    orgId: await notificationOrgId(submission.studentId, actor.orgId),
    userId: submission.studentId,
    kind: "graded",
    title: `Copie notée : ${assignment.title}`,
    body: `Note : ${input.grade}/${assignment.points}`,
    href: getAppUrls().classroom,
  }).catch(() => undefined);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Export CSV du carnet de notes
// ---------------------------------------------------------------------------

/**
 * Carnet de notes du cours au format CSV, réservé aux enseignants. Une ligne
 * par élève, une colonne par devoir (barème rappelé), puis la moyenne — les
 * mêmes règles que le carnet affiché : seules les copies corrigées comptent,
 * un devoir non rendu n'est jamais un zéro.
 */
export async function exportGradesCsv(
  actor: Actor,
  courseId: string,
): Promise<{ filename: string; body: string }> {
  const { course } = await requireTeacher(actor, courseId);

  const [students, assignments, submissions] = await Promise.all([
    db()
      .select({ userId: core.user.id, name: core.user.name })
      .from(classroomMembers)
      .innerJoin(core.user, eq(core.user.id, classroomMembers.userId))
      .where(and(eq(classroomMembers.courseId, courseId), eq(classroomMembers.role, "student")))
      .orderBy(asc(core.user.name)),
    db()
      .select({
        id: classroomAssignments.id,
        title: classroomAssignments.title,
        points: classroomAssignments.points,
      })
      .from(classroomAssignments)
      .where(eq(classroomAssignments.courseId, courseId))
      .orderBy(asc(classroomAssignments.createdAt), asc(classroomAssignments.id)),
    db()
      .select({
        studentId: classroomSubmissions.studentId,
        assignmentId: classroomSubmissions.assignmentId,
        grade: classroomSubmissions.grade,
      })
      .from(classroomSubmissions)
      .innerJoin(
        classroomAssignments,
        eq(classroomAssignments.id, classroomSubmissions.assignmentId),
      )
      .where(eq(classroomAssignments.courseId, courseId)),
  ]);

  const gradeByKey = new Map(
    submissions.map((row) => [`${row.studentId}:${row.assignmentId}`, row.grade]),
  );

  const rows = students.map((student) => {
    const entries = assignments.map((assignment) => ({
      grade: gradeByKey.get(`${student.userId}:${assignment.id}`) ?? null,
      points: assignment.points,
    }));
    return {
      name: student.name,
      grades: entries.map((entry) => entry.grade),
      summary: summarizeGrades(entries),
    };
  });

  const csv = buildGradebookCsv({
    columns: assignments.map((assignment) => ({
      title: assignment.title,
      points: assignment.points,
    })),
    rows,
  });

  return { filename: `${exportFilename(course.name)} — notes.csv`, body: csv };
}

/** Nom de fichier sûr : jamais de séparateur de chemin, une longueur bornée. */
function exportFilename(courseName: string): string {
  const clean = courseName.replace(/[/\\]/g, "-").trim();
  return clean.length > 0 ? clean.slice(0, 100) : "cours";
}

/**
 * Notifie chaque élève qu'un devoir vient d'être publié. Le kind `system` est
 * la seule valeur du noyau qui ne mente pas sur ce que porte la notification —
 * le titre, lui, dit exactement de quoi il s'agit. Best-effort : une panne de
 * notification ne casse jamais la création du devoir.
 */
async function notifyAssignmentCreated(
  courseId: string,
  courseOrgId: string,
  title: string,
  dueAt: Date | null,
): Promise<void> {
  const students = await db()
    .select({ userId: classroomMembers.userId })
    .from(classroomMembers)
    .where(and(eq(classroomMembers.courseId, courseId), eq(classroomMembers.role, "student")));
  if (students.length === 0) return;

  const orgIds = await notificationOrgIds(
    students.map((student) => student.userId),
    courseOrgId,
  );
  const body = dueAt
    ? `À rendre le ${dueAt.toLocaleDateString("fr-FR")}.`
    : "Consultez le devoir, sans échéance imposée.";
  const href = getAppUrls().classroom;

  for (const student of students) {
    await createNotification({
      orgId: orgIds.get(student.userId) ?? courseOrgId,
      userId: student.userId,
      kind: "system",
      title: `Nouveau devoir : ${title}`,
      body,
      href,
    }).catch(() => undefined);
  }
}

/**
 * Organisation où notifier un destinataire : celle du cours quand il en est
 * membre (cas courant, l'élève inscrit dans l'établissement), sinon sa propre
 * organisation — la plus ancienne, celle de son espace personnel. Repli sur
 * l'organisation fournie si l'utilisateur n'appartient à aucune.
 */
async function notificationOrgId(userId: string, preferredOrgId: string): Promise<string> {
  const ids = await notificationOrgIds([userId], preferredOrgId);
  return ids.get(userId) ?? preferredOrgId;
}

/**
 * Organisations de notification d'un lot d'utilisateurs : une seule requête
 * d'appartenance pour tout le lot (pas de N+1). Pour chacun, l'organisation du
 * cours prime ; à défaut, la plus ancienne.
 */
async function notificationOrgIds(
  userIds: string[],
  preferredOrgId: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;

  const rows = await db()
    .select({ userId: core.member.userId, organizationId: core.member.organizationId })
    .from(core.member)
    .where(inArray(core.member.userId, userIds))
    .orderBy(asc(core.member.createdAt));

  for (const row of rows) {
    // La plus ancienne l'emporte ; l'organisation du cours la supplante.
    if (!result.has(row.userId) || row.organizationId === preferredOrgId) {
      result.set(row.userId, row.organizationId);
    }
  }
  return result;
}
