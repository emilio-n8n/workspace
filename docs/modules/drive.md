# Contrat — Drive

- **Statut** : spécifié (développement en Phase 2)
- **Propriétaire** : à désigner au lancement de la Phase 2
- **Package** : `modules/drive` (`@workspace/drive`)
- **Dépendances autorisées** : `packages/database`, `packages/permissions`, `packages/storage`, `packages/api`, `packages/ui`. Interface publique de `modules/docs` uniquement pour « créer un document depuis Drive ».

## Objectif

Le coffre-fort de fichiers de la suite : dossiers, uploads, aperçus, partages, versions, corbeille et quotas. Tous les autres modules y rangent leurs artefacts (pièces jointes, exports).

## Périmètre

- **MVP** : dossiers et fichiers (liste/grille), upload (multi-fichiers, drag & drop), téléchargement, aperçu (images, PDF, texte/markdown — natif navigateur), renommer/déplacer, corbeille (restaurer/purger), versions v1 (remplacement de fichier → version, restauration), partage utilisateur/groupe avec rôles, liens de partage (rôle, expiration, révocation), recherche par nom/type, quotas d'organisation (réglage simple), journal d'audit des actions sensibles.
- **Hors périmètre MVP** : édition en ligne (déléguée à Docs/Sheets/Slides), aperçu des formats bureautiques (viendra avec les convertisseurs), commentaires sur fichiers, dossiers partagés entre organisations, synchronisation desktop.
- **Évolutions** : aperçu bureautique via service de conversion, partage inter-organisations encadré par politique, verrouillage de fichiers, intelligence sur les fichiers (résumés via IA autorisée).

## Interfaces publiques (esquisse)

```ts
export type DriveService = {
  createFolder(actor, { parentId?, name }): Promise<Folder>;
  list(actor, { parentId?, sort, filter, page }): Promise<Page<Entry>>;
  search(actor, { query, type?, limit }): Promise<Entry[]>;        // utilisé aussi par le MCP
  upload(actor, { parentId?, name, stream, contentType }): Promise<File>;
  get(actor, fileId): Promise<File | null>;
  download(actor, fileId): Promise<{ stream; contentType; name }>;
  replaceContent(actor, fileId, { stream, contentType }): Promise<FileVersion>;
  rename(actor, entryId, name): Promise<void>;
  move(actor, entryId, parentId): Promise<void>;
  trash(actor, entryId): Promise<void>;
  restore(actor, entryId): Promise<void>;
  purge(actor, entryId): Promise<void>;                            // confirmation MCP requise
  listVersions(actor, fileId): Promise<FileVersion[]>;
  restoreVersion(actor, fileId, versionId): Promise<void>;
  share(actor, entryId, { subject, role, expiresAt? }): Promise<Grant>;
  unshare(actor, entryId, grantId): Promise<void>;
  createShareLink(actor, entryId, { role, expiresAt? }): Promise<{ url; token: string }>; // token montré une fois
  revokeShareLink(actor, linkId): Promise<void>;
};
```

- **Événements émis** : `file.created`, `file.trashed`, `file.share.granted`, `file.share.revoked`, `quota.exceeded` (consommés par notifications/audit).
- **Recherche** : nom, type MIME, contenu texte des fichiers texte simples (v1) ; extension aux documents bureautiques via leurs modules.

## Données

- Tables : `drive_files` (métadonnées + arborescence), `drive_file_versions`, `drive_share_links`, `drive_usage` (compteurs de quota). Les grants utilisent la table cœur `resource_grants` (`resource_type = 'file'`).
- Invariants : taille et empreinte obligatoires ; clé de stockage opaque (`orgs/<org>/<uuid>` ) ; quota vérifié en transaction avant écriture ; corbeille = statut, purge = suppression stockage + lignes versions.

## Permissions

- Actions : `read`, `write`, `manage` (grants), `owner`.
- Héritage : les grants d'un dossier s'appliquent à ses descendants (résolution par remontée ; cache ultérieur).
- Rôles d'organisation : `admin`/`owner` peuvent administrer les quotas et voir les statistiques, **pas** lire les fichiers privés des membres.
- Liens de partage : jeton haché, rôle accordé indépendant des grants, révocation immédiate, journalisation des accès (compteur).

## UI

- Routes : `/drive` (racine), `/drive/f/<id>` (dossier), aperçu latéral, `/drive/trash`, recherche dans la barre globale.
- États : vide (première utilisation), chargement (squelettes), erreur (réseau/serveur), quota dépassé, permissions insuffisantes.

## Outils MCP (v0 Phase 2)

| Outil | Scopes | Confirmation |
|---|---|---|
| `files.search` | `drive:read` | non |
| `files.read` (texte/markdown seulement) | `drive:read` | non |
| `files.write` (Phase 3) | `drive:write` | non |
| `files.delete` (Phase 3) | `drive:write` | **oui** (corbeille, réversible) |

## Tests et critères d'acceptation

- Cycle complet : créer dossier → uploader 3 fichiers (dont > limite refusé) → lister → télécharger → aperçu → corbeille → restaurer → purger.
- Partage : B (même org) reçoit `viewer` → lecture OK, écriture refusée ; promotion `editor` → écriture OK ; révocation → refus immédiat.
- Lien de partage : accès avec jeton OK selon rôle, après expiration refus, après révocation refus, jeton non devinable.
- Isolation : utilisateur d'une autre organisation refuse tout accès (UI, service, MCP) — test dédié.
- Quota : dépassement refusé proprement avec message exploitable.
- Versions : remplacement → 2 versions, restauration → contenu précédent servi.
- E2E Playwright du parcours nominal + capture navigateur réelle.

## Risques et questions ouvertes

- Aperçu de gros PDF/images : streaming et limites mémoire à valider.
- Performance des listes (pagination serveur dès le MVP, pas de chargement total).
- Politique de rétention des versions (combien, combien de temps) : réglage d'organisation, défaut raisonnable.
