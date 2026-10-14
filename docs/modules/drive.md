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
- **Actions groupées** : `moveEntries` (cible validée, échecs isolés par élément, audit `drive.entry.move`), `trashEntries`, `listMoveTargets` (dossiers accessibles en écriture, descendance des exclus écartée)
- Partage : `shareEntry`, `unshareEntry`, `listEntryGrants`, `listShareLinks`, `createShareLink`, `revokeShareLink`, `accessShareLink`
- **Server functions web** : `modules/drive/src/server.ts` (liste, fil d'Ariane, détails, corbeille, mutations, actions groupées, partage)
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
- **Navigation** : fil d'Ariane cliquable, chemins longs repliés en menu « … », menu des sous-dossiers du dossier courant.
- **Affichage** : tri (nom, date, taille) et densité persistés localement (`workspace.drive.view`), en-têtes de colonne triables avec `aria-sort`.
- **Sélection multiple** : clic, Ctrl/⌘ + clic, Maj + clic (plage), Ctrl/⌘ + A, Échap ; barre d'actions (télécharger, déplacer, supprimer) avec comptes rendus par toast.
- **Clavier** : le tableau porte le rôle ARIA `grid` ; flèches, Début/Fin, Page haut/bas déplacent le curseur de ligne, Entrée (ou flèche droite) ouvre, flèche gauche remonte au dossier parent, Espace sélectionne, Suppr met à la corbeille derrière confirmation. Position annoncée en `aria-live`.
- **Création de dossier inline** : formulaire en tête de liste, validation immédiate en français (nom obligatoire, 255 caractères, séparateurs et contrôles refusés), Entrée crée, Échap annule.
- **Zone de dépôt** : état actif au survol pendant un glisser-déposer, dossier de destination nommé, envoi séquentiel avec état et message d'erreur par fichier et relance individuelle.
- La logique de présentation (tri, repli du fil, sémantique de sélection, navigation clavier, validation du nom, file d'envoi) vit dans des modules purs sous `src/ui/`, testés sans DOM.

## Outils MCP

| Outil | Scopes | Statut |
|---|---|---|
| `files.search` | `drive:read` | ✅ livré (tests d'intégration) |
| `files.read` (texte/JSON/Markdown, tronqué) | `drive:read` | ✅ livré |
| `files.write` / `files.delete` | `drive:write` | Phase 3 (confirmation requise) |

## Tests et critères d'acceptation

- Service : 11 tests (cycle complet, conflits, limite de taille, partage/révocation, héritage, isolation inter-orgs, corbeille/purge, versions, liens).
- **Actions groupées** : déplacement (lot, racine, dédoublonnage, refus de descendance, conflit de nom isolé, élément introuvable, corbeille, permission), cibles proposées, corbeille groupée (17 tests d'intégration).
- **Interface** : tri et persistance des préférences (22), repli et libellés du fil d'Ariane (15), sémantique de la sélection et fichiers téléchargeables (18), navigation clavier de la liste (19), validation du nom d'élément (10), file de téléversement (20).
- E2E navigateur : dossier → upload → navigation → corbeille → restauration ; partage entre deux membres → accès réel → révocation effective.
- MCP : recherche/lecture autorisées ; refus sans scope ; isolation inter-organisations.

## Risques et questions ouvertes

- Pagination des dossiers volumineux (MVP : dossiers de taille raisonnable, ordre serveur).
- Aperçu de gros fichiers (streaming et limites mémoire) ; quotas à brancher dans `uploadFile`.
- Politique de rétention des versions (réglage d'organisation, défaut raisonnable à définir).

## Ajouts des vagues S/T
- **MCP `files.write` / `files.delete`** : création de fichiers texte (mime allowlist, ≤ 2 Mo, quota appliqué) et suppression — corbeille par défaut, suppression définitive réservée au propriétaire d'un élément **déjà en corbeille**, confirmation littérale « SUPPRIMER » exigée côté agent.
- **Visionneuse intégrée** : images, PDF (iframe) et texte (≤ 200 Ko en flux) s'ouvrent en dialogue avec `?inline=1` (cache privé 5 min, `content-disposition: inline`).
- **Rétention des versions** (90 j par défaut, réglable Admin) et **partage externe** configurables et réellement appliqués.
