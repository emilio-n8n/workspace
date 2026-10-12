import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Mail — voir docs/modules/mail.md.
 * Boîtes locales par utilisateur et par organisation ; messages rangés par
 * dossier (inbox / sent / drafts / trash). L'envoi sortant passe par SMTP
 * (optionnel — sinon le message est conservé avec une erreur explicite) ;
 * l'entrant arrive par le webhook d'ingestion (MX → POST, secret partagé).
 */

export const mailMailboxes = pgTable(
  "mail_mailboxes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mail_mailboxes_address_uidx").on(table.address),
    uniqueIndex("mail_mailboxes_org_user_uidx").on(table.orgId, table.userId),
  ],
);

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id, { onDelete: "cascade" }),
    folder: text("folder").notNull().default("inbox"),
    trashedFrom: text("trashed_from"),
    /** Identifiant du message chez le relais MX — clé d'idempotence de l'ingestion. */
    externalId: text("external_id"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: jsonb("to_addresses").$type<string[]>().notNull().default([]),
    ccAddresses: jsonb("cc_addresses").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    readAt: timestamp("read_at", { withTimezone: true }),
    starred: boolean("starred").notNull().default(false),
    sendError: text("send_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Liste d'un dossier : filtre (mailbox, folder) + tri created_at décroissant.
    index("mail_messages_mailbox_folder_created_idx").on(
      table.mailboxId,
      table.folder,
      table.createdAt.desc(),
    ),
    // Compteur de non-lus / filtre « read_at is null » par boîte.
    index("mail_messages_mailbox_read_idx").on(table.mailboxId, table.readAt),
    // PostgreSQL laisse les NULL distincts : l'unicité ne s'applique qu'aux
    // messages réellement identifiés par le relais.
    uniqueIndex("mail_messages_external_id_uidx").on(table.externalId),
  ],
);

export type MailMailboxRow = typeof mailMailboxes.$inferSelect;
export type MailMessageRow = typeof mailMessages.$inferSelect;
