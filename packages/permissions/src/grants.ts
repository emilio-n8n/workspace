import { getDb, schema } from "@workspace/database";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { highestRole, roleSatisfies } from "./roles.ts";
import type { Action, Actor, GrantRole, GrantSubject, Resource, ResourceType } from "./types.ts";

const { resourceGrants, team, teamMember } = schema;

export type ResourceGrantRow = typeof resourceGrants.$inferSelect;

/**
 * Groupes (équipes) de l'acteur dans son organisation active.
 * Les identités (équipes) sont des données partagées : lues ici en lecture
 * seule, jamais modifiées par la couche d'autorisation.
 */
async function loadGroupIds(actor: Actor): Promise<Set<string>> {
  if (actor.groupIds) return new Set(actor.groupIds);

  const db = getDb();
  const rows = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .innerJoin(team, eq(teamMember.teamId, team.id))
    .where(and(eq(teamMember.userId, actor.userId), eq(team.organizationId, actor.orgId)));

  return new Set(rows.map((row) => row.teamId));
}

/**
 * Rôle effectif maximum d'un acteur sur une ressource.
 * `null` (ou une organisation différente) = aucun droit — refus par défaut.
 */
export async function resolveRole(actor: Actor, resource: Resource): Promise<GrantRole | null> {
  if (resource.orgId !== actor.orgId) return null;

  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      subjectType: resourceGrants.subjectType,
      subjectId: resourceGrants.subjectId,
      role: resourceGrants.role,
    })
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.resourceType, resource.type),
        eq(resourceGrants.resourceId, resource.id),
        eq(resourceGrants.orgId, resource.orgId),
        or(isNull(resourceGrants.expiresAt), gt(resourceGrants.expiresAt, now)),
      ),
    );

  if (rows.length === 0) return null;

  const groups = await loadGroupIds(actor);
  let best: GrantRole | null = null;

  for (const row of rows) {
    const applies =
      (row.subjectType === "org" && row.subjectId === actor.orgId) ||
      (row.subjectType === "user" && row.subjectId === actor.userId) ||
      (row.subjectType === "group" && groups.has(row.subjectId));
    if (applies) best = highestRole(best, row.role);
  }

  return best;
}

/**
 * Identifiants accessibles parmi `ids` pour une action donnée.
 * Utilisé pour filtrer les listes sans N+1 de vérifications.
 */
export async function accessibleResourceIds(
  actor: Actor,
  action: Action,
  resourceType: ResourceType,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      resourceId: resourceGrants.resourceId,
      subjectType: resourceGrants.subjectType,
      subjectId: resourceGrants.subjectId,
      role: resourceGrants.role,
    })
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.resourceType, resourceType),
        eq(resourceGrants.orgId, actor.orgId),
        inArray(resourceGrants.resourceId, [...ids]),
        or(isNull(resourceGrants.expiresAt), gt(resourceGrants.expiresAt, now)),
      ),
    );

  if (rows.length === 0) return new Set();

  const groups = await loadGroupIds(actor);
  const allowed = new Set<string>();

  for (const row of rows) {
    const applies =
      (row.subjectType === "org" && row.subjectId === actor.orgId) ||
      (row.subjectType === "user" && row.subjectId === actor.userId) ||
      (row.subjectType === "group" && groups.has(row.subjectId));
    if (applies && roleSatisfies(row.role, action)) allowed.add(row.resourceId);
  }

  return allowed;
}

/** Crée un grant. L'unicité évite les doublons (aucune exception en cas de doublon). */
export async function createGrant(input: {
  resource: Resource;
  subject: GrantSubject;
  role: GrantRole;
  actor: Actor;
  expiresAt?: Date;
}): Promise<ResourceGrantRow | null> {
  const db = getDb();
  const [row] = await db
    .insert(resourceGrants)
    .values({
      orgId: input.resource.orgId,
      resourceType: input.resource.type,
      resourceId: input.resource.id,
      subjectType: input.subject.kind,
      subjectId: input.subject.id,
      role: input.role,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.actor.userId,
    })
    .onConflictDoNothing()
    .returning();

  return row ?? null;
}

/** Révoque un grant par son identifiant (retourne false s'il n'existait pas). */
export async function revokeGrant(grantId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(resourceGrants)
    .where(eq(resourceGrants.id, grantId))
    .returning({ id: resourceGrants.id });

  return result.length > 0;
}

/** Liste les grants actifs d'une ressource (affichage « qui a accès »). */
export async function listGrants(resource: Resource): Promise<ResourceGrantRow[]> {
  const db = getDb();
  return db
    .select()
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.resourceType, resource.type),
        eq(resourceGrants.resourceId, resource.id),
        eq(resourceGrants.orgId, resource.orgId),
      ),
    )
    .orderBy(sql`${resourceGrants.createdAt} asc`);
}

/**
 * Ressources d'un type données à l'acteur par des grants (sans la propriété).
 * Utilisé pour « Partagés avec moi » et les vues d'agrégation.
 */
export async function listGrantedResourceIds(
  actor: Actor,
  resourceType: ResourceType,
): Promise<Map<string, GrantRole>> {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      resourceId: resourceGrants.resourceId,
      subjectType: resourceGrants.subjectType,
      subjectId: resourceGrants.subjectId,
      role: resourceGrants.role,
    })
    .from(resourceGrants)
    .where(
      and(
        eq(resourceGrants.resourceType, resourceType),
        eq(resourceGrants.orgId, actor.orgId),
        or(isNull(resourceGrants.expiresAt), gt(resourceGrants.expiresAt, now)),
      ),
    );

  if (rows.length === 0) return new Map();

  const groups = await loadGroupIds(actor);
  const granted = new Map<string, GrantRole>();

  for (const row of rows) {
    const applies =
      (row.subjectType === "org" && row.subjectId === actor.orgId) ||
      (row.subjectType === "user" && row.subjectId === actor.userId) ||
      (row.subjectType === "group" && groups.has(row.subjectId));
    if (applies) {
      granted.set(row.resourceId, highestRole(granted.get(row.resourceId), row.role) ?? "viewer");
    }
  }

  return granted;
}
