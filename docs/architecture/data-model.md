# Architecture — modèle de données (cœur)

> Ce document décrit les entités **communes** à toute la suite. Chaque module étend ce socle avec ses propres tables (par exemple `drive_files`, `docs_documents`) en respectant les règles ci-dessous. Les contrats de module précisent leurs tables.

## Principes

- **Identifiants** : UUID v7 (`uuidv7()`, natif PostgreSQL 18) — triés dans le temps, index efficaces.
- **Dates** : `timestamptz`, stockées en UTC ; conversion aux bords (UI, API). Jamais de date naïve.
- **Multi-tenant** : toute ressource appartient à une organisation (`org_id` non nul) et porte un index commençant par `org_id`. Aucune requête applicative ne lit une ressource sans filtre d'organisation.
- **Espaces personnels** : un compte possède une organisation de type `personal` créée automatiquement ; les espaces professionnels sont des organisations de type `team`. Un seul modèle, pas deux.
- **Suppression** : suppression logique (`deleted_at`) lorsque la restauration est un besoin produit (fichiers, documents) ; sinon suppression réelle avec `ON DELETE` explicite.
- **Pas de table universelle** : les entités métier gardent des tables dédiées et lisibles. Seule la **table de grants** est transverse, avec un `resource_type` contrôlé par énumération et interprétée par chaque module via ses fonctions de politique.
- **Migrations** : générées par drizzle-kit, relues, versionnées, appliquées de manière contrôlée (`docs/deployment/`).

## Entités cœur (v0)

### Identité et sessions (gérées par better-auth, étendues par nous)

| Table | Rôle |
|---|---|
| `users` | Compte utilisateur : identifiant, email (unique), nom, avatar, préférences de base, statut |
| `sessions` | Sessions actives ; révocables individuellement (et globalement) ; expiration et métadonnées (IP, agent) |
| `accounts` | Fournisseurs d'authentification (mot de passe, OIDC futur) |
| `verifications` | Jetons de vérification (email, réinitialisation) |

Le schéma exact est généré par better-auth puis adopté dans nos migrations ; toute extension passe par des colonnes additives documentées.

### Organisations et appartenance

| Table | Rôle |
|---|---|
| `orgs` | Organisation : `kind` (`personal` \| `team`), nom, slug (unique), réglages (JSON validé par schéma), état |
| `members` | Appartenance utilisateur ↔ organisation, `role` : `owner` \| `admin` \| `member`, statut, dates |
| `invites` | Invitations (email, rôle visé, jeton haché, expiration, émetteur, état) |
| `groups` | Groupes au sein d'une organisation (équipes, classes…) |
| `group_members` | Membres d'un groupe |

### Autorisations (voir ADR-0004)

| Table | Rôle |
|---|---|
| `resource_grants` | Autorisations explicites : `resource_type` (énum contrôlée), `resource_id`, `subject_type` (`user` \| `group` \| `org`), `subject_id`, `role` (`viewer` \| `commenter` \| `editor` \| `owner`), `expires_at`, `created_by`, unicité `(resource_type, resource_id, subject_type, subject_id)` |

Règles : **refus par défaut** ; les rôles d'organisation donnent des capacités globales (administration, création) mais **ne donnent jamais accès en lecture implicite à une ressource privée d'un autre membre** (sauf politique d'organisation explicite à venir). Les liens de partage sont des capacités propres aux modules (jeton haché, expiration, révocation) référençant la ressource.

### Audit et exploitation

| Table | Rôle |
|---|---|
| `audit_events` | Journal d'audit : acteur (utilisateur ou jeton MCP), organisation, action, ressource, résultat, métadonnées minimales, horodatage. Rétention configurable |
| `instance_settings` | Réglages de l'instance (nom, politique d'inscription, politiques de conservation) |
| `org_settings` | Réglages par organisation (partage externe autorisé ?, quotas, politique de rétention) |
| `api_tokens` | Jetons (MCP, intégrations) : propriétaire, organisation, scopes, empreinte (jamais en clair), expiration, dernière utilisation, révocation |

### Notifications

| Table | Rôle |
|---|---|
| `notifications` | Notifications utilisateur (partage reçu, tâche assignée, copie notée, système) : organisation, destinataire, type, titre, corps, lien applicatif, `read_at` (nul = non lue), horodatage. Suppression en cascade avec l'organisation ou l'utilisateur ; lecture et mutations toujours filtrées sur l'acteur |

### Fichiers (socle `packages/storage` + module Drive)

| Table | Rôle |
|---|---|
| `files` | Métadonnées : `org_id`, parent (dossier), nom, type MIME, taille, `storage_key`, empreinte (checksum), statut (`active` \| `trashed` \| `deleting`), créateur, dates |
| `file_versions` | Versions : fichier, numéro, `storage_key`, taille, empreinte, auteur, date (rétention selon politique) |
| `file_shares` | Liens de partage : fichier, jeton **haché**, rôle accordé, expiration, révocation, compteur d'usage (module Drive) |

`storage_key` est opaque pour la base : l'adaptateur de stockage (local ou S3) possède la convention de nommage.

## Invariants vérifiés par les tests

1. Toute ligne de ressource possède un `org_id` valide ; les jointures inter-organisations sont impossibles par construction applicative et testées.
2. Toute autorisation a un sujet existant et une ressource existante (FK) ; l'expiration est contrôlée à la lecture.
3. Les jetons (invitations, partages, API) sont stockés **hachés** et jamais journalisés en clair.
4. Les suppressions respectent les politiques : corbeille → purge selon rétention, jamais de perte silencieuse.

## Évolution

Les tables listées ci-dessus marquées « module » (Drive, Docs…) sont créées dans les migrations de leurs modules respectifs, pas dans le package `database`. Le package `database` ne contient que le socle commun, les helpers et les migrations qui le concernent.
