import { recordAudit } from "@workspace/audit";
import { schema as core, getDb } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import type { Actor } from "@workspace/permissions";
import { and, asc, desc, eq, sql } from "drizzle-orm";

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

export type OrgOverview = {
  org: { id: string; name: string; slug: string };
  memberCount: number;
  fileCount: number;
  usedBytes: number;
  quotaBytes: number | null;
  auditCount: number;
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
  return rows.map((row) => ({
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
    org,
    memberCount: members?.value ?? 0,
    fileCount: files?.count ?? 0,
    usedBytes: files?.bytes ?? 0,
    quotaBytes: settings?.quota ?? null,
    auditCount: audit?.value ?? 0,
  };
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

export async function listAudit(actor: Actor, limit = 100): Promise<AuditEntry[]> {
  await requireAdmin(actor);
  const rows = await db()
    .select()
    .from(core.auditEvents)
    .where(eq(core.auditEvents.orgId, actor.orgId))
    .orderBy(desc(core.auditEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    result: row.result,
    actorUserId: row.actorUserId,
    actorTokenId: row.actorTokenId,
    createdAt: row.createdAt.toISOString(),
    metadata: row.metadata as Record<string, string | number | boolean | null> | null,
  }));
}
