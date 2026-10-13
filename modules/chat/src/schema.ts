import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Chat — voir docs/modules/chat.md.
 * Canaux d'organisation (`kind = channel`) et discussions directes à deux
 * (`kind = dm`, nom nul). L'appartenance et le dernier message lu vivent dans
 * `chat_members` — les compteurs de non-lus en dérivent.
 *
 * Les noms de canaux peuvent être dupliqués : aucune contrainte d'unicité sur
 * `name` (deux équipes peuvent créer « #général »). L'unicité des discussions
 * directes repose sur `dm_key` = identifiants triés des deux participants.
 *
 * Un canal est `public` (n'importe quel membre de l'organisation peut le
 * rejoindre) ou `private` (sur invitation : l'ajout direct relève de la personne
 * qui l'a créé). L'archive (`archived_at`) gèle le canal : l'historique reste
 * lisible, plus rien ne peut y être envoyé ni épinglé.
 */

/** Visibilité d'un canal — les discussions directes sont privées par nature. */
export const CHANNEL_VISIBILITIES = ["public", "private"] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];

export const chatChannels = pgTable(
  "chat_channels",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("channel"),
    name: text("name"),
    /** Participants triés (`a:b`) pour les discussions directes ; nul sinon. */
    dmKey: text("dm_key"),
    /** `public` (rejoignable librement) ou `private` (sur invitation). */
    visibility: text("visibility").notNull().default("public"),
    /** Archive : lecture conservée, écritures désactivées. Nul = canal actif. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_channels_org_idx").on(table.orgId),
    // NULL autorise plusieurs canaux classiques ; l'unicité ne porte que sur les DMs.
    uniqueIndex("chat_channels_dm_key_uidx").on(table.dmKey),
  ],
);

export const chatMembers = pgTable(
  "chat_members",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("chat_members_channel_user_uidx").on(table.channelId, table.userId),
    index("chat_members_user_idx").on(table.userId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("chat_messages_channel_created_idx").on(table.channelId, table.createdAt)],
);

/**
 * Pièces jointes : métadonnées en base, binaire dans @workspace/storage
 * (clé `chat/<orgId>/<uuid>`). La suppression du message entraîne celle des
 * métadonnées ; le blob reste dans le stockage (nettoyage hors ligne).
 */
export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("chat_attachments_message_idx").on(table.messageId)],
);

export type ChatChannelRow = typeof chatChannels.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatAttachmentRow = typeof chatAttachments.$inferSelect;

/**
 * Épingles de messages : un message épinglé reste signalé dans le canal et
 * consultable dans la liste des épingles. Une seule épingle par message (index
 * unique sur `channel_id` + `message_id`) : réépingler est sans effet.
 */
export const chatPins = pgTable(
  "chat_pins",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    /** Personne qui a épinglé le message. */
    pinnedBy: text("pinned_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("chat_pins_channel_message_uidx").on(table.channelId, table.messageId),
    index("chat_pins_channel_created_idx").on(table.channelId, table.createdAt),
  ],
);

export type ChatPinRow = typeof chatPins.$inferSelect;
