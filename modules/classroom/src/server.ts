import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addComment,
  createAnnouncement,
  createAssignment,
  createCourse,
  deleteAnnouncement,
  deleteAssignment,
  deleteComment,
  exportGradesCsv,
  getCourse,
  gradeSubmission,
  joinByCode,
  listAnnouncements,
  listCourses,
  listSubmissions,
  MAX_ANNOUNCEMENT_BODY,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_COMMENT_BODY,
  regenerateJoinCode,
  removeMember,
  removeSubmissionAttachment,
  submitAssignment,
  updateAssignment,
  uploadSubmissionAttachment,
} from "./index.ts";

export type {
  AnnouncementCommentView,
  AnnouncementView,
  AssignmentCounts,
  AssignmentView,
  ClassGrades,
  CourseDetail,
  CourseRole,
  CourseSummary,
  GradeSummary,
  MemberView,
  StudentGradeRow,
  StudentGradeSummary,
  SubmissionAttachmentMeta,
  SubmissionAttachmentToken,
  TeacherSubmissionView,
} from "./index.ts";

/** Jeton renvoyé par uploadSubmissionAttachmentFn, rejoué tel quel au rendu. */
const attachmentTokenSchema = z.object({
  storageKey: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
});

/** Base64 d'une pièce jointe de 10 Mio (4 caractères pour 3 octets). */
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

export const listCoursesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listCourses(actor);
});

export const createCourseFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(150),
        section: z.string().max(150).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createCourse(actor, { name: data.name, section: data.section });
  });

export const joinCourseFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ code: z.string().trim().min(4).max(12) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return joinByCode(actor, data.code);
  });

export const getCourseFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ courseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getCourse(actor, data.courseId);
  });

export const exportGradesCsvFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ courseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return exportGradesCsv(actor, data.courseId);
  });

export const createAssignmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        courseId: z.string().uuid(),
        title: z.string().trim().min(1).max(150),
        instructions: z.string().max(20_000).optional(),
        dueAt: z.string().nullish(),
        points: z.number().int().min(0).max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createAssignment(actor, data.courseId, {
      title: data.title,
      instructions: data.instructions,
      dueAt: data.dueAt,
      points: data.points,
    });
  });

/**
 * Édition d'un devoir : chaque champ est facultatif, seules les clés fournies
 * sont modifiées. `instructions` vide ou `dueAt` nul effacent le champ.
 */
export const updateAssignmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        assignmentId: z.string().uuid(),
        title: z.string().trim().min(1).max(150).optional(),
        instructions: z.string().max(20_000).optional(),
        dueAt: z.string().nullable().optional(),
        points: z.number().int().min(0).max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return updateAssignment(actor, data.assignmentId, {
      title: data.title,
      instructions: data.instructions,
      dueAt: data.dueAt,
      points: data.points,
    });
  });

export const deleteAssignmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ assignmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteAssignment(actor, data.assignmentId);
    return { ok: true };
  });

export const submitAssignmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        assignmentId: z.string().uuid(),
        content: z.string().trim().min(1).max(50_000),
        /** Jetons d'upload (uploadSubmissionAttachmentFn) à rattacher à la copie. */
        attachments: z.array(attachmentTokenSchema).max(MAX_ATTACHMENTS).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return submitAssignment(actor, data.assignmentId, data.content, data.attachments ?? []);
  });

/**
 * Téléversement d'une pièce jointe de copie : le binaire circule en base64
 * (les server functions sont du JSON), puis devient un jeton provisoire
 * rattaché à la copie au moment de la remise.
 */
export const uploadSubmissionAttachmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(200),
        contentBase64: z
          .string()
          .min(1)
          .max(MAX_ATTACHMENT_BASE64_LENGTH)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return uploadSubmissionAttachment(actor, {
      filename: data.filename,
      contentType: data.contentType,
      body: Buffer.from(data.contentBase64, "base64"),
    });
  });

export const listSubmissionsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ assignmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listSubmissions(actor, data.assignmentId);
  });

export const removeSubmissionAttachmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ attachmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await removeSubmissionAttachment(actor, data.attachmentId);
    return { ok: true };
  });

/**
 * Retrait d'un membre du cours, par un enseignant. Les copies déjà déposées
 * et leurs notes sont conservées (le travail corrigé ne disparaît pas) ;
 * l'élève perd simplement l'accès au cours.
 */
export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ courseId: z.string().uuid(), userId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await removeMember(actor, data.courseId, data.userId);
    return { ok: true };
  });

/**
 * Régénère le code d'invitation d'un cours (enseignants seuls). L'ancien code
 * ne fonctionne plus : la réponse porte le nouveau, à communiquer aux élèves.
 */
export const regenerateJoinCodeFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ courseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return regenerateJoinCode(actor, data.courseId);
  });

export const listAnnouncementsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ courseId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listAnnouncements(actor, data.courseId);
  });

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        courseId: z.string().uuid(),
        body: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_BODY),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createAnnouncement(actor, data.courseId, { body: data.body });
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ announcementId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteAnnouncement(actor, data.announcementId);
    return { ok: true };
  });

export const addCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        announcementId: z.string().uuid(),
        body: z.string().trim().min(1).max(MAX_COMMENT_BODY),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return addComment(actor, data.announcementId, { body: data.body });
  });

export const deleteCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ commentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteComment(actor, data.commentId);
    return { ok: true };
  });

export const gradeSubmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        submissionId: z.string().uuid(),
        grade: z.number().int().min(0).max(1000),
        feedback: z.string().max(5000).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return gradeSubmission(actor, data.submissionId, {
      grade: data.grade,
      feedback: data.feedback,
    });
  });
