import { PolicyError } from "./errors.ts";
import { can } from "./policy.ts";
import type { Actor, Resource } from "./types.ts";

/**
 * Variations utiles autour de `can` :
 * jette une PolicyError `forbidden` si l'accès est refusé.
 */
export async function assertCan(
  actor: Actor,
  action: Parameters<typeof can>[1],
  resource: Resource,
): Promise<void> {
  const allowed = await can(actor, action, resource);
  if (!allowed) throw PolicyError.forbidden();
}
