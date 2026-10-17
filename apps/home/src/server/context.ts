import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  type ActiveWorkspace,
  auth,
  ensurePersonalOrganization,
  getActiveWorkspace,
  getSession,
  listMyOrganizations,
  requireActor,
} from "@workspace/auth";
import { getAppUrls } from "@workspace/config";
import { schema as coreSchema, getDb } from "@workspace/database";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@workspace/notifications";
import { searchEverything, searchResultHref } from "@workspace/search";
import { eq } from "drizzle-orm";
import { z } from "zod";

export type SessionInfo = {
  userId: string;
  email: string;
  name: string;
} | null;

export type WorkspaceInfo = ActiveWorkspace | null;

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

/**
 * Contexte de l'espace utilisateur (organisations + active, avec son type de
 * compte : il filtre le rail d'applications de la même façon dans toutes les apps).
 */
export const getWorkspaceFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceInfo> => getActiveWorkspace(getRequest().headers),
);

/** URLs publiques des applications de la suite (calculées côté serveur). */
export const getAppUrlsFn = createServerFn({ method: "GET" }).handler(async () => getAppUrls());

/**
 * Crée l'espace au type choisi à l'inscription (appelé après l'inscription).
 * Sans type (anciens appelants), l'espace reste personnel.
 */
export const provisionWorkspaceFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ kind: z.enum(["personal", "business", "education"]).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    const result = await ensurePersonalOrganization(request.headers, data.kind);
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

/** Recherche globale de la suite (le même service que l'écran /app/recherche). */
export const searchFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ query: z.string().min(2).max(100) }).parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const urls = getAppUrls();
    const results = await searchEverything(actor, { query: data.query, limit: 8 });
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      href: searchResultHref(r, urls),
    }));
  });

/** Notifications de l'utilisateur courant (compteur de non-lues + 20 dernières). */
export const listNotificationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const { actor } = await requireActor(request.headers);
  const [unreadCount, items] = await Promise.all([
    countUnreadNotifications(actor),
    listNotifications(actor, { limit: 20 }),
  ]);
  return { unreadCount, items };
});

/** Marque toutes les notifications de l'utilisateur comme lues. */
export const markAllNotificationsReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const { actor } = await requireActor(request.headers);
  await markAllNotificationsRead(actor);
  return { ok: true };
});

/** Marque une notification précise comme lue. */
export const markNotificationReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    await markNotificationRead(actor, data.id);
    return { ok: true };
  });
