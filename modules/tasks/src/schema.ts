import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Tasks — voir docs/modules/tasks.md.
 * Une liste est une ressource partageable (`resource_grants`, type `task_list`).
 * Les étiquettes, elles, sont propres à l'organisation et rattachées aux tâches.
 */

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);
/**
 * Palette d'étiquettes. Chaque couleur est associée à UN token sémantique du
 * design system (jamais une valeur en dur) — voir `LABEL_COLOR_DOT_CLASS`
 * dans `src/ui/task-visuals.tsx`.
 */
export const taskLabelColor = pgEnum("task_label_color", [
  "green",
  "blue",
  "amber",
  "violet",
  "red",
  "slate",
]);

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
    // Ordre d'affichage dans le panneau des listes (0 = en tête). L'ordre est
    // propre à l'organisation : une liste partagée garde la même place pour
    // tout le monde. `id` (uuidv7, ordonné dans le temps) départage deux
    // positions identiques qu'une création concurrente peut produire.
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("task_lists_org_idx").on(table.orgId),
    index("task_lists_owner_idx").on(table.ownerId),
    index("task_lists_org_position_idx").on(table.orgId, table.position),
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
    // Pas de colonne `position` (contrairement à l'audit) : l'écran d'une liste
    // trie par échéance croissante — adaptation sur due_at.
    index("tasks_list_due_idx").on(table.listId, table.dueAt),
    index("tasks_assignee_idx").on(table.assigneeId),
    index("tasks_due_idx").on(table.dueAt),
  ],
);

/**
 * Étiquettes d'organisation (« urgent », « client », « perso »). Elles portent
 * une couleur choisie dans la palette `task_label_color` et sont partagées par
 * toutes les listes de l'organisation : une seule nomenclature, pas deux.
 */
export const taskLabels = pgTable(
  "task_labels",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: taskLabelColor("color").notNull().default("blue"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("task_labels_org_idx").on(table.orgId),
    // Une étiquette ne peut pas exister en doublon dans une organisation :
    // la liste de choix resterait ambiguë.
    unique("task_labels_org_name_unique").on(table.orgId, table.name),
  ],
);

/** Liaison tâche ↔ étiquette (plusieurs étiquettes par tâche, une tâche par ligne). */
export const taskLabelLinks = pgTable(
  "task_label_links",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => taskLabels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    // Retrouver les tâches d'une étiquette sans balayer la table de liaison.
    index("task_label_links_label_idx").on(table.labelId),
  ],
);

export type TaskList = typeof taskLists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskPriority = (typeof taskPriority.enumValues)[number];
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type TaskLabelColor = (typeof taskLabelColor.enumValues)[number];
export type TaskLabel = typeof taskLabels.$inferSelect;
