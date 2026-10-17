import { recordAudit } from "@workspace/audit";
import { allowsManagedAccounts, parseAccountKind } from "@workspace/auth/account-kind";
import { classroomAssignments, classroomCourses, classroomSubmissions } from "@workspace/classroom";
import { schema as core, getDb, sortFr } from "@workspace/database";
import { docsComments, docsDocuments } from "@workspace/docs";
import { driveFiles } from "@workspace/drive";
import type { Actor } from "@workspace/permissions";
import { tasks } from "@workspace/tasks";
import { and, asc, desc, eq, gt, gte, ilike, lte, ne, or, type SQL, sql } from "drizzle-orm";

export type AdminErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  constructor(code: AdminErrorCode, message: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
  }
}

export type MemberFull = {
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

export type ActiveSession = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

export type OrgOverview = {
  org: { id: string; name: string; slug: string };
  /** Acteur courant — permet à l'écran de masquer les actions sur soi-même. */
  actorUserId: string;
  memberCount: number;
  fileCount: number;
  usedBytes: number;
  quotaBytes: number | null;
  auditCount: number;
  /** Comptes gérés autorisés (faux sur un espace personnel). */
  managedAccountsAllowed: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: string;
  actorUserId: string | null;
  actorTokenId: string | null;
  createdAt: string;
  /** Valeurs JSON sérialisables (contrainte des server functions TanStack). */
  metadata: Record<string, string | number | boolean | null> | null;
};

/** Requête du journal d'audit : filtres et pagination, tous optionnels. */
export type AuditListQuery = {
  /** Préfixe d'action insensible à la casse (ex. `docs.document`). */
  action?: string;
  /** Identifiant de l'acteur utilisateur (`audit_events.actor_user_id`). */
  actorId?: string;
  /** Début de plage inclus — `AAAA-MM-JJ` (début du jour, UTC) ou instant ISO. */
  from?: string;
  /** Fin de plage incluse — `AAAA-MM-JJ` (fin du jour, UTC) ou instant ISO. */
  to?: string;
  /** Page demandée (≥ 1, défaut 1). */
  page?: number;
  /** Taille de page bornée à 10..100 (défaut 50). */
  pageSize?: number;
};

/** Page du journal d'audit : lignes de la page et total des lignes filtrées. */
export type AuditPage = {
  rows: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

const db = () => getDb();

/** Réservé aux rôles `owner` et `admin` de l'organisation. */
async function requireAdmin(actor: Actor): Promise<{ role: string }> {
  const [row] = await db()
    .select({ role: core.member.role })
    .from(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, actor.userId)))
    .limit(1);
  if (!row) {
    throw new AdminError("not_found", "Organisation introuvable.");
  }
  if (row.role !== "owner" && row.role !== "admin") {
    throw new AdminError("forbidden", "Action réservée aux administrateurs.");
  }
  return row;
}

async function requireMember(actor: Actor, userId: string) {
  const [row] = await db()
    .select({ role: core.member.role, id: core.member.id })
    .from(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, userId)))
    .limit(1);
  if (!row) throw new AdminError("not_found", "Ce membre n'appartient pas à l'organisation.");
  return row;
}

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

