/**
 * Scopes des jetons d'API / MCP (ADR-0006).
 * Sans dépendance : ce module est importable côté serveur ET côté client.
 */
export const WORKSPACE_SCOPES = [
  "drive:read",
  "drive:write",
  "docs:read",
  "docs:write",
  "audit:read",
] as const;

export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];

export function isWorkspaceScope(value: string): value is WorkspaceScope {
  return (WORKSPACE_SCOPES as readonly string[]).includes(value);
}
