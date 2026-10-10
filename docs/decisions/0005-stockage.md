# ADR-0005 — Abstraction de stockage des fichiers

**Statut** : accepté
**Date** : 2026-10-10

## Contexte

Drive, Docs, Sheets, Slides, Mail et Chat produisent tous des binaires (fichiers, pièces jointes, versions, exports). Une organisation doit pouvoir héberger ses données sans dépendre d'un fournisseur cloud, tout en pouvant utiliser, si elle le souhaite, un stockage objet compatible S3 (MinIO, Garage, Ceph, AWS…). Les métadonnées appartiennent à PostgreSQL ; les binaires non.

## Décision

- Interface `StorageAdapter` dans `packages/storage` :
  - `put(stream, { orgId, key, contentType })`, `get`, `getRange`, `delete`, `stat`, `listPrefix` (usage interne limité) ;
  - les clés sont **opaques** et préfixées par organisation (`orgs/<org_id>/…`) ; jamais de nom de fichier utilisateur dans la clé ;
  - les URL publiques (le cas échéant) passent par des routes d'application avec autorisation — jamais d'exposition directe du backend.
- Deux implémentations :
  - **LocalFS** (défaut auto-hébergé) : répertoire racine configurable (`STORAGE_DIR`), un fichier = un objet ;
  - **S3-compatible** : endpoint, région, bucket, credentials par variables d'environnement.
- Les métadonnées (taille, MIME, empreinte SHA-256, `storage_key`, statut) vivent en base (`files`, `file_versions`).
- Les **quotas** d'organisation sont contrôlés au moment de l'upload (compteur transactionnel en base), pas dans l'adaptateur.
- Sauvegardes : la procédure de `docs/deployment/` couvre **base + stockage** ensemble (cohérence de version).

## Conséquences

- Positif : changement de backend sans toucher aux modules ; cohérence auto-hébergement (LocalFS) puis scale-out (S3) ; tests d'intégration paramétrables sur les deux adaptateurs.
- Négatif : fonctionnalités spécifiques S3 (multipart avancé, lifecycle) gérées minimalement au départ ; LocalFS impose la curation des sauvegardes côté opérateur.
- Documents et tableurs stockeront leur **modèle de contenu** dans leur propre schéma (pour commenter, indexer, versionner finement), pas en fichier opaque — l'export est une opération générée, pas la source de vérité.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Binaires dans PostgreSQL (large objects) | Coût, sauvegardes et streaming dégradés à l'échelle |
| SDK fournisseur unique (S3 AWS directement) | Couplage fournisseur, contraire à l'objectif |
| Filesystem exclusif | Pas de scale-out ni de redondance pour les déploiements sérieux |
