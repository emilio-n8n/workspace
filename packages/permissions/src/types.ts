/**
 * Types d'autorisation partagés par tous les modules, l'application web et
 * le serveur MCP (voir ADR-0004 et docs/security/).
 *
 * Principe : le refus par défaut. Aucun accès explicite ⇒ aucun droit.
 */

/** Acteur authentifié agissant sur une ressource. */
export type Actor = {
  /** Utilisateur (id better-auth). */
  userId: string;
  /** Organisation active (isolation : une action ne franchit jamais l'org). */
  orgId: string;
  /** Groupes (équipes) connus de l'acteur dans l'organisation. */
  groupIds?: readonly string[];
  /** Scopes d'un jeton d'API / MCP (ex. `drive:read`). */
  scopes?: readonly string[];
  /** Jeton d'API à l'origine de l'action (journalisation). */
  apiTokenId?: string;
};

export const GRANT_ROLES = ["viewer", "commenter", "editor", "owner"] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

/**
 * Types de ressources autorisés dans `resource_grants`. Extensible par
 * migration (énumération PostgreSQL `grant_resource_type`).
 */
export const RESOURCE_TYPES = [
  "file",
  "document",
  "sheet",
  "presentation",
  "calendar_event",
  "calendar",
  "mail_message",
  "form",
  "chat_channel",
  "task_list",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACTIONS = ["read", "comment", "write", "share", "delete", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

/** Référence à une ressource protégée. */
export type Resource = {
  type: ResourceType;
  id: string;
  orgId: string;
};

/** Sujet d'un grant : utilisateur, groupe (équipe) ou organisation entière. */
export type GrantSubject =
  | { kind: "user"; id: string }
  | { kind: "group"; id: string }
  | { kind: "org"; id: string };
