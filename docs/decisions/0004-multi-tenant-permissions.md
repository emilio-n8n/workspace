# ADR-0004 — Multi-tenant et modèle de permissions

**Statut** : accepté
**Date** : 2026-10-10

## Contexte

Toute la suite doit partager un seul modèle d'autorisation : organisations, groupes, rôles, partages par ressource, liens de partage, jetons d'API. Les modules sont développés en parallèle ; sans contrat unique, chacun inventerait son propre contrôle d'accès — c'est précisément ce que le projet veut éviter. La sécurité doit être vérifiable par des tests, pas par la discipline.

## Décision

**Organisations**
- Toute ressource appartient à une organisation (`org_id`) ; l'espace personnel est une organisation de type `personal`.
- Rôles d'organisation : `owner` > `admin` > `member`. Ils donnent des capacités **administratives et globales** (gérer membres, politique de partage, quotas) — jamais un accès implicite en lecture aux ressources privées d'un autre membre.

**Autorisation par ressource**
- Table unique transverse `resource_grants(resource_type, resource_id, subject_type, subject_id, role, expires_at)` avec :
  - `resource_type` : énumération contrôlée (`file`, `document`, `sheet`, `calendar`, …), extensible par migration ;
  - `subject_type` : `user` | `group` | `org` ;
  - `role` : `viewer` < `commenter` < `editor` < `owner`.
- **Refus par défaut** : sans grant (ou droit hérité d'un parent : dossier → fichier), l'accès est refusé.
- Les modules interprètent les grants via `packages/permissions` (`can(actor, action, resource)`) : un seul endroit où le droit est calculé et testé.
- Les **liens de partage** sont des capacités propres aux modules : jeton aléatoire stocké **haché**, rôle accordé, expiration optionnelle, révocable, journalisé — ils ne créent pas de grant utilisateur.

**Jetons d'API / MCP**
- Jetons révocables, scopés (`drive:read`, `docs:write`, …), liés à (utilisateur, organisation), stockés hachés ; le jeton ne peut jamais excéder les droits de son propriétaire au moment de l'appel.

**Défense en profondeur**
- Les contrôles ci-dessus sont la barrière **primaire**, appliquée côté serveur.
- PostgreSQL RLS pourra être ajouté plus tard comme barrière secondaire sur les tables les plus sensibles ; il ne remplacera jamais les contrôles applicatifs.

## Conséquences

- Positif : un seul vocabulaire de permissions pour tous les modules et le MCP ; tests négatifs systématiques ; isolation multi-organisations démontrable.
- Négatif : `resource_grants` est une table transverse — elle doit rester strictement typée et interprétée par module (pas de « table fourre-tout ») ; les performances des résolutions de droits demandent index et cache (invalidation par événement).
- Tests obligatoires pour chaque module : accès autorisé, accès refusé (aucun grant), accès refusé (autre organisation), expiration respectée, révocation effective.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Un système ACL par module | Duplication, divergences garanties entre modules |
| Moteur ReBAC externe (OpenFGA, SpiceDB) | Infrastructure supplémentaire à opérer pour un besoin couvrable par grants SQL ; réévaluable si les cas d'usage se complexifient (hiérarchies profondes, héritages croisés) |
| RLS PostgreSQL comme barrière unique | Contourne la logique applicative, difficile à tester finement ; conservé comme option de défense en profondeur |
| Permissions dans le client | Inacceptable (l'UI n'est pas une frontière de sécurité) |
