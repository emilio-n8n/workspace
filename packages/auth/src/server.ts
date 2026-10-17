import { randomUUID } from "node:crypto";
import { getDb, schema } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { type AccountKind, parseAccountKind } from "./account-kind.ts";
import { auth } from "./auth.ts";

/** Session utilisateur courante à partir des en-têtes de requête. */
export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

/** Organisations dont l'utilisateur est membre. */
export async function listMyOrganizations(headers: Headers) {
  return auth.api.listOrganizations({ headers });
}

/**
 * Contexte serveur obligatoire : session **et** organisation.
 * L'organisation active est une préférence, pas un prérequis : si elle est
 * absente (nouvelle session après reconnexion), la première organisation de
 * l'utilisateur est sélectionnée **et persistée** sur la ligne `session`
 * (`activeOrganizationId`) via `auth.api.setActiveOrganization`, afin que les
 * requêtes suivantes suivent le chemin direct et restent déterministes.
 * La persistance n'est jamais ignorée en silence : si elle échoue, l'erreur
 * remonte à l'appelant plutôt que de retourner une organisation non mémorisée.
 */
export async function requireActorContext(
  headers: Headers,
): Promise<{ userId: string; orgId: string }> {
  const session = await getSession(headers);
  if (!session) throw new UnauthorizedError();

  let orgId = session.session.activeOrganizationId;
  if (!orgId) {
    const organizations = await listMyOrganizations(headers);
    const first = organizations[0];
    if (!first) throw new NoOrganizationError();
    orgId = first.id;
    // setActiveOrganization écrit `session.activeOrganizationId` en base
    // (internalAdapter.updateSession) et vérifie l'appartenance. Pas de
    // `.catch(() => undefined)` : un contexte non persisté serait recalculé à
    // chaque requête (et masquerait une panne de base).
    await auth.api.setActiveOrganization({ headers, body: { organizationId: orgId } });
  }

  return { userId: session.user.id, orgId };
}

/**
 * Acteur serveur prêt pour la couche de permissions : session obligatoire,
 * organisation résolue (préférence ou première organisation).
 * Refus par défaut si aucune session.
 */
export async function requireActor(headers: Headers): Promise<{ actor: Actor; userId: string }> {
  const context = await requireActorContext(headers);
  return {
    actor: { userId: context.userId, orgId: context.orgId },
    userId: context.userId,
  };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentification requise.");
    this.name = "UnauthorizedError";
  }
}

export class NoOrganizationError extends Error {
  constructor() {
    super("Aucune organisation active pour ce compte.");
    this.name = "NoOrganizationError";
  }
}

const ORG_NAME: Record<AccountKind, string> = {
  personal: "Espace personnel",
  business: "Mon organisation",
  education: "Mon établissement",
};

function orgSlugPrefix(kind: AccountKind): string {
  if (kind === "business") return "org";
  if (kind === "education") return "etab";
  return "perso";
}

/**
 * Garantit que l'utilisateur possède au moins une organisation
 * (espace créé à l'inscription, du type choisi). Retourne l'organisation active.
 */
export async function ensurePersonalOrganization(
  headers: Headers,
  kind: AccountKind = "personal",
): Promise<{ organizationId: string; created: boolean; kind: AccountKind }> {
  const session = await getSession(headers);
  if (!session) throw new UnauthorizedError();

  const existing = await listMyOrganizations(headers);
  if (existing.length > 0) {
    const activeId = session.session.activeOrganizationId;
    const active = existing.find((org) => org.id === activeId) ?? existing[0];
    if (!active) throw new NoOrganizationError();
    if (activeId !== active.id) {
      await auth.api.setActiveOrganization({
        headers,
        body: { organizationId: active.id },
      });
    }
    return { organizationId: active.id, created: false, kind: "personal" };
  }

  const slug = `${orgSlugPrefix(kind)}-${randomUUID().slice(0, 8)}`;
  const created = await auth.api.createOrganization({
    headers,
    body: {
      name: ORG_NAME[kind],
      slug,
      metadata: { kind },
    },
  });

  await auth.api.setActiveOrganization({ headers, body: { organizationId: created.id } });
  return { organizationId: created.id, created: true, kind };
}

export type { Auth } from "./auth.ts";
export { auth };

/** Contexte d'espace partagé par les 14 applications (rail, sélecteur). */
export type ActiveWorkspace = {
  user: { id: string; name: string; email: string };
  organizations: { id: string; name: string }[];
  activeOrganization: { id: string; name: string; slug: string; kind?: AccountKind } | null;
};

/** Type de compte d'une organisation (méta), indéfini pour les anciens espaces. */
export async function getOrganizationKind(orgId: string): Promise<AccountKind | undefined> {
  const [row] = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  return parseAccountKind(row?.metadata);
}

/**
 * Espace courant de l'utilisateur : organisations, organisation active et son
 * type de compte (qui filtre le rail d'applications dans toutes les apps).
 */
export async function getActiveWorkspace(headers: Headers): Promise<ActiveWorkspace | null> {
  const session = await getSession(headers);
  if (!session) return null;

  const orgs = await listMyOrganizations(headers);
  const activeId = session.session.activeOrganizationId ?? orgs[0]?.id ?? null;
  const active = orgs.find((org) => org.id === activeId) ?? null;
  const kind = active ? await getOrganizationKind(active.id) : undefined;

  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    organizations: orgs.map((org) => ({ id: org.id, name: org.name })),
    activeOrganization: active
      ? { id: active.id, name: active.name, slug: active.slug, kind }
      : null,
  };
}
