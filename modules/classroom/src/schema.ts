import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Classroom — voir docs/modules/classroom.md.
 * Cours d'organisation avec code d'accès, membres (enseignant/élève),
 * devoirs et copies notées.
 */

export const classroomCourses = pgTable(
  "classroom_courses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    section: text("section"),
    joinCode: text("join_code").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("classroom_courses_code_uidx").on(table.joinCode),
    index("classroom_courses_org_idx").on(table.orgId),
  ],
);

export const classroomMembers = pgTable(
  "classroom_members",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => classroomCourses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("student"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("classroom_members_course_user_uidx").on(table.courseId, table.userId),
    index("classroom_members_user_idx").on(table.userId),
  ],
);

export const classroomAssignments = pgTable(
  "classroom_assignments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    courseId: uuid("course_id")
      .notNull()
      .references(() => classroomCourses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }),
    points: integer("points").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("classroom_assignments_course_idx").on(table.courseId)],
);

export const classroomSubmissions = pgTable(
  "classroom_submissions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => classroomAssignments.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    grade: integer("grade"),
    feedback: text("feedback"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("classroom_submissions_assignment_student_uidx").on(
      table.assignmentId,
      table.studentId,
    ),
  ],
);

export type ClassroomCourseRow = typeof classroomCourses.$inferSelect;
export type ClassroomAssignmentRow = typeof classroomAssignments.$inferSelect;
export type ClassroomSubmissionRow = typeof classroomSubmissions.$inferSelect;
