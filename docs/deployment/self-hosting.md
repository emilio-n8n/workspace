# Déploiement — auto-hébergement

> **Statut : cible documentée — non encore disponible.** La Phase 1 produit le squelette compose et la configuration documentée ; rien de ce document n'est encore un guide d'installation utilisable.

## Cible

Une personne compétente, sans connaissance du code, doit pouvoir installer et exploiter une instance :

```
docker compose up          →  web (TanStack Start) + postgres (+ volumes)
Caddy ou Traefik (option)  →  TLS + domaine
Sauvegarde documentée      →  base + stockage (cohérents)
```

- **web** : les applications de la suite (Accueil, Drive, Docs, Tasks — puis les suivantes), chacune son propre conteneur, exposées sur des sous-domaines (`exemple.org`, `drive.exemple.org`, `docs.exemple.org`, `tasks.exemple.org`). Un seul PostgreSQL, une seule authentification (SSO par cookie de domaine).
- **postgres** : PostgreSQL ≥ 16 (18 recommandé), volume persistant, mot de passe généré à l'installation.
- **stockage** : LocalFS (volume) par défaut ; S3-compatible (MinIO, Garage, Ceph…) en option par variables d'environnement.
- Réverse proxy non fourni dans le compose par défaut (choix de l'exploitant documenté : **Caddy recommandé**, TLS automatique par sous-domaine).

## Configuration (variables d'environnement)

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | requis |
| `SESSION_SECRET` | Signature des sessions | requis (généré à l'installation) |
| `PUBLIC_URL` | URL publique de l'application d'accueil | requis |
| `DRIVE_URL`, `DOCS_URL`, `TASKS_URL` | URLs publiques des applications | dérivées en sous-domaines de `PUBLIC_URL` |
| `BETTER_AUTH_COOKIE_DOMAIN` | Cookie de session partagé entre sous-domaines (SSO) | requis en production multi-sous-domaines (ex. `.exemple.org`) |
| `STORAGE_DRIVER` | `local` \| `s3` | `local` |
| `STORAGE_DIR` | Répertoire des binaires (driver local) | `/data/storage` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | Stockage S3-compatible | — |
| `SMTP_*` | Envoi d'emails (invitations, vérification) — Phase 2 | — |
| `TRUSTED_PROXY` | Derrière un reverse proxy | `false` |

`.env.example` fournira chaque variable commentée, **sans aucun secret réel**. La validation au démarrage échoue si une variable requise manque (pas de démarrage « à moitié configuré »).

## Migrations

- Gérées par drizzle-kit, versionnées dans `packages/database`.
- Application : commande dédiée (`pnpm db:migrate` côté conteneur) exécutée à la mise à jour — jamais de migration automatique silencieuse au démarrage sans trace.
- Toute migration documente sa stratégie de rollback (les migrations destructrices exigent une note d'exploitation).

## Sauvegardes et restauration

- **Base + stockage sont sauvegardés ensemble** (cohérence de version) : `pg_dump` + copie du répertoire de stockage (ou versioning du bucket S3).
- Fréquence recommandée documentée, restauration **testée** (procédure pas-à-pas, critère : une instance restaurée répond et sert les fichiers).
- Les sauvegardes ne sont pas fournies « clés en main » dans le MVP : procédure et scripts documentés, exécutés par l'exploitant (cron).

## Mise à jour

1. Sauvegarder (base + stockage).
2. Récupérer la nouvelle version (tag de release).
3. Appliquer les migrations, redémarrer les services.
4. Vérifier `/healthz` + connexion + lecture d'un fichier.

## Exploitation

- Endpoints : `/healthz` (processus), `/readyz` (base + stockage joignables).
- Journaux : structurés (JSON) sur stdout, secrets redactés ; niveau configurable.
- Ports : 3000 (web interne) ; PostgreSQL non exposé publiquement ; TLS terminé par le reverse proxy.

## Sécurité de l'exploitant (rappel)

- Ne jamais exposer PostgreSQL ; mot de passe fort ; mises à jour de sécurité suivies.
- `SESSION_SECRET` unique par instance ; rotation documentée.
- Firewall : seuls 80/443 exposés ; sauvegardes chiffrées recommandées.

## Développement local (état actuel)

`pnpm dev` démarre les quatre applications (Accueil 3000, Drive 3001, Docs 3002, Tasks 3003) sur `localhost` — le SSO fonctionne sans configuration (les cookies ignorent les ports). PostgreSQL natif (`workspace_dev` / `workspace_test`), `.env` local non versionné. Le compose de développement et le compose d'installation multi-applications seront ajoutés en Phase 1/6 avec vérification réelle dès que l'accès Docker de la machine sera effectif.
