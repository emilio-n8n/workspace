import type { Action, GrantRole } from "./types.ts";

/**
 * Matrice niveaux : un rôle satisfait une action si son niveau est suffisant.
 * viewer → lecture ; commenter → commentaires ; editor → écriture ;
 * owner → partage/suppression/gestion.
 */
export const ROLE_LEVEL: Record<GrantRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export const ACTION_LEVEL: Record<Action, number> = {
  read: 1,
  comment: 2,
  write: 3,
  share: 4,
  delete: 4,
  manage: 4,
};

export function roleSatisfies(role: GrantRole | null | undefined, action: Action): boolean {
  if (!role) return false;
  return ROLE_LEVEL[role] >= ACTION_LEVEL[action];
}

/** Rôle le plus élevé entre deux rôles éventuellement nuls. */
export function highestRole(
  a: GrantRole | null | undefined,
  b: GrantRole | null | undefined,
): GrantRole | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return ROLE_LEVEL[a] >= ROLE_LEVEL[b] ? a : b;
}
