import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Tasks — voir docs/modules/tasks.md.
 * Une liste est une ressource partageable (`resource_grants`, type `task_list`).
 */

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);

export const taskLists = pgTable(
  "task_lists",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("task_lists_org_idx").on(table.orgId),
    index("task_lists_owner_idx").on(table.ownerId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => taskLists.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id").references(() => core.user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: taskStatus("status").notNull().default("todo"),
    priority: taskPriority("priority").notNull().default("medium"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("tasks_list_status_idx").on(table.listId, table.status),
    index("tasks_assignee_idx").on(table.assigneeId),
    index("tasks_due_idx").on(table.dueAt),
  ],
);

export type TaskList = typeof taskLists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskPriority = (typeof taskPriority.enumValues)[number];
export type TaskStatus = (typeof taskStatus.enumValues)[number];
