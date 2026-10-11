import { randomUUID } from "node:crypto";
import type { Actor } from "@workspace/permissions";
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
 * l'utilisateur est sélectionnée et mémorisée.
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
    await auth.api
      .setActiveOrganization({ headers, body: { organizationId: orgId } })
      .catch(() => undefined);
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

/**
 * Garantit que l'utilisateur possède au moins une organisation
 * (espace personnel créé à l'inscription). Retourne l'organisation active.
 */
export async function ensurePersonalOrganization(
  headers: Headers,
): Promise<{ organizationId: string; created: boolean }> {
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
    return { organizationId: active.id, created: false };
  }

  const slug = `perso-${randomUUID().slice(0, 8)}`;
  const created = await auth.api.createOrganization({
    headers,
    body: {
      name: "Espace personnel",
      slug,
      metadata: { kind: "personal" },
    },
  });

  await auth.api.setActiveOrganization({ headers, body: { organizationId: created.id } });
  return { organizationId: created.id, created: true };
}

export type { Auth } from "./auth.ts";
export { auth };
