import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Drive — voir docs/modules/drive.md.
 * Règles communes : org_id partout, ids uuid v7, dates avec fuseau.
 */

export const driveEntryKind = pgEnum("drive_entry_kind", ["folder", "file"]);
export const driveEntryStatus = pgEnum("drive_entry_status", ["active", "trashed"]);

export const driveFiles = pgTable(
  "drive_files",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    kind: driveEntryKind("kind").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageKey: text("storage_key"),
    checksum: text("checksum"),
    status: driveEntryStatus("status").notNull().default("active"),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("drive_files_org_parent_idx").on(table.orgId, table.parentId, table.status),
    index("drive_files_owner_idx").on(table.ownerId),
    // Unicité des noms actifs par (organisation, dossier) — la racine compte comme un dossier.
    uniqueIndex("drive_files_name_uidx")
      .on(table.orgId, sql`coalesce((${table.parentId})::text, 'root')`, table.name)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const driveFileVersions = pgTable(
  "drive_file_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("drive_versions_file_version_uidx").on(table.fileId, table.version)],
);

export const driveShareLinks = pgTable(
  "drive_share_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    role: core.grantRole("role").notNull(),
    /** Empreinte SHA-256 du jeton ; le jeton en clair n'est montré qu'à la création. */
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("drive_share_links_hash_uidx").on(table.tokenHash),
    index("drive_share_links_file_idx").on(table.fileId),
  ],
);

export type DriveEntry = typeof driveFiles.$inferSelect;
export type DriveVersion = typeof driveFileVersions.$inferSelect;
export type DriveShareLink = typeof driveShareLinks.$inferSelect;
