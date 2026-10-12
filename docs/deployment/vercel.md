# Déploiement — Vercel

Déployer la suite Workspace sur Vercel : **un projet Vercel par application** (14 projets), adossés au dépôt GitHub [`emilio-n8n/workspace`](https://github.com/emilio-n8n/workspace).

> Pour l'auto-hébergement (Docker, reverse proxy), voir [self-hosting.md](./self-hosting.md).

## Architecture

| Application | Projet Vercel (suggestion) | Domaine (exemple) | Variable d'URL    |
| ----------- | -------------------------- | ----------------- | ----------------- |
| Accueil     | `workspace-home`           | `exemple.org`     | `PUBLIC_URL`      |
| Drive       | `workspace-drive`          | `drive.exemple.org` | `DRIVE_URL`     |
| Docs        | `workspace-docs`           | `docs.exemple.org`  | `DOCS_URL`      |
| Tasks       | `workspace-tasks`          | `tasks.exemple.org` | `TASKS_URL`     |
| Calendar    | `workspace-calendar`       | `calendar.exemple.org` | `CALENDAR_URL` |
| Forms       | `workspace-forms`          | `forms.exemple.org` | `FORMS_URL`     |
| Sheets      | `workspace-sheets`         | `sheets.exemple.org` | `SHEETS_URL`   |
| Slides      | `workspace-slides`         | `slides.exemple.org` | `SLIDES_URL`   |
| Mail        | `workspace-mail`           | `mail.exemple.org`  | `MAIL_URL`      |
| Chat        | `workspace-chat`           | `chat.exemple.org`  | `CHAT_URL`      |
| Meet        | `workspace-meet`           | `meet.exemple.org`  | `MEET_URL`      |
| Sites       | `workspace-sites`          | `sites.exemple.org` | `SITES_URL`     |
| Classroom   | `workspace-classroom`      | `classroom.exemple.org` | `CLASSROOM_URL` |
| Admin       | `workspace-admin`          | `admin.exemple.org` | `ADMIN_URL`     |

- Chaque projet a pour **Root Directory** `apps/<app>` et lit `apps/<app>/vercel.json` :
  framework **Vite**, install/build exécutés **à la racine du monorepo** (`cd ../..`), sortie `dist`, région `cdg1` (Paris).
- Une seule base PostgreSQL (Neon) et un seul SSO pour les 14 applications.
- Le build ne requiert aucune base : la configuration est validée à la première requête serveur, pas à la compilation.

## 1. Base de données (Neon)

1. Créer un projet Neon (PostgreSQL ≥ 16) dans une région européenne, cohérente avec `cdg1`.
2. Récupérer **deux** chaînes de connexion :
   - **directe** (sans `-pooler`) pour les migrations ;
   - **poolée** (`-pooler`, avec `sslmode=require`) pour `DATABASE_URL` en production — les fonctions serverless ouvrent de nombreuses connexions.
3. Une seule base suffit : tous les modules partagent la même base et le même registre de migrations.

## 2. Importer le dépôt et créer les 14 projets

1. Dashboard Vercel → **Add New… → Project** → importer le dépôt GitHub `emilio-n8n/workspace` (autoriser l'app GitHub Vercel si nécessaire).
2. Pour chaque application :
   - **Project Name** : `workspace-<app>` (ex. `workspace-drive`) ;
   - **Root Directory** : `apps/<app>` ;
   - activer **« Include source files outside of the Root Directory in the Build Step »** — obligatoire : les commandes remontent à la racine du monorepo avec `cd ../..` ;
   - laisser le framework détecté (**Vite**) et les commandes définies par `apps/<app>/vercel.json` (ne pas les surcharger dans le dashboard) ;
   - optionnel : activer **« Skip deployments when there are no changes to the root directory or its dependencies »** pour éviter 14 redéploiements à chaque commit.
3. Répéter pour les 14 applications. Chaque import déclenche un premier déploiement : il peut échouer tant que les variables (étape 3) ne sont pas définies — c'est sans conséquence.

Réglages portés par `apps/<app>/vercel.json` :

| Réglage | Valeur                                        |
| ------- | --------------------------------------------- |
| install | `cd ../.. && pnpm install --frozen-lockfile`  |
| build   | `cd ../.. && pnpm --filter @app/<app> build`  |
| output  | `dist`                                        |
| région  | `cdg1`                                        |

## 3. Variables d'environnement (identiques sur les 14 projets)

Settings → **Environment Variables** de chaque projet (cocher **Production**, et Preview si besoin). Les valeurs doivent être **identiques partout** : les liens inter-applications et les origines de confiance en dépendent.

| Variable                  | Valeur (exemple)                                                                 | Rôle                                  |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| `DATABASE_URL`            | `postgres://…@ep-xxx-pooler.eu-central-1.aws.neon.tech/workspace?sslmode=require` | connexion PostgreSQL (requis)         |
| `SESSION_SECRET`          | `openssl rand -hex 24` (≥ 32 caractères)                                          | signature des sessions (requis en production) |
| `PUBLIC_URL`              | `https://exemple.org`                                                             | URL publique de l'Accueil             |
| `DRIVE_URL` … `ADMIN_URL` | `https://<app>.exemple.org` (13 variables)                                        | URLs publiques des applications       |
| `BETTER_AUTH_COOKIE_DOMAIN` | `.exemple.org`                                                                  | cookie de session partagé (SSO)       |

Optionnel selon les modules : `MAIL_*` (dont `MAIL_DOMAIN`, `SMTP_*`, `MAIL_WEBHOOK_SECRET`), `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (Meet), `STORAGE_DRIVER=s3` + `S3_*` (recommandé, voir Limites), `MAX_UPLOAD_BYTES`.

> Sans les 13 `*_URL`, les URLs sont dérivées en sous-domaines de `PUBLIC_URL` (voir `.env.example`) ; les définir explicitement évite toute ambiguïté.

## 4. Domaine personnalisé et SSO

### Pourquoi pas les domaines `*.vercel.app`

`vercel.app` figure sur la **Public Suffix List** (PSL, <https://publicsuffix.org>) — comme `netlify.app`, `pages.dev`, `github.io`, `fly.dev`, ou les suffixes publics `co.uk`, `com`… Conséquences :

- un cookie envoyé avec `Domain=.vercel.app` est **rejeté par les navigateurs** (protection anti-« supercookie » : un projet ne doit pas pouvoir lire les cookies d'un autre projet) ;
- deux projets `mon-app.vercel.app` et `mon-app-2.vercel.app` sont donc, du point de vue du navigateur, **des sites distincts** : aucun cookie de session ne peut être partagé entre eux. Le SSO est **impossible** sans domaine personnalisé.

### Domaine à soi + sous-domaines (requis pour le SSO)

1. Attacher un domaine possédé (ex. `exemple.org`) dans **Settings → Domains** de chaque projet : `exemple.org` (apex) sur `workspace-home`, `drive.exemple.org` sur `workspace-drive`, etc. (DNS : `A 76.76.21.21` pour l'apex, `CNAME cname.vercel-dns.com` pour les sous-domaines, ou les enregistrements indiqués par Vercel).
2. Définir `BETTER_AUTH_COOKIE_DOMAIN=.exemple.org` partout : le cookie de session est émis pour tout le domaine et envoyé à chaque sous-domaine → une connexion vaut pour les 14 applications.
3. Vérifier `PUBLIC_URL=https://exemple.org` : elle sert de base aux URLs dérivées et aux origines de confiance (`trustedOrigins`), et `localhost` y est refusé en production.

Les déploiements de préversion (`*.vercel.app`) subissent la même contrainte de cookies : faire les recettes SSO sur le domaine personnalisé. Sans domaine du tout, chaque application reste utilisable, mais **exige une connexion séparée** — acceptable en test, pas en production.

## 5. Migrations

Une fois, depuis un poste local (jamais au démarrage des fonctions) :

```bash
DATABASE_URL="postgres://…direct…" pnpm db:migrate
```

- Utiliser l'URL **directe** (sans `-pooler`) : les migrations passent mieux sans PgBouncer.
- La commande applique, dans un ordre déterministe, les migrations du cœur puis de chaque module sur la base Neon.
- À relancer après toute mise à jour contenant de nouvelles migrations.

## 6. Vérification post-déploiement

```bash
for app in home drive docs tasks calendar forms sheets slides mail chat meet sites classroom admin; do
  host=$([ "$app" = home ] && echo exemple.org || echo "$app.exemple.org")
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://$host/api/health")
  printf "%-10s %s\n" "$app" "$code"
done
```

Sortie attendue : `200` pour les 14. La configuration Vercel impose `Cache-Control: no-store` sur cette route. Si `/api/health` renvoie `404` (route santé pas encore exposée), contrôler au minimum un statut non-5xx sur l'accueil : `curl -sI https://exemple.org | head -1`.

Vérifier ensuite le SSO : se connecter sur `https://exemple.org`, puis ouvrir `https://drive.exemple.org` — la session doit être conservée.

## 7. Limites connues

- **LiveKit (Meet)** : le média temps réel ne tourne pas sur les fonctions Vercel. Sans `LIVEKIT_*`, les salles fonctionnent en « lien seul » ; pour l'audio/vidéo, héberger LiveKit en dehors (service externe) et renseigner `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **Courrier entrant (Mail)** : impossible de poser un `MX` chez Vercel. L'exploitant reçoit le courrier sur son service (MX à lui) et POSTe le webhook ; définir `MAIL_WEBHOOK_SECRET` des deux côtés.
- **SMTP** : sans `SMTP_*`, les envois restent dans la boîte d'envoi locale avec une erreur explicite — aucune perte silencieuse.
- **Stockage** : le système de fichiers des fonctions Vercel est éphémère. Utiliser `STORAGE_DRIVER=s3` (+ `S3_*`) pour les binaires ; `STORAGE_DRIVER=local` ne convient pas en production.
- **Taille des requêtes** : les fonctions Vercel limitent le corps des requêtes à ~4,5 Mo ; régler `MAX_UPLOAD_BYTES` en conséquence ou prévoir un envoi direct vers le stockage pour les gros fichiers.

## 8. Déploiement par CLI (alternative)

```bash
# pour chaque application (depuis la racine du dépôt)
cd apps/<app>
vercel link        # lier ce dossier au projet Vercel correspondant
vercel --prod      # déployer en production
```

Vercel recommande aussi `vercel link --repo` exécuté **une fois à la racine** : il associe chaque `apps/<app>` à son projet, puis `cd apps/<app> && vercel --prod` déploie la bonne application.

## Références

- Vercel — Using Monorepos : <https://vercel.com/docs/monorepos>
- Vercel — Cookie d'un sous-domaine de projet vers `vercel.app` : <https://vercel.com/kb/guide/can-i-set-a-cookie-from-my-vercel-project-subdomain-to-vercel-app>
- Public Suffix List : <https://publicsuffix.org>
- Auto-hébergement : [self-hosting.md](./self-hosting.md)
