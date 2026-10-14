# Contrat — Tasks

- **Statut** : cœur serveur + interface + MCP vérifiés (8 tests service, parcours E2E navigateur)
- **Propriétaire** : lead
- **Package** : `modules/tasks` (`@workspace/tasks`)
- **Dépendances autorisées** : `packages/database`, `packages/permissions`, `packages/api`, `packages/ui`

## Objectif

Les tâches et listes de la suite : personnelles ou partagées, avec échéances, priorités, statuts et assignations. Intégration prévue avec Calendar (échéances → événements), Mail et Chat dans les phases suivantes.

## Périmètre

- **Livré** : listes (créer, renommer, supprimer par le propriétaire), tâches (créer, éditer, terminer/réouvrir, supprimer), priorités (basse/moyenne/haute), statuts (à faire / en cours / terminée), échéances (avec repérage des retards), assignation aux membres de l'organisation, filtres (Toutes / À faire / En cours / Terminées / En retard), ajout rapide, partage d'une liste par membre avec rôles (lecture / commentaire / édition), révocation immédiate.
- **Hors périmètre à ce stade** : récurrence, sous-tâches, rappels/notifications, pièces jointes, commentaires, vues « ma journée »/agenda (viendront avec Calendar et Notifications).
- **Évolutions** : vues sauvegardées, intégration Calendar (événement lié), rappels par e-mail, MCP `tasks.update` (avec confirmation pour suppression).

## Interfaces publiques

- `listLists`, `createList`, `renameList`, `deleteList`, `shareList`, `unshareList`, `listListGrants`, `effectiveListRole`
- `listTasks` (ordre : non terminées d'abord, échéances croissantes), `createTask`, `updateTask` (statut `done` ⇒ `completedAt`), `deleteTask`
- **Server functions web** : `apps/web/src/server/tasks.ts` ; **outils MCP** : `tasks.lists`, `tasks.list`, `tasks.create` (scopes `tasks:read` / `tasks:write`).

## Données

- Tables : `task_lists` (org, propriétaire, nom), `tasks` (org, liste, titre, notes, statut, priorité, échéance, assigné, `completedAt`).
- Partage via la table cœur `resource_grants` (`resource_type = 'task_list'`) — héritage par grants standards (utilisateur/groupe/organisation).

## Permissions

- Actions : `read`, `write` (créer/éditer/terminer), `share`, `delete` (propriétaire — supprime la liste et ses tâches en cascade).
- Isolation inter-organisations testée : `not_found` hors de l'organisation ; `forbidden` pour un membre sans grant.

## UI

- Route : `/app/tasks` — colonne des listes, panneau de la liste (filtres, ajout rapide, lignes avec case à cocher, priorité, échéance, assignation), dialogues (nouvelle liste, renommage, édition de tâche, partage).

## Outils MCP

| Outil | Scopes | Statut |
|---|---|---|
| `tasks.lists` | `tasks:read` | ✅ livré |
| `tasks.list` (toutes listes ou une liste) | `tasks:read` | ✅ livré |
| `tasks.create` | `tasks:write` | ✅ livré |
| `tasks.update` / `tasks.delete` | `tasks:write` | à venir (confirmation requise pour la suppression) |

## Tests et critères d'acceptation

- Service : refus par défaut, CRUD, ordonnancement, `completedAt` au passage à `done`/réouverture, validation (titre, échéance), partage viewer/editor + révocation, suppression réservée au propriétaire, isolation inter-organisations.
- MCP : création et lecture par un agent réel (serveur stdio), refus sans scope d'écriture.
- E2E navigateur : liste → ajout rapide → terminer → filtre Terminées → édition (priorité haute).

## Risques et questions ouvertes

- Volume : pagination/archivage des listes anciennes (à traiter avec la recherche globale en Phase 3).
- Champs libres (`notes`) : rendu Markdown limité à envisager plus tard.

## Vague « gestes, filtres et sous-tâches » (14 oct. 2026)
- **Réordonnancement manuel** : glisser-déposer des lignes (poignée dédiée), repère de dépôt, annulation, flèches au clavier avec annonces vocales — logique pure testée (`dnd.ts`).
- **Filtres combinables** : critères purs (`filters.ts`) + barre de filtres (`filter-bar.tsx`), état vide qui distingue liste vide et filtre sans résultat.
- **Sous-tâches** : modèle et progression (`subtasks.ts`), éditeur dédié dans la tâche (`subtasks-editor.tsx`), compteur et barre de progression sur la ligne.