export async function listMembers(actor: Actor): Promise<MemberFull[]> {
  await requireAdmin(actor);
  const rows = await db()
    .select({
      userId: core.user.id,
      name: core.user.name,
      email: core.user.email,
      role: core.member.role,
      createdAt: core.member.createdAt,
    })
    .from(core.member)
    .innerJoin(core.user, eq(core.user.id, core.member.userId))
    .where(eq(core.member.organizationId, actor.orgId))
    .orderBy(asc(core.user.name));
  return sortFr(rows, (row) => row.name).map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Ajoute un compte existant (les invitations par e-mail arriveront avec SMTP). */
export async function addMemberByEmail(actor: Actor, email: string): Promise<MemberFull> {
  await requireAdmin(actor);
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new AdminError("validation", "Adresse e-mail invalide.");
  }

  const [user] = await db()
    .select({ id: core.user.id, name: core.user.name, email: core.user.email })
    .from(core.user)
    .where(sql`lower(${core.user.email}) = ${clean}`)
    .limit(1);
  if (!user) {
    throw new AdminError(
      "not_found",
      "Aucun compte ne correspond à cette adresse — la personne doit d'abord s'inscrire.",
    );
  }

  const [existing] = await db()
    .select({ id: core.member.id })
    .from(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, user.id)))
    .limit(1);
  if (existing) {
    throw new AdminError("conflict", "Cette personne est déjà membre de l'organisation.");
  }

  // Le pré-contrôle donne un message clair ; l'index unique
  // member(org_id, user_id) est le backstop de course.
  const [created] = await db()
    .insert(core.member)
    .values({
      id: `mem_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      organizationId: actor.orgId,
      userId: user.id,
      role: "member",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: [core.member.organizationId, core.member.userId] })
    .returning({ createdAt: core.member.createdAt });

  if (!created) {
    throw new AdminError("conflict", "Cette personne est déjà membre de l'organisation.");
  }

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.member.add",
    resourceType: "member",
    resourceId: user.id,
    result: "success",
  });

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: "member",
    createdAt: (created?.createdAt ?? new Date()).toISOString(),
  };
}

export async function updateMemberRole(
  actor: Actor,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  await requireAdmin(actor);
  const target = await requireMember(actor, userId);
  const self = await requireAdmin(actor);
  if (target.role === "owner") {
    throw new AdminError("forbidden", "Le rôle du propriétaire ne peut pas être modifié.");
  }
  if (userId === actor.userId) {
    throw new AdminError("validation", "Vous ne pouvez pas modifier votre propre rôle.");
  }
  if (target.role === "admin" && self.role !== "owner") {
    throw new AdminError(
      "forbidden",
      "Seul le propriétaire peut modifier le rôle d'un administrateur.",
    );
  }
  await db()
    .update(core.member)
    .set({ role })
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, userId)));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.member.role",
    resourceType: "member",
    resourceId: userId,
    result: "success",
    metadata: { role },
  });
}

export async function removeMember(actor: Actor, userId: string): Promise<void> {
  await requireAdmin(actor);
  const target = await requireMember(actor, userId);
  const self = await requireAdmin(actor);
  if (target.role === "owner") {
    throw new AdminError("forbidden", "Le propriétaire ne peut pas être retiré.");
  }
  if (userId === actor.userId) {
    throw new AdminError("validation", "Vous ne pouvez pas vous retirer vous-même.");
  }
  if (target.role === "admin" && self.role !== "owner") {
    throw new AdminError("forbidden", "Seul le propriétaire peut retirer un administrateur.");
  }
  await db()
    .delete(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, userId)));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.member.remove",
    resourceType: "member",
    resourceId: userId,
    result: "success",
  });
}

// ---------------------------------------------------------------------------
// Sessions actives
// ---------------------------------------------------------------------------

/**
 * Sessions non expirées des membres de l'organisation (200 plus récentes).
 * La jointure sur `member` restreint strictement à l'organisation de l'acteur.
 */
export async function listActiveSessions(actor: Actor): Promise<ActiveSession[]> {
  await requireAdmin(actor);
  const rows = await db()
    .select({
      id: core.session.id,
      userId: core.session.userId,
      userName: core.user.name,
      userEmail: core.user.email,
      ipAddress: core.session.ipAddress,
      userAgent: core.session.userAgent,
      createdAt: core.session.createdAt,
      expiresAt: core.session.expiresAt,
    })
    .from(core.session)
    .innerJoin(core.user, eq(core.user.id, core.session.userId))
    .innerJoin(
      core.member,
      and(eq(core.member.userId, core.session.userId), eq(core.member.organizationId, actor.orgId)),
    )
    .where(gt(core.session.expiresAt, new Date()))
    .orderBy(desc(core.session.createdAt))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/**
 * Révoque une session d'un membre de l'organisation. La session de l'acteur
 * lui-même est refusée : sans en-têtes de requête, impossible d'identifier sa
 * session courante — la déconnexion est le bon geste.
 */
export async function revokeSession(actor: Actor, sessionId: string): Promise<void> {
  await requireAdmin(actor);
  const [row] = await db()
    .select({ id: core.session.id, userId: core.session.userId })
    .from(core.session)
    .innerJoin(
      core.member,
      and(eq(core.member.userId, core.session.userId), eq(core.member.organizationId, actor.orgId)),
    )
    .where(eq(core.session.id, sessionId))
    .limit(1);
  if (!row) throw new AdminError("not_found", "Session introuvable.");
  if (row.userId === actor.userId) {
    throw new AdminError("validation", "Utilisez « Se déconnecter » pour votre propre session.");
  }

  await db().delete(core.session).where(eq(core.session.id, sessionId));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.session.revoke",
    resourceType: "session",
    resourceId: sessionId,
    result: "success",
  });
}

/** Révoque toutes les sessions d'un membre, sauf celles de l'acteur. */
export async function revokeAllSessions(
  actor: Actor,
  userId: string,
): Promise<{ revoked: number }> {
  await requireAdmin(actor);
  await requireMember(actor, userId);
  const rows = await db()
    .delete(core.session)
    .where(and(eq(core.session.userId, userId), ne(core.session.userId, actor.userId)))
    .returning({ id: core.session.id });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.session.revoke-all",
    resourceType: "session",
    resourceId: userId,
    result: "success",
    metadata: { count: rows.length },
  });
  return { revoked: rows.length };
}

// ---------------------------------------------------------------------------
// Organisation, quotas, journal
// ---------------------------------------------------------------------------

export async function updateOrgProfile(actor: Actor, input: { name: string }): Promise<void> {
  await requireAdmin(actor);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 150) {
    throw new AdminError("validation", "Le nom doit contenir entre 1 et 150 caractères.");
  }
  await db().update(core.organization).set({ name }).where(eq(core.organization.id, actor.orgId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.org.update",
    resourceType: "organization",
    resourceId: actor.orgId,
    result: "success",
    metadata: { name },
  });
}

export async function getOverview(actor: Actor): Promise<OrgOverview> {
  await requireAdmin(actor);
  const [org] = await db()
    .select({
      id: core.organization.id,
      name: core.organization.name,
      slug: core.organization.slug,
      metadata: core.organization.metadata,
    })
    .from(core.organization)
    .where(eq(core.organization.id, actor.orgId))
    .limit(1);
  if (!org) throw new AdminError("not_found", "Organisation introuvable.");

  const [members] = await db()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(core.member)
    .where(eq(core.member.organizationId, actor.orgId));

  const [files] = await db()
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      bytes: sql<number>`coalesce(sum(${driveFiles.sizeBytes}), 0)`.mapWith(Number),
    })
    .from(driveFiles)
    .where(eq(driveFiles.orgId, actor.orgId));

  const [settings] = await db()
    .select({ quota: core.orgSettings.storageQuotaBytes })
    .from(core.orgSettings)
    .where(eq(core.orgSettings.orgId, actor.orgId))
    .limit(1);

  const [audit] = await db()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(core.auditEvents)
    .where(eq(core.auditEvents.orgId, actor.orgId));

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    actorUserId: actor.userId,
    memberCount: members?.value ?? 0,
    fileCount: files?.count ?? 0,
    usedBytes: files?.bytes ?? 0,
    quotaBytes: settings?.quota ?? null,
    auditCount: audit?.value ?? 0,
    managedAccountsAllowed: allowsManagedAccounts(parseAccountKind(org.metadata)),
  };
}

/**
 * Pré-contrôle d'un compte géré, AVANT toute création de compte : rôle
 * administrateur, espace non personnel, adresse valide et libre. Sans lui, un
 * simple membre (ou un espace personnel) pouvait créer un compte orphelin
 * avant que l'ajout à l'organisation ne soit refusé.
 */
export async function assertManagedAccountAllowed(actor: Actor, email: string): Promise<string> {
  await requireAdmin(actor);
  const [org] = await db()
    .select({ metadata: core.organization.metadata })
    .from(core.organization)
    .where(eq(core.organization.id, actor.orgId))
    .limit(1);
  if (!org) throw new AdminError("not_found", "Organisation introuvable.");
  if (!allowsManagedAccounts(parseAccountKind(org.metadata))) {
    throw new AdminError(
      "forbidden",
      "Les comptes gérés sont réservés aux espaces entreprise et éducation.",
    );
  }
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new AdminError("validation", "Adresse e-mail invalide.");
  }
  const [existing] = await db()
    .select({ id: core.user.id })
    .from(core.user)
    .where(sql`lower(${core.user.email}) = ${clean}`)
    .limit(1);
  if (existing) {
    throw new AdminError(
      "conflict",
      "Un compte existe déjà avec cette adresse — ajoutez-le plutôt comme membre.",
    );
  }
  return clean;
}

export async function updateQuota(actor: Actor, quotaBytes: number | null): Promise<void> {
  await requireAdmin(actor);
  if (quotaBytes !== null && (quotaBytes < 0 || !Number.isFinite(quotaBytes))) {
    throw new AdminError("validation", "Quota invalide.");
  }
  await db()
    .insert(core.orgSettings)
    .values({ orgId: actor.orgId, storageQuotaBytes: quotaBytes })
    .onConflictDoUpdate({
      target: core.orgSettings.orgId,
      set: { storageQuotaBytes: quotaBytes },
    });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.quota.update",
    resourceType: "org_settings",
    resourceId: actor.orgId,
    result: "success",
    metadata: { quotaBytes },
  });
}

export const AUDIT_PAGE_SIZE_MIN = 10;
export const AUDIT_PAGE_SIZE_MAX = 100;
export const AUDIT_PAGE_SIZE_DEFAULT = 50;
/** Plafond de `page` : garde l'offset loin des entiers non sûrs. */
export const AUDIT_PAGE_MAX = 10_000;

const AUDIT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AUDIT_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Vrai si `value` est une date ISO valide (`AAAA-MM-JJ` ou instant ISO). */
export function isAuditDate(value: string): boolean {
  const clean = value.trim();
  if (AUDIT_DATE_PATTERN.test(clean)) {
    return !Number.isNaN(new Date(`${clean}T00:00:00.000Z`).getTime());
  }
  return AUDIT_INSTANT_PATTERN.test(clean) && !Number.isNaN(new Date(clean).getTime());
}

/** Borne `pageSize` à 10..100 (défaut 50). */
export function clampAuditPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return AUDIT_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), AUDIT_PAGE_SIZE_MIN), AUDIT_PAGE_SIZE_MAX);
}

/** Borne `page` à ≥ 1 (défaut 1). */
export function clampAuditPage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), AUDIT_PAGE_MAX);
}

/** Convertit `from`/`to` en instants ; une date seule couvre le jour entier (UTC). */
function parseAuditBoundary(value: string, bound: "start" | "end"): Date {
  const clean = value.trim();
  if (!isAuditDate(clean)) {
    throw new AdminError("validation", `Date invalide « ${value} » — format attendu AAAA-MM-JJ.`);
  }
  const dayOnly = AUDIT_DATE_PATTERN.test(clean);
  const date = new Date(dayOnly ? `${clean}T00:00:00.000Z` : clean);
  if (bound === "end" && dayOnly) date.setUTCHours(23, 59, 59, 999);
  return date;
}

/** Échappe les caractères spéciaux LIKE (%, _) d'un préfixe littéral. */
function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

type NormalizedAuditQuery = {
  action: string | null;
  actorId: string | null;
  from: Date | null;
  to: Date | null;
  page: number;
  pageSize: number;
};

/**
 * Applique les règles du journal : trim des filtres, validation des dates
 * (`from` ≤ `to`, jour inclusif en UTC) et bornage de la pagination.
 */
function normalizeAuditQuery(query: AuditListQuery = {}): NormalizedAuditQuery {
  const action = query.action?.trim() ?? "";
  const actorId = query.actorId?.trim() ?? "";
  const from = query.from ? parseAuditBoundary(query.from, "start") : null;
  const to = query.to ? parseAuditBoundary(query.to, "end") : null;
  if (from && to && from.getTime() > to.getTime()) {
    throw new AdminError("validation", "La date de début doit précéder la date de fin.");
  }
  return {
    action: action.length > 0 ? action : null,
    actorId: actorId.length > 0 ? actorId : null,
    from,
    to,
    page: clampAuditPage(query.page),
    pageSize: clampAuditPageSize(query.pageSize),
  };
}

/** Projection publique d'une ligne `audit_events`. */
function toAuditEntry(row: typeof core.auditEvents.$inferSelect): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    result: row.result,
    actorUserId: row.actorUserId,
    actorTokenId: row.actorTokenId,
    createdAt: row.createdAt.toISOString(),
    metadata: row.metadata as Record<string, string | number | boolean | null> | null,
  };
}

/**
 * Journal d'audit de l'organisation.
 *
 * - `listAudit(actor, limit)` — appel historique : les N dernières lignes.
 * - `listAudit(actor, query)` — page filtrée `{ rows, total, page, pageSize }` :
 *   `action` est un préfixe insensible à la casse, `from`/`to` des dates ISO
 *   inclusives (jour entier en UTC), `pageSize` borné à 10..100, tri
 *   `createdAt DESC` stabilisé par `id DESC`.
 */
export async function listAudit(actor: Actor, limit?: number): Promise<AuditEntry[]>;
export async function listAudit(actor: Actor, query: AuditListQuery): Promise<AuditPage>;
export async function listAudit(
  actor: Actor,
  limitOrQuery?: number | AuditListQuery,
): Promise<AuditEntry[] | AuditPage> {
  await requireAdmin(actor);

  // Compatibilité : l'appel numérique historique reste « les N dernières lignes ».
  if (limitOrQuery === undefined || typeof limitOrQuery === "number") {
    const limit = Math.min(Math.max(limitOrQuery ?? 100, 1), 200);
    const rows = await db()
      .select()
      .from(core.auditEvents)
      .where(eq(core.auditEvents.orgId, actor.orgId))
      .orderBy(desc(core.auditEvents.createdAt), desc(core.auditEvents.id))
      .limit(limit);
    return rows.map(toAuditEntry);
  }

  const query = normalizeAuditQuery(limitOrQuery);
  const filters: SQL[] = [eq(core.auditEvents.orgId, actor.orgId)];
  if (query.action) {
    filters.push(ilike(core.auditEvents.action, `${escapeLikePrefix(query.action)}%`));
  }
  if (query.actorId) {
    filters.push(eq(core.auditEvents.actorUserId, query.actorId));
  }
  if (query.from) filters.push(gte(core.auditEvents.createdAt, query.from));
  if (query.to) filters.push(lte(core.auditEvents.createdAt, query.to));
  const where = and(...filters);

  const [counted, rows] = await Promise.all([
    db()
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(core.auditEvents)
      .where(where),
    db()
      .select()
      .from(core.auditEvents)
      .where(where)
      .orderBy(desc(core.auditEvents.createdAt), desc(core.auditEvents.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
  ]);

  return {
    rows: rows.map(toAuditEntry),
    total: counted[0]?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// ---------------------------------------------------------------------------
// Politiques (partage externe, rétention des versions)
// ---------------------------------------------------------------------------

export const POLICY_RETENTION_MIN_DAYS = 7;
export const POLICY_RETENTION_MAX_DAYS = 3650;
/** Même défaut que les modules `drive` et `docs` quand aucune ligne n'existe. */
const DEFAULT_VERSION_RETENTION_DAYS = 90;

export type OrgPolicies = {
  allowExternalSharing: boolean;
  versionRetentionDays: number;
  storageQuotaBytes: number | null;
};

/** Politiques effectives de l'organisation — valeurs par défaut si aucune ligne. */
export async function getPolicies(actor: Actor): Promise<OrgPolicies> {
  await requireAdmin(actor);
  const [row] = await db()
    .select({
      allowExternalSharing: core.orgSettings.allowExternalSharing,
      versionRetentionDays: core.orgSettings.versionRetentionDays,
      storageQuotaBytes: core.orgSettings.storageQuotaBytes,
    })
    .from(core.orgSettings)
    .where(eq(core.orgSettings.orgId, actor.orgId))
    .limit(1);
  return {
    allowExternalSharing: row?.allowExternalSharing ?? true,
    versionRetentionDays: row?.versionRetentionDays ?? DEFAULT_VERSION_RETENTION_DAYS,
    storageQuotaBytes: row?.storageQuotaBytes ?? null,
  };
}

/**
 * Met à jour les politiques par patch : les clés absentes ne sont pas touchées
 * (le quota de stockage en particulier). Crée la ligne de réglages au besoin.
 */
export async function updatePolicies(
  actor: Actor,
  input: { allowExternalSharing?: boolean; versionRetentionDays?: number },
): Promise<void> {
  await requireAdmin(actor);
  const patch: { allowExternalSharing?: boolean; versionRetentionDays?: number } = {};
  if (input.allowExternalSharing !== undefined) {
    patch.allowExternalSharing = input.allowExternalSharing;
  }
  if (input.versionRetentionDays !== undefined) {
    if (
      !Number.isInteger(input.versionRetentionDays) ||
      input.versionRetentionDays < POLICY_RETENTION_MIN_DAYS ||
      input.versionRetentionDays > POLICY_RETENTION_MAX_DAYS
    ) {
      throw new AdminError(
        "validation",
        `La rétention des versions doit être un entier entre ${POLICY_RETENTION_MIN_DAYS} et ${POLICY_RETENTION_MAX_DAYS} jours.`,
      );
    }
    patch.versionRetentionDays = input.versionRetentionDays;
  }
  if (patch.allowExternalSharing === undefined && patch.versionRetentionDays === undefined) {
    throw new AdminError("validation", "Aucune politique à mettre à jour.");
  }

  await db()
    .insert(core.orgSettings)
    .values({ orgId: actor.orgId, ...patch })
    .onConflictDoUpdate({
      target: core.orgSettings.orgId,
      set: patch,
    });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.policies.update",
    resourceType: "org_settings",
    resourceId: actor.orgId,
    result: "success",
    metadata: patch,
  });
}

// ---------------------------------------------------------------------------
// Centre de conformité (RGPD)
// ---------------------------------------------------------------------------

/** Nom affiché une fois le compte pseudonymisé. */
const ERASED_USER_NAME = "Compte effacé";
/** Mot à recopier pour confirmer un effacement de compte. */
const ERASE_CONFIRMATION = "EFFACER";

/**
 * Contenu de l'export RGPD d'un membre. Les secrets d'authentification
 * (hachés de jetons d'API, jetons de session) n'y figurent jamais : seules
 * des métadonnées identifiantes et du contenu utile sont exportés.
 */
export type UserDataExportBundle = {
  exportedAt: string;
  user: { id: string; name: string; email: string; createdAt: string };
  memberships: Array<{ organizationId: string; role: string; createdAt: string }>;
  sessions: Array<{ createdAt: string; ipAddress: string | null; userAgent: string | null }>;
  apiTokens: Array<{
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }>;
  auditEvents: Array<{ action: string; result: string; createdAt: string }>;
  driveFiles: Array<{
    name: string;
    sizeBytes: number | null;
    createdAt: string;
    trashed: boolean;
  }>;
  documents: Array<{ title: string; updatedAt: string }>;
  counts: { comments: number; tasksAssigned: number; submissions: number };
};

/**
 * Export RGPD des données d'un membre de l'organisation (lecture seule,
 * requêtes directes sur les schémas cœur et modules). Le périmètre est
 * l'organisation active de l'acteur : appartenances, jetons d'API, fichiers,
 * documents et comptages sont filtrés sur `actor.orgId`. Les sessions, elles,
 * n'ont pas de colonne d'organisation — elles suivent l'utilisateur — et le
 * journal d'audit est limité aux 100 derniers événements dont la personne est
 * l'acteur ou la ressource.
 *
 * Les hachés de jetons (`token_hash`) et les jetons de session ne sont JAMAIS
 * exportés ; seuls nom, préfixe, portées et dates le sont.
 */
export async function exportUserData(
  actor: Actor,
  userId: string,
): Promise<{ filename: string; json: string }> {
  await requireAdmin(actor);
  await requireMember(actor, userId);
  const db = getDb();

  const [target] = await db
    .select({
      id: core.user.id,
      name: core.user.name,
      email: core.user.email,
      createdAt: core.user.createdAt,
    })
    .from(core.user)
    .where(eq(core.user.id, userId))
    .limit(1);
  if (!target) throw new AdminError("not_found", "Compte introuvable.");

  const [memberships, sessions, tokens, events, files, documents, comments, assigned, submissions] =
    await Promise.all([
      db
        .select({
          organizationId: core.member.organizationId,
          role: core.member.role,
          createdAt: core.member.createdAt,
        })
        .from(core.member)
        .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, userId))),
      db
        .select({
          createdAt: core.session.createdAt,
          ipAddress: core.session.ipAddress,
          userAgent: core.session.userAgent,
        })
        .from(core.session)
        .where(eq(core.session.userId, userId))
        .orderBy(desc(core.session.createdAt)),
      db
        .select({
          name: core.apiTokens.name,
          prefix: core.apiTokens.prefix,
          scopes: core.apiTokens.scopes,
          createdAt: core.apiTokens.createdAt,
          lastUsedAt: core.apiTokens.lastUsedAt,
          revokedAt: core.apiTokens.revokedAt,
        })
        .from(core.apiTokens)
        .where(and(eq(core.apiTokens.orgId, actor.orgId), eq(core.apiTokens.userId, userId))),
      db
        .select({
          action: core.auditEvents.action,
          result: core.auditEvents.result,
          createdAt: core.auditEvents.createdAt,
        })
        .from(core.auditEvents)
        .where(
          and(
            eq(core.auditEvents.orgId, actor.orgId),
            or(eq(core.auditEvents.actorUserId, userId), eq(core.auditEvents.resourceId, userId)),
          ),
        )
        .orderBy(desc(core.auditEvents.createdAt))
        .limit(100),
      db
        .select({
          name: driveFiles.name,
          sizeBytes: driveFiles.sizeBytes,
          createdAt: driveFiles.createdAt,
          status: driveFiles.status,
        })
        .from(driveFiles)
        .where(and(eq(driveFiles.orgId, actor.orgId), eq(driveFiles.ownerId, userId))),
      db
        .select({ title: docsDocuments.title, updatedAt: docsDocuments.updatedAt })
        .from(docsDocuments)
        .where(and(eq(docsDocuments.orgId, actor.orgId), eq(docsDocuments.createdBy, userId))),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(docsComments)
        .innerJoin(docsDocuments, eq(docsDocuments.id, docsComments.documentId))
        .where(and(eq(docsDocuments.orgId, actor.orgId), eq(docsComments.authorId, userId))),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(tasks)
        .where(and(eq(tasks.orgId, actor.orgId), eq(tasks.assigneeId, userId))),
      db
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(classroomSubmissions)
        .innerJoin(
          classroomAssignments,
          eq(classroomAssignments.id, classroomSubmissions.assignmentId),
        )
        .innerJoin(classroomCourses, eq(classroomCourses.id, classroomAssignments.courseId))
        .where(
          and(eq(classroomCourses.orgId, actor.orgId), eq(classroomSubmissions.studentId, userId)),
        ),
    ]);

  const bundle: UserDataExportBundle = {
    exportedAt: new Date().toISOString(),
    user: { ...target, createdAt: target.createdAt.toISOString() },
    memberships: memberships.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    sessions: sessions.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    apiTokens: tokens.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    auditEvents: events.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    driveFiles: files.map((row) => ({
      name: row.name,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      trashed: row.status === "trashed",
    })),
    documents: documents.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    counts: {
      comments: comments[0]?.value ?? 0,
      tasksAssigned: assigned[0]?.value ?? 0,
      submissions: submissions[0]?.value ?? 0,
    },
  };

  const filename = `donnees-${target.email}-${bundle.exportedAt.slice(0, 10)}.json`;
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.compliance.export",
    resourceType: "user",
    resourceId: userId,
    result: "success",
    metadata: { targetUserId: userId },
  });
  return { filename, json: JSON.stringify(bundle, null, 2) };
}

/**
 * Efface le compte d'un membre par **pseudonymisation**, pas par suppression :
 * la ligne utilisateur garde son identifiant — les contenus restent donc
 * attachés à son auteur — mais le nom affiché, l'adresse et la vérification
 * e-mail sont remplacés. Les identifiants de connexion (sessions, jetons
 * d'API) sont, eux, supprimés définitivement : ce sont des secrets.
 *
 * Ce choix de pseudonymisation plutôt que d'une cascade préserve la propriété
 * des contenus par l'organisation : fichiers, documents, commentaires, tâches
 * et copies restent en place, seule l'identité de la personne disparaît.
 *
 * Mêmes protections que le retrait de membre : ni le propriétaire, ni soi-même,
 * ni (pour un simple administrateur) un autre administrateur.
 */
export async function eraseUserAccount(
  actor: Actor,
  userId: string,
  input: { confirm: string },
): Promise<{ ok: true }> {
  const self = await requireAdmin(actor);
  if (input.confirm !== ERASE_CONFIRMATION) {
    throw new AdminError(
      "validation",
      `Confirmation requise : tapez « ${ERASE_CONFIRMATION} » pour effacer le compte.`,
    );
  }
  const target = await requireMember(actor, userId);
  if (target.role === "owner") {
    throw new AdminError("forbidden", "Le propriétaire ne peut pas être effacé.");
  }
  if (userId === actor.userId) {
    throw new AdminError("validation", "Vous ne pouvez pas effacer votre propre compte.");
  }
  if (target.role === "admin" && self.role !== "owner") {
    throw new AdminError("forbidden", "Seul le propriétaire peut effacer un administrateur.");
  }

  const db = getDb();
  await db
    .update(core.user)
    .set({
      name: ERASED_USER_NAME,
      email: `efface-${crypto.randomUUID()}@invalid.local`,
      emailVerified: false,
    })
    .where(eq(core.user.id, userId));
  await db.delete(core.session).where(eq(core.session.userId, userId));
  await db.delete(core.apiTokens).where(eq(core.apiTokens.userId, userId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "admin.compliance.erase",
    resourceType: "user",
    resourceId: userId,
    result: "success",
    metadata: { targetUserId: userId },
  });
  return { ok: true };
}
