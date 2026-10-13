import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    /**
     * Salle d'attente active : toute personne autre que le créateur doit être
     * admise avant de rejoindre (sécurité par défaut, désactivable par
     * l'organisateur).
     */
    requireAdmission: boolean("require_admission").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("meet_rooms_slug_uidx").on(table.slug),
    index("meet_rooms_org_idx").on(table.orgId),
  ],
);

/** États possibles d'une demande d'admission en salle d'attente. */
export const MEET_LOBBY_STATES = ["waiting", "admitted", "denied"] as const;
export type MeetLobbyState = (typeof MEET_LOBBY_STATES)[number];

/**
 * Demandes d'admission d'une salle : une ligne par personne et par salle
 * (contrainte d'unicité), supprimée en cascade avec la salle. L'approbation
 * et le refus sont horodatés et attribués à l'organisateur.
 */
export const meetLobby = pgTable(
  "meet_lobby",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => meetRooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    state: text("state").$type<MeetLobbyState>().notNull().default("waiting"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => core.user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("meet_lobby_room_user_uidx").on(table.roomId, table.userId),
    index("meet_lobby_room_state_idx").on(table.roomId, table.state),
  ],
);

export type MeetRoomRow = typeof meetRooms.$inferSelect;
export type MeetLobbyRow = typeof meetLobby.$inferSelect;
