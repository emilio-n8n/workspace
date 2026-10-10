# Contrat — Drive

- **Statut** : cœur serveur + interface vérifiés (11 tests service, parcours E2E navigateur) ; aperçu et quotas à venir
- **Propriétaire** : lead
- **Package** : `modules/drive` (`@workspace/drive`)
- **Dépendances autorisées** : `packages/database`, `packages/permissions`, `packages/storage`, `packages/api`, `packages/ui`

## Objectif

Le coffre-fort de fichiers de la suite : dossiers, uploads, aperçus, partages, versions, corbeille et quotas. Tous les autres modules y rangent leurs artefacts (pièces jointes, exports).

## Périmètre

- **MVP livré** : dossiers et fichiers (liste), upload multi-fichiers (bouton + glisser-déposer), téléchargement (route authentifiée), renommer, corbeille (restaurer/purger avec nettoyage réel du stockage), versions (listing + versions à l'échange de contenu), partage utilisateur (rôles viewer/commenter/editor) avec héritage dossier → enfants, liens de partage publics (jeton haché, révocation, expiration, compteur d'usage), recherche par nom (service, utilisée par le MCP).
- **En cours** : aperçu de fichiers dans l'app (images/PDF), quotas d'organisation (politique + UI), grille/affichage dense.
- **Hors périmètre à ce stade** : édition en ligne (déléguée à Docs/Sheets/Slides), aperçu des formats bureautiques (viendra avec les convertisseurs), commentaires sur fichiers, partage inter-organisations, synchronisation desktop.

## Interfaces publiques

- `createFolder`, `listEntries`, `getEntry`, `listTrash`, `searchEntries`, `uploadFile`, `createLinkedFile` (pointeurs inter-modules), `touchEntry`, `download`, `replaceContent`, `rename`, `trash`, `restore`, `purge`, `listVersions`, `getAncestors`, `effectiveRole`
- Partage : `shareEntry`, `unshareEntry`, `listEntryGrants`, `listShareLinks`, `createShareLink`, `revokeShareLink`, `accessShareLink`
- **Server functions web** : `apps/web/src/server/drive.ts` (liste, fil d'Ariane, détails, corbeille, mutations, partage)
- **Routes binaires** : `/api/drive/upload` (multipart), `/api/drive/download/$fileId` (session), `/api/drive/shared/$token` (lien public)

## Données

- Tables : `drive_files`, `drive_file_versions`, `drive_share_links` ; grants via la table cœur `resource_grants` (`resource_type = 'file'`).
- Invariants : clé de stockage opaque (`orgs/<org>/<uuid>/<nom-assaini>`) ; unicité des noms actifs par (organisation, dossier, nom) ; purge = suppression du stockage **puis** des lignes.

## Permissions

- Actions : `read`, `write`, `share`, `delete` (owner) — héritage par remontée de dossier (profondeur 32).
- Le propriétaire du fichier est toujours owner ; les liens de partage ne créent pas de grant.
- Rôles d'organisation : jamais d'accès implicite en lecture aux fichiers privés des membres.

## UI

- Routes : `/app/drive` (racine), `/app/drive/$entryId` (dossier), `/app/drive/trash` (corbeille) ; page publique `/s/$token`.
- États : vide, chargement, erreur, glisser-déposer, dialogues (dossier, document, renommage, partage, détails/versions).

## Outils MCP

| Outil | Scopes | Statut |
|---|---|---|
| `files.search` | `drive:read` | ✅ livré (tests d'intégration) |
| `files.read` (texte/JSON/Markdown, tronqué) | `drive:read` | ✅ livré |
| `files.write` / `files.delete` | `drive:write` | Phase 3 (confirmation requise) |

## Tests et critères d'acceptation

- Service : 11 tests (cycle complet, conflits, limite de taille, partage/révocation, héritage, isolation inter-orgs, corbeille/purge, versions, liens).
- E2E navigateur : dossier → upload → navigation → corbeille → restauration ; partage entre deux membres → accès réel → révocation effective.
- MCP : recherche/lecture autorisées ; refus sans scope ; isolation inter-organisations.

## Risques et questions ouvertes

- Pagination des dossiers volumineux (MVP : dossiers de taille raisonnable, ordre serveur).
- Aperçu de gros fichiers (streaming et limites mémoire) ; quotas à brancher dans `uploadFile`.
- Politique de rétention des versions (réglage d'organisation, défaut raisonnable à définir).
