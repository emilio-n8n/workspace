import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Slides — voir docs/modules/slides.md.
 * Une présentation est un fichier Drive lié ; les diapositives et leurs
 * éléments (texte, forme, image) vivent ici. Les positions sont des
 * pourcentages de la diapositive (0-100), le corps de texte est en pixels
 * base 960. Les images stockent leur binaire dans le stockage objet
 * (`media_key`, préfixe `slides/<presentationId>/`) et gardent `text` vide.
 */

export const presentations = pgTable(
  "presentations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    /** Compteur optimiste : incrémenté à chaque sauvegarde acceptée. */
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("presentations_file_uidx").on(table.fileId),
    index("presentations_org_idx").on(table.orgId),
  ],
);

export const presentationSlides = pgTable(
  "presentation_slides",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => presentations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title"),
    notes: text("notes"),
  },
  (table) => [index("presentation_slides_presentation_idx").on(table.presentationId)],
);

export const slideElements = pgTable(
  "slide_elements",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    slideId: uuid("slide_id")
      .notNull()
      .references(() => presentationSlides.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull(),
    text: text("text").notNull().default(""),
    /** Clé de stockage du binaire pour kind "image" ; null sinon. */
    mediaKey: text("media_key"),
    fontSize: integer("font_size").notNull().default(24),
    bold: boolean("bold").notNull().default(false),
    align: text("align").notNull().default("left"),
  },
  (table) => [index("slide_elements_slide_idx").on(table.slideId)],
);

export type PresentationRow = typeof presentations.$inferSelect;
export type PresentationSlideRow = typeof presentationSlides.$inferSelect;
export type SlideElementRow = typeof slideElements.$inferSelect;
