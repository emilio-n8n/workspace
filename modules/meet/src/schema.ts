import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Meet — voir docs/modules/meet.md et ADR-0011.
 * Salles persistantes avec lien public interne ; le média temps réel passe
 * par un serveur LiveKit optionnel (jeton signé côté serveur, jamais le
 * secret côté client).
 */

export const meetRooms = pgTable(
  "meet_rooms",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("meet_rooms_slug_uidx").on(table.slug),
    index("meet_rooms_org_idx").on(table.orgId),
  ],
);

export type MeetRoomRow = typeof meetRooms.$inferSelect;
