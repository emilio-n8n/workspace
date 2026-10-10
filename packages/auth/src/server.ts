import { randomUUID } from "node:crypto";
import { auth } from "./auth.ts";

/** Session utilisateur courante à partir des en-têtes de requête. */
export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

/** Organisations dont l'utilisateur est membre. */
export async function listMyOrganizations(headers: Headers) {
  return auth.api.listOrganizations({ headers });
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
