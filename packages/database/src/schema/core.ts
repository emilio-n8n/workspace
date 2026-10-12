import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

/**
 * Schéma cœur de Workspace — voir docs/architecture/data-model.md.
 *
 * Règles :
 * - ids uuid v7 (natif PostgreSQL 18, trié dans le temps) sauf références aux
 *   tables better-auth (text) ;
 * - toute ressource porte un org_id (isolation multi-organisations) ;
 * - les jetons sont stockés hachés, jamais en clair.
 */

export const grantRole = pgEnum("grant_role", ["viewer", "commenter", "editor", "owner"]);
export const grantSubjectType = pgEnum("grant_subject_type", ["user", "group", "org"]);
export const grantResourceType = pgEnum("grant_resource_type", [
  "file",
  "document",
  "sheet",
  "presentation",
  "calendar_event",
  "calendar",
  "mail_message",
  "form",
  "chat_channel",
  "task_list",
]);

/** Autorisations explicites par ressource (ADR-0004 — refus par défaut). */
export const resourceGrants = pgTable(
  "resource_grants",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceType: grantResourceType("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    subjectType: grantSubjectType("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    role: grantRole("role").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("resource_grants_unique_uidx").on(
      table.resourceType,
      table.resourceId,
      table.subjectType,
      table.subjectId,
    ),
    index("resource_grants_resource_idx").on(table.resourceType, table.resourceId),
    index("resource_grants_subject_idx").on(table.subjectType, table.subjectId),
    index("resource_grants_org_idx").on(table.orgId),
  ],
);

/** Jetons d'API / MCP : liés à (utilisateur, organisation), scopés, révocables. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Préfixe visible du jeton (identification sans révéler le secret). */
    prefix: text("prefix").notNull(),
    /** Empreinte SHA-256 du jeton — le jeton en clair n'est jamais stocké. */
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_tokens_hash_uidx").on(table.tokenHash),
    index("api_tokens_user_idx").on(table.userId),
    index("api_tokens_org_idx").on(table.orgId),
  ],
);

/**
 * Notifications utilisateur : partages reçus, tâches assignées, copies notées.
 * `read_at` nul = non lue ; le libellé est porté par `kind` côté application.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_read_idx").on(table.userId, table.readAt),
    index("notifications_org_time_idx").on(table.orgId, table.createdAt),
  ],
);

/** Journal d'audit : acteur (session ou jeton), action, ressource, résultat. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorTokenId: uuid("actor_token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    result: text("result").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_org_time_idx").on(table.orgId, table.createdAt),
    index("audit_events_actor_idx").on(table.actorUserId),
  ],
);

/** Réglages de l'instance (singleton logique : une seule ligne). */
export const instanceSettings = pgTable("instance_settings", {
  id: text("id").primaryKey().default("default"),
  instanceName: text("instance_name").notNull().default("Workspace"),
  allowSignups: boolean("allow_signups").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** Réglages par organisation : partage externe, rétention, quotas. */
export const orgSettings = pgTable("org_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  allowExternalSharing: boolean("allow_external_sharing").notNull().default(true),
  versionRetentionDays: integer("version_retention_days").notNull().default(90),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type ResourceGrant = typeof resourceGrants.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InstanceSettings = typeof instanceSettings.$inferSelect;
export type OrgSettings = typeof orgSettings.$inferSelect;
