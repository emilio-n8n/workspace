import { resolveRole } from "./grants.ts";
import { roleSatisfies } from "./roles.ts";
import type { Action, Actor, Resource } from "./types.ts";

/**
 * Décide si un acteur peut effectuer une action sur une ressource.
 *
 * - isolation inter-organisations : une ressource d'une autre organisation
 *   est toujours refusée, même avec un grant correspondant ;
 * - refus par défaut : sans grant appliqué, l'action est refusée.
 */
export async function can(actor: Actor, action: Action, resource: Resource): Promise<boolean> {
  const role = await resolveRole(actor, resource);
  return roleSatisfies(role, action);
}
