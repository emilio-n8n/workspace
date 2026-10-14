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
import { DEFAULT_SLIDE_ASPECT, type SlideAspectId } from "./slide-aspect.ts";
import type { SlidePlaceholderRole } from "./slide-layouts.ts";
import type { SlideTextColor } from "./slide-text.ts";
import { DEFAULT_SLIDE_THEME, type SlideThemeId } from "./slide-theme.ts";

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
    /** Format de la diapositive (« 16:9 » ou « 4:3 ») — conversion à la demande. */
    aspect: text("aspect").$type<SlideAspectId>().notNull().default(DEFAULT_SLIDE_ASPECT),
    /** Thème de la diapositive (« papier », « encre », « accent »). */
    theme: text("theme").$type<SlideThemeId>().notNull().default(DEFAULT_SLIDE_THEME),
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
    /** Italique du texte. */
    italic: boolean("italic").notNull().default(false),
    /** Soulignement du texte. */
    underline: boolean("underline").notNull().default(false),
    /** Couleur sémantique du texte (« default » = héritée du thème). */
    textColor: text("text_color").$type<SlideTextColor>().notNull().default("default"),
    /**
     * Rôle de zone d'une mise en page (« title », « subtitle », « body ») :
     * une zone vide affiche son invitation et participe aux mises en page.
     * Null pour un élément libre.
     */
    placeholder: text("placeholder").$type<SlidePlaceholderRole | null>(),
    align: text("align").notNull().default("left"),
  },
  (table) => [index("slide_elements_slide_idx").on(table.slideId)],
);

export type PresentationRow = typeof presentations.$inferSelect;
export type PresentationSlideRow = typeof presentationSlides.$inferSelect;
export type SlideElementRow = typeof slideElements.$inferSelect;
