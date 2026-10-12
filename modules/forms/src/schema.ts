import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Forms — voir docs/modules/forms.md.
 * Un formulaire est un fichier Drive lié (nom, arborescence, permissions) ;
 * les questions et les réponses vivent ici. La collecte publique passe par le
 * slug (lien partageable), sans session — c'est l'ouverture du formulaire
 * (statut `open`) qui l'autorise.
 */

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("forms_file_uidx").on(table.fileId),
    uniqueIndex("forms_slug_uidx").on(table.slug),
    // listForms : filtre par org + tri updated_at décroissant.
    index("forms_org_updated_idx").on(table.orgId, table.updatedAt.desc()),
  ],
);

export const formQuestions = pgTable(
  "form_questions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").$type<string[]>().notNull().default([]),
  },
  (table) => [index("form_questions_form_idx").on(table.formId)],
);

export const formResponses = pgTable(
  "form_responses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<Record<string, string | string[]>>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Liste paginée des réponses : filtre par form + tri submitted_at décroissant.
    index("form_responses_form_submitted_idx").on(table.formId, table.submittedAt.desc()),
  ],
);

export type FormRow = typeof forms.$inferSelect;
export type FormQuestionRow = typeof formQuestions.$inferSelect;
export type FormResponseRow = typeof formResponses.$inferSelect;
