# Déploiement production sur un VPS

Ce guide installe la suite complète (14 applications) sur un VPS avec
PostgreSQL, stockage local et Caddy (TLS automatique). Le résultat :

```
Internet
  │ 443/80
  ▼
Caddy ──► home:3000        (https://exemple.org)
      ──► drive:3000       (https://drive.exemple.org)
      ──► docs:3000        (https://docs.exemple.org)
      ──► … 14 applications
      ──► postgres:5432    (interne uniquement)
```

## Prérequis

- VPS Linux (Ubuntu 24.04 recommandé), **4 vCPU / 8 Go de RAM** minimum pour
  builder les 14 images ; 2 vCPU / 4 Go suffisent pour l'exécution.
- Docker Engine 27+ et le plugin Compose.
- Un nom de domaine et un accès DNS.
- Les ports **80** et **443** ouverts ; **22** pour l'administration.
- PostgreSQL n'est **pas** exposé publiquement.

## 1. DNS

Créez deux enregistrements vers l'IP du VPS :

| Nom | Type | Valeur |
|---|---|---|
| `exemple.org` | A / AAAA | IP du VPS |
| `*.exemple.org` | A / AAAA | IP du VPS |

Le wildcard couvre `drive`, `docs`, `tasks`, `calendar`, `forms`, `sheets`,
`slides`, `mail`, `chat`, `meet`, `sites`, `classroom` et `admin`. Caddy
obtient un certificat par sous-domaine utilisé (HTTP-01) ; aucun certificat
wildcard n'est nécessaire.

## 2. Récupérer le dépôt

```bash
sudo mkdir -p /srv/workspace
sudo chown "$USER":"$USER" /srv/workspace
git clone https://github.com/emilio-n8n/workspace.git /srv/workspace
cd /srv/workspace
```

## 3. Configuration

```bash
cd infrastructure/docker
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Renseignez au minimum :

- `PUBLIC_HOST` et `PUBLIC_URL` (domaine réel) ;
- `BETTER_AUTH_COOKIE_DOMAIN` (`.exemple.org`) ;
- `ACME_EMAIL` ;
- `POSTGRES_PASSWORD` **et** le mot de passe dans `DATABASE_URL` (les deux
  doivent être identiques) ;
- `SESSION_SECRET` : `openssl rand -hex 32`.

Le fichier `.env.prod` contient des secrets : il ne doit jamais être commité.
Il est ignoré par git via `.env.*` (sauf `.env.example`).

## 4. Construire et démarrer

```bash
cd /srv/workspace/infrastructure/docker

# 1) Construire les images (peut prendre 15-30 min la première fois)
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# 2) Démarrer PostgreSQL et attendre qu'il soit sain
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres

# 3) Appliquer les migrations (cible « migrate »)
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  --profile tools run --rm migrate

# 4) Démarrer les 14 applications et Caddy
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Vérifications :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS https://exemple.org/api/health
curl -fsS https://drive.exemple.org/api/health
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f caddy
```

Les sondes `/api/health` répondent `200` lorsque PostgreSQL répond. Caddy
attend que les conteneurs soient démarrés ; les healthchecks Docker signalent
les applications en échec.

## 5. Premier compte et jeton de synchronisation

1. Ouvrez `https://exemple.org` et créez le compte propriétaire.
2. Dans **Agents & jetons**, créez un jeton `drive:read` + `drive:write`.
3. Installez le client local et lancez la première synchronisation :
   voir [`docs/sync/README.md`](../sync/README.md).

## 6. Sauvegardes

Les données vivent dans deux volumes Docker :

- `workspace_postgres-data` : la base ;
- `workspace_workspace-storage` : les binaires (stockage local).

Sauvegarde cohérente (base + stockage) :

```bash
BACKUP=/srv/backups/workspace-$(date +%F-%H%M)
mkdir -p "$BACKUP"

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$BACKUP/db.dump"

docker run --rm \
  -v workspace_workspace-storage:/data:ro \
  -v "$BACKUP":/backup \
  alpine tar czf /backup/storage.tar.gz -C /data .
```

Planifiez-la (cron/systemd timer), conservez plusieurs générations et testez
la restauration sur une instance de test. Sans le stockage, les métadonnées
Drive pointent vers des binaires absents.

Restauration :

```bash
docker compose ... exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean < db.dump
docker run --rm -v workspace_workspace-storage:/data -v "$BACKUP":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/storage.tar.gz -C /data'
```

## 7. Mise à jour

```bash
cd /srv/workspace
git pull --ff-only
cd infrastructure/docker
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Prévoyez une fenêtre de maintenance : les conteneurs sont recréés. Les
migrations sont additives dans la mesure du possible, mais sauvegardez avant
toute mise à jour.

## 8. Exploitation

- **Logs** : `docker compose … logs -f <service>` ; les applications écrivent
  sur stdout, les secrets ne sont pas journalisés.
- **Redémarrage** : `docker compose … restart <service>`.
- **Espace disque** : surveillez `docker system df`, les volumes et
  `/srv/backups` ; purgez les anciennes sauvegardes.
- **TLS** : Caddy renouvelle automatiquement ; le volume `caddy-data` doit
  être conservé.
- **Sécurité** : firewall 22/80/443, mises à jour système, `POSTGRES_PASSWORD`
  et `SESSION_SECRET` uniques, sauvegardes chiffrées.
- **Supervision** : sondez chaque sous-domaine sur `/api/health` (Uptime Kuma,
  Better Stack, etc.).

## 9. Ce qui n'est pas dans ce compose

- **Collaboration Docs temps réel (Yjs)** : le serveur `apps/collab` n'est pas
  inclus ; Docs fonctionne en autosave. Pour l'activer, ajoutez un service
  `collab` (port 3100) et un sous-domaine WebSocket, puis renseignez
  `COLLAB_URL`.
- **Serveur MCP** : processus séparé (`apps/mcp-server`), à lancer si vous
  exposez des agents ; il utilise les mêmes jetons et services.
- **SMTP / LiveKit** : optionnels ; renseignez les variables dans `.env.prod`
  pour activer l'envoi de Mail et le média Meet.

## Dépannage

| Symptôme | Piste |
|---|---|
| Caddy ne obtient pas de certificat | DNS wildcard absent, ports 80/443 fermés, ou rate limit Let's Encrypt |
| `502` sur une app | conteneur unhealthy ; `docker compose logs <app>` |
| Migrations en échec | `DATABASE_URL` incorrect ou base pas encore saine ; relancez `migrate` |
| Sessions perdues entre sous-domaines | `BETTER_AUTH_COOKIE_DOMAIN` doit commencer par un point et correspondre au domaine |
| Uploads perdus après redémarrage | volume `workspace-storage` non monté / supprimé |
