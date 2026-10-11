import { getDb, schema as coreSchema } from "@workspace/database";
import { and, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  getSession,
  issueApiToken,
  listApiTokens,
  revokeApiToken,
  WORKSPACE_SCOPES,
  type WorkspaceScope,
} from "@workspace/auth";
import { z } from "zod";

export type TokenView = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** Session + organisation active obligatoires (refus par défaut). */
async function requireSession(headers: Headers): Promise<{ userId: string; orgId: string }> {
  const session = await getSession(headers);
  if (!session) throw new Error("Authentification requise.");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("Aucune organisation active.");
  return { userId: session.user.id, orgId };
}

export const listTokensFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<TokenView[]> => {
    const request = getRequest();
    const { userId, orgId } = await requireSession(request.headers);
    const tokens = await listApiTokens(userId, orgId);
    return tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: token.scopes,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null,
    }));
  },
);

const createTokenInput = z.object({
  name: z.string().trim().min(2, "Le nom doit contenir au moins 2 caractères.").max(64),
  scopes: z.array(z.enum(WORKSPACE_SCOPES)).min(1, "Sélectionnez au moins un scope."),
});

export const createTokenFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createTokenInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { userId, orgId } = await requireSession(request.headers);

    // Garde-fou : le scope d'audit est réservé aux administrateurs de
    // l'organisation (cohérent avec l'écran Admin).
    if (data.scopes.includes("audit:read")) {
      const db = getDb();
      const [row] = await db
        .select({ role: coreSchema.member.role })
        .from(coreSchema.member)
        .where(
          and(eq(coreSchema.member.organizationId, orgId), eq(coreSchema.member.userId, userId)),
        )
        .limit(1);
      if (!row || (row.role !== "owner" && row.role !== "admin")) {
        throw new Error("Le scope audit:read est réservé aux administrateurs de l'organisation.");
      }
    }

    const issued = await issueApiToken({
      userId,
      orgId,
      name: data.name,
      scopes: data.scopes as WorkspaceScope[],
    });
    return { id: issued.id, token: issued.token, prefix: issued.prefix };
  });

const revokeTokenInput = z.object({ id: z.string().uuid() });

export const revokeTokenFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => revokeTokenInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { userId } = await requireSession(request.headers);
    const revoked = await revokeApiToken(userId, data.id);
    return { revoked };
  });
