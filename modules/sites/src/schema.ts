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
import type { SiteBlock } from "./blocks.ts";
import type { NavigationItem } from "./navigation.ts";

/**
 * Schéma du module Sites — voir docs/modules/sites.md.
 * Un site est un fichier Drive lié ; ses pages contiennent du Markdown rendu
 * en HTML sécurisé (échappement puis transformations contrôlées) ou une mise
 * en page de blocs (`blocks`, voir `blocks.ts`) éditée dans le constructeur.
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
    /**
     * Date de publication (TASK-005). `null` = brouillon ; renseignée = site
     * en ligne. Republier remet la date à jour.
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Auteur de la dernière publication ; `null` après une dépublication. */
    publishedBy: text("published_by").references(() => core.user.id, { onDelete: "set null" }),
    /**
     * Personnalisation du menu de navigation (TASK-006) : libellés et
     * visibilité par page. `null` = menu dérivé des pages (toutes visibles,
     * libellé = titre). L'ordre, lui, suit toujours celui des pages.
     */
    navigation: jsonb("navigation").$type<NavigationItem[]>(),
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
    /**
     * Mise en page de blocs (constructeur de pages). `null` = page Markdown,
     * dans ce cas `content` fait foi ; un tableau (éventuellement vide) =
     * page construite en blocs, `content` est alors ignoré au rendu.
     */
    blocks: jsonb("blocks").$type<SiteBlock[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("sites_pages_site_slug_uidx").on(table.siteId, table.slug),
    // Rendu / navigation : pages d'un site triées par position.
    index("sites_pages_site_position_idx").on(table.siteId, table.position),
  ],
);

export type SiteRow = typeof sitesSites.$inferSelect;
export type SitePageRow = typeof sitesPages.$inferSelect;
