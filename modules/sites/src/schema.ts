import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Sites — voir docs/modules/sites.md.
 * Un site est un fichier Drive lié ; ses pages contiennent du Markdown rendu
 * en HTML sécurisé (échappement puis transformations contrôlées).
 */

export const sitesSites = pgTable(
  "sites_sites",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sites_sites_file_uidx").on(table.fileId),
    index("sites_sites_org_idx").on(table.orgId),
  ],
);

export const sitesPages = pgTable(
  "sites_pages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesSites.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sites_pages_site_slug_uidx").on(table.siteId, table.slug)],
);

export type SiteRow = typeof sitesSites.$inferSelect;
export type SitePageRow = typeof sitesPages.$inferSelect;
