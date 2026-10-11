import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  createAssignment,
  createCourse,
  deleteAssignment,
  getCourse,
  gradeSubmission,
  joinByCode,
  listCourses,
  listSubmissions,
  submitAssignment,
} from "./index.ts";

export type {
  AssignmentView,
  CourseDetail,
  CourseSummary,
  MemberView,
  TeacherSubmissionView,
} from "./index.ts";

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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return submitAssignment(actor, data.assignmentId, data.content);
  });

export const listSubmissionsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ assignmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listSubmissions(actor, data.assignmentId);
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
