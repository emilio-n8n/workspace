# Contrat — Fondations (packages communs)

- **Statut** : en développement (Phase 1)
- **Propriétaire** : lead
- **Contenu** : `packages/config`, `packages/database`, `packages/auth`, `packages/permissions`, `packages/storage`, `packages/ui`, `packages/design-tokens`, `packages/test-utils`

## Objectif

Fournir à tous les modules un socle unique, testé et gelé : configuration validée, base de données + migrations, sessions et comptes, autorisation, stockage des binaires, composants UI et tokens. Les modules ne modifient pas ces packages ; toute évolution passe par le lead.

## Périmètre

- **MVP (Phase 1)** : tout ce qui précède, plus le shell de navigation de `apps/web`.
- **Hors périmètre** : fonctionnalités produit (elle vivent dans les modules), intégrations externes (mail, Meet), API publique.

## Interfaces publiques (esquisse)

```ts
// packages/config
export const env: Env; // validé au démarrage, échec rapide si incomplet

// packages/database
export const db: Database; // connexion Drizzle
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;

// packages/auth
export async function getSession(req: Request): Promise<Session | null>;
export function requireActor(req: Request): Promise<Actor>; // jette si non authentifié

// packages/permissions
export type Actor = { userId: string; orgId: string; scopes?: string[] };
export function can(actor: Actor, action: Action, resource: ResourceRef): Promise<boolean>;
export function assertCan(actor: Actor, action: Action, resource: ResourceRef): Promise<void>; // jette forbidden

// packages/storage
export const storage: StorageAdapter; // LocalFS | S3, selon l'environnement

// packages/ui
// composants React : Button, Input, Dialog, Menu, Table, … (tokens uniquement)
```

## Données

Le schéma cœur (users/sessions/orgs/members/invites/groups/resource_grants/audit_events/api_tokens) — voir `docs/architecture/data-model.md`. Migrations gérées par drizzle-kit, appliquées sur base vierge **et** sur base existante.

## Critères d'acceptation (vérifiables)

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verts à la racine.
- [ ] Migrations appliquées sur base vierge PostgreSQL 18 + seed de développement minimal.
- [ ] Inscription → connexion → déconnexion ; **révocation de session vérifiée** (l'appel suivant est refusé).
- [ ] Création d'organisation, invitation (acceptée/expirée), rôles owner/admin/member actifs côté serveur.
- [ ] `can()` testé : autorisé / refusé sans grant / refusé autre organisation ; expiration respectée.
- [ ] Storage : aller-retour upload/lecture/suppression sur LocalFS + S3 (MinIO si disponible, sinon test d'intégration conditionnel).
- [ ] Échec rapide au démarrage si variable d'environnement manquante.
- [ ] Shell web vérifié dans un navigateur réel (navigation, chargement, erreur 404, responsive de base).

## Risques et questions ouvertes

- better-auth : figer la version et surveiller les migrations de schéma proposées.
- Limitation de débit : implémentation simple mono-nœud au départ (documentée).
- `packages/ui` : périmètre volontairement minimal (boutons, champs, dialogues, menus, tableau) — pas de « bibliothèque de composants » spéculative.
