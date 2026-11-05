# Workspace Sync — client de synchronisation local

Le client `workspace-sync` garde un dossier local aligné avec un dossier du
Drive Workspace. Il fonctionne sur ordinateur (Linux, macOS, Windows) et peut
être lancé comme service pour synchroniser en continu. Le serveur reste la
source de vérité partagée entre appareils.

## Ce qu'il sait faire

| Mode | Sens | Fichiers distants seuls | Fichiers locaux seuls | Suppressions |
|---|---|---|---|---|
| `two-way` | local ↔ distant | téléchargés | envoyés | propagées |
| `upload` | local → distant | ignorés | envoyés | ignorées par défaut |
| `download` | distant → local | téléchargés | ignorés | ignorées par défaut |

- **Conflits** : jamais d'écrasement silencieux. En `two-way`, le contenu local
  est conservé dans une copie `nom.conflict-<appareil>-<horodatage>.ext`, la
  version distante reprend le nom d'origine, puis la copie locale est envoyée.
  En `download`, la version distante gagne et la copie locale est conservée.
- **Suppressions** : en `two-way`, une suppression locale met l'élément distant
  à la corbeille (et inversement) si l'autre côté n'a pas changé depuis la
  dernière passe. Les suppressions locales passent par
  `.workspace-sync/trash/` — rien n'est effacé définitivement.
- **One-way** : `--mirror-deletes` propage aussi les suppressions ; sans cette
  option, l'autre côté est conservé.
- **État** : `.workspace-sync/state.json` (empreintes, identifiants distants,
  dernière passe). Le dossier est ignoré automatiquement.
- **Verrou** : une seule passe à la fois par dossier (`.workspace-sync/lock`).

## 1. Créer un jeton

Dans l'application Accueil : **Agents & jetons** (`/app/settings/tokens`).
Créez un jeton avec les scopes :

- `drive:read` — obligatoire ;
- `drive:write` — obligatoire pour `two-way` et `upload`.

Le jeton n'est affiché qu'une fois. Il est révocable immédiatement.

## 2. Installer le client

Depuis le dépôt :

```bash
pnpm install
pnpm --filter @workspace/sync-client build
sudo npm install -g ./packages/sync-client
workspace-sync --help
```

Sans installation globale, utilisez
`pnpm --filter @workspace/sync-client start -- …` (ou `pnpm --filter
@workspace/sync-client exec tsx src/cli.ts …`).

## 3. Initialiser

```bash
workspace-sync init \
  --url https://drive.exemple.org \
  --token wsk_… \
  --local ~/Workspace \
  --remote / \
  --mode two-way
```

Le jeton peut aussi venir de `WORKSPACE_SYNC_TOKEN` (recommandé pour un
service) :

```bash
WORKSPACE_SYNC_TOKEN=wsk_… workspace-sync init \
  --url https://drive.exemple.org \
  --local ~/Workspace \
  --mode two-way
```

Options utiles :

- `--remote /Projets` : synchronise un sous-dossier distant (créé si absent) ;
- `--device portable` : nom utilisé dans les copies de conflit ;
- `--ignore node_modules --ignore "*.tmp"` : motifs répétables ;
- `--mirror-deletes` : propager les suppressions en mode one-way ;
- `--interval 30` : intervalle du daemon, en secondes (minimum 5).

La configuration est écrite dans
`~/.config/workspace-sync/config.json` (ou `%APPDATA%` sous Windows) avec les
droits `0600` lorsqu'elle contient le jeton.

## 4. Lancer

```bash
workspace-sync run --once --verbose     # une passe, pour vérifier
workspace-sync run                      # daemon (polling)
workspace-sync status                   # état local, sans réseau
```

`--once` renvoie un code de sortie non nul si une action a échoué, ce qui est
pratique dans une tâche planifiée.

## Plusieurs dossiers

`init` crée un dossier ; pour en synchroniser plusieurs, ajoutez des entrées
dans `folders` (le jeton et l'appareil sont communs) :

```json
{
  "serverUrl": "https://drive.exemple.org",
  "deviceName": "portable",
  "intervalSeconds": 30,
  "folders": [
    { "localPath": "/home/moi/Workspace", "remotePath": "/", "mode": "two-way" },
    { "localPath": "/home/moi/Photos", "remotePath": "/Photos", "mode": "upload" },
    { "localPath": "/home/moi/Partages", "remotePath": "/Partages", "mode": "download" }
  ]
}
```

Chaque dossier a son propre état et son propre verrou ; une erreur sur l'un
n'empêche pas les autres de se synchroniser.

## 5. Service système

### Linux — systemd utilisateur

`~/.config/systemd/user/workspace-sync.service` :

```ini
[Unit]
Description=Workspace Sync
After=network-online.target

[Service]
# Chemin donné par « which workspace-sync » après l'installation globale.
ExecStart=/usr/local/bin/workspace-sync run
Environment=WORKSPACE_SYNC_TOKEN=wsk_…
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now workspace-sync
journalctl --user -u workspace-sync -f
```

### macOS — launchd

`~/Library/LaunchAgents/org.workspace.sync.plist` : programme
`/usr/local/bin/workspace-sync` (ou le chemin donné par `which workspace-sync`),
argument `run`, variable `WORKSPACE_SYNC_TOKEN`, `RunAtLoad` et `KeepAlive`.
Chargez avec `launchctl load -w …`.

### Windows — Planificateur de tâches

Créez une tâche « Au démarrage » qui exécute `workspace-sync.cmd run` (ou
`node …\dist\cli.mjs run`) avec la variable d'environnement
`WORKSPACE_SYNC_TOKEN`. Pour un service, utilisez NSSM.

## Téléphone et autres appareils

Le client est un binaire Node : sur Android, il peut tourner dans **Termux**
(`pkg install nodejs`, cloner le dépôt, `pnpm install`, build, puis
`workspace-sync run`). Sur iOS, l'accès passe pour l'instant par l'application
web Drive ; un client natif pourra réutiliser la même API HTTP.

Le serveur est le hub : chaque appareil exécute son propre client avec le même
jeton (ou un jeton par appareil, pour pouvoir le révoquer indépendamment).

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `401 unauthorized` | jeton révoqué, expiré ou mal copié |
| `403 forbidden` | scope `drive:write` absent (ou `drive:read`) |
| `Une synchronisation est déjà en cours` | verrou d'une passe précédente ; supprimez `.workspace-sync/lock` si le processus est mort |
| Conflits à répétition | deux appareils modifient le même fichier ; réduisez l'intervalle ou utilisez un mode one-way |
| Fichier ignoré | motif `--ignore`, dossier `.workspace-sync`, ou lien symbolique (non suivi) |

## Limites connues

- Pas de reprise partielle des gros fichiers : un fichier est renvoyé en entier
  après modification (limite d'upload de l'instance, 100 Mo par défaut).
- Les conflits de type (fichier local vs dossier distant) sont signalés et
  laissés à l'utilisateur.
- Le polling est volontairement simple ; un mode « watch » (inotify/FSEvents)
  pourra être ajouté sans changer le format d'état.
- Chaque passe charge l'instantané complet des éléments visibles ; pour des
  dizaines de milliers de fichiers, une API delta (curseur de changements)
  sera préférable.
- Les permissions Drive sont revérifiées à chaque passe : un dossier partagé
  en lecture seule ne peut pas être modifié par le client.
