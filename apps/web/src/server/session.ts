import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { ensurePersonalOrganization, getSession, listMyOrganizations } from "@workspace/auth";

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

/** Crée l'espace personnel si nécessaire (appelé après l'inscription). */
export const provisionWorkspaceFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const result = await ensurePersonalOrganization(request.headers);
  return { organizationId: result.organizationId };
});
