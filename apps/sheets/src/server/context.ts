import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth, ensurePersonalOrganization, getSession, listMyOrganizations } from "@workspace/auth";
import { getAppUrls } from "@workspace/config";
import { schema as coreSchema, getDb } from "@workspace/database";
import { eq } from "drizzle-orm";
import { z } from "zod";

export type SessionInfo = {
  userId: string;
  email: string;
  name: string;
} | null;

export type WorkspaceInfo = {
  user: { id: string; name: string; email: string };
  organizations: { id: string; name: string }[];
  activeOrganization: { id: string; name: string; slug: string } | null;
} | null;

/** Session courante (null si non connecté). */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionInfo> => {
    const request = getRequest();
    const session = await getSession(request.headers);
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  },
);

/** Contexte de l'espace utilisateur (organisations + active). */
export const getWorkspaceFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceInfo> => {
    const request = getRequest();
    const session = await getSession(request.headers);
    if (!session) return null;

    const orgs = await listMyOrganizations(request.headers);
    const activeId = session.session.activeOrganizationId ?? orgs[0]?.id ?? null;
    const active = orgs.find((org) => org.id === activeId) ?? null;

    return {
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      organizations: orgs.map((org) => ({ id: org.id, name: org.name })),
      activeOrganization: active ? { id: active.id, name: active.name, slug: active.slug } : null,
    };
  },
);

/** URLs publiques des applications de la suite (calculées côté serveur). */
export const getAppUrlsFn = createServerFn({ method: "GET" }).handler(async () => getAppUrls());

/** Crée l'espace personnel si nécessaire (appelé après l'inscription). */
export const provisionWorkspaceFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const result = await ensurePersonalOrganization(request.headers);
  return { organizationId: result.organizationId };
});

/**
 * Bascule l'organisation active — côté serveur, après vérification que
 * l'utilisateur est bien membre. Écrit directement dans notre table `session`
 * (la préférence d'organisation est une donnée de l'application).
 */
export const switchOrgFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ organizationId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const session = await getSession(request.headers);
    if (!session) throw new Error("Authentification requise.");

    const orgs = await listMyOrganizations(request.headers);
    if (!orgs.some((org) => org.id === data.organizationId)) {
      throw new Error("Organisation inconnue ou non autorisée.");
    }

    await getDb()
      .update(coreSchema.session)
      .set({ activeOrganizationId: data.organizationId })
      .where(eq(coreSchema.session.id, session.session.id));

    return { ok: true };
  });

/** Déconnexion — côté serveur (aucune vérification d'origine inter-apps). */
export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  await auth.api.signOut({ headers: request.headers });
  return { ok: true };
});
