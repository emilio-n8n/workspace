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

/** Rôles d'une personne dans une salle : créateur, animateur, participant. */
export const MEET_ROLES = ["host", "moderator", "participant"] as const;
export type MeetRole = (typeof MEET_ROLES)[number];

/**
 * Présence et modération dans une salle — une ligne par personne et par salle,
 * écrite à l'émission du jeton (entrée effective) et supprimée en cascade avec
 * la salle.
 *
 * Elle porte l'état de modération (rôle, micro coupé par l'organisateur, retrait
 * de la réunion, main levée) ainsi que le repère de lecture du chat. Le média ne
 * passe pas par cette table : elle ne fait que rendre visibles des décisions que
 * les clients appliquent ensuite.
 */
export const meetMembers = pgTable(
  "meet_members",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => meetRooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    role: text("role").$type<MeetRole>().notNull().default("participant"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    /** Sortie de la salle (raccroché) — la personne peut revenir. */
    leftAt: timestamp("left_at", { withTimezone: true }),
    /** Micro coupé par l'organisateur : la personne ne peut plus le rallumer. */
    mutedAt: timestamp("muted_at", { withTimezone: true }),
    mutedBy: text("muted_by").references(() => core.user.id, { onDelete: "set null" }),
    /** Retrait de la réunion par l'organisateur — l'entrée est refusée ensuite. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: text("removed_by").references(() => core.user.id, { onDelete: "set null" }),
    /** Main levée : l'horodatage donne la position dans la file. */
    handRaisedAt: timestamp("hand_raised_at", { withTimezone: true }),
    /** Dernière lecture du chat (compte des messages non lus). */
    chatReadAt: timestamp("chat_read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("meet_members_room_user_uidx").on(table.roomId, table.userId),
    index("meet_members_room_role_idx").on(table.roomId, table.role),
    index("meet_members_room_hand_idx").on(table.roomId, table.handRaisedAt),
  ],
);

/**
 * Messages du chat de réunion — portée salle uniquement, jamais audités (le
 * volume rendrait le journal d'audit inexploitable). Supprimés en cascade avec
 * la salle.
 */
export const meetMessages = pgTable(
  "meet_messages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => meetRooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("meet_messages_room_created_idx").on(table.roomId, table.createdAt)],
);

export type MeetMemberRow = typeof meetMembers.$inferSelect;
export type MeetMessageRow = typeof meetMessages.$inferSelect;
