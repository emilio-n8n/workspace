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

/** Type de compte choisi à l'inscription : il décide des apps disponibles. */
export type AccountKind = "personal" | "business" | "education";

/** Nom de l'espace créé à l'inscription pour chaque type de compte. */
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
 * Lit le type de compte dans la méta d'organisation (texte JSON en base).
 * Indéfini si la méta est absente ou illisible : les anciens espaces gardent
 * alors la totalité de la suite (aucune app n'est retirée par défaut).
 */
export function parseAccountKind(metadata: unknown): AccountKind | undefined {
  if (typeof metadata !== "string") return undefined;
  try {
    const parsed = JSON.parse(metadata) as { kind?: unknown };
    const kind = parsed?.kind;
    if (kind === "personal" || kind === "business" || kind === "education") return kind;
  } catch {
    // Méta non-JSON : aucune décision possible, on retombe sur le défaut.
  }
  return undefined;
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
    return { organizationId: active.id, created: false };
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
