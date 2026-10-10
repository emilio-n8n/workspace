import { requireActorContext } from "@workspace/auth";
import type { Actor } from "@workspace/permissions";

/**
 * Construit l'acteur serveur (session + organisation active ou première
 * organisation de l'utilisateur) — refus par défaut si aucune session.
 */
export async function requireActor(headers: Headers): Promise<{ actor: Actor; userId: string }> {
  const context = await requireActorContext(headers);
  return {
    actor: { userId: context.userId, orgId: context.orgId },
    userId: context.userId,
  };
}
