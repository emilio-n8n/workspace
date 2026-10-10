import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import {
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
 * Schéma du module Docs — voir docs/modules/docs.md.
 * Le contenu (JSON ProseMirror) vit dans `docs_versions` ; le fichier Drive
 * associé est un pointeur (aucun binaire) qui porte le nom, l'arborescence
 * et les permissions.
 */

export const docsDocuments = pgTable(
  "docs_documents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("docs_documents_file_uidx").on(table.fileId),
    index("docs_documents_org_idx").on(table.orgId),
  ],
);

export const docsVersions = pgTable(
  "docs_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    documentId: uuid("document_id")
      .notNull()
      .references(() => docsDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("docs_versions_document_version_uidx").on(table.documentId, table.version),
  ],
);

export type DocsDocument = typeof docsDocuments.$inferSelect;
export type DocsVersion = typeof docsVersions.$inferSelect;
