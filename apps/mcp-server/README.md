# Workspace — serveur MCP

Serveur MCP officiel (ADR-0006) : les agents IA utilisent Workspace **avec les mêmes règles d'autorisation que l'interface web**, via des jetons révocables, scopés et journalisés.

Documentation de référence des outils : [`docs/mcp/overview.md`](../../docs/mcp/overview.md).

## État actuel

**29 outils** couvrent la suite : identité du jeton, audit, Drive (fichiers), Docs, Tasks, Calendar, Forms, Sheets, Slides, Chat, Mail, Classroom et Sites. Les outils destructifs exigent une confirmation littérale (`confirm: "SUPPRIMER"`). Chaque appel — succès, refus ou erreur — écrit un événement d'audit.

## Jetons

Les jetons se créent dans l'application : **Accueil → Agents & jetons** (`/app/settings/tokens`).

- Scopes minimaux, au format `module:action` : `drive:read`, `drive:write`, `docs:read`, `docs:write`, `tasks:read`, `tasks:write`, `calendar:read`, `calendar:write`, `forms:read`, `sheets:read`, `slides:read`, `chat:read`, `chat:write`, `mail:read`, `mail:write`, `classroom:read`, `classroom:write`, `sites:read`, `audit:read`.
- Un jeton utilise exactement les permissions de son créateur ; le rôle effectif est revérifié à chaque appel.
- Expiration par défaut à 90 jours ; stockage par empreinte SHA-256 ; révocation immédiate depuis la même page.
- `audit:read` est réservé aux rôles `owner`/`admin` de l'organisation.

## Utilisation (transport stdio — agents locaux)

```bash
WORKSPACE_TOKEN=wsk_… pnpm --filter @workspace/mcp-server start
```

Configuration type (Claude Desktop, Codex, etc.) :

```json
{
  "mcpServers": {
    "workspace": {
      "command": "pnpm",
      "args": ["--filter", "@workspace/mcp-server", "start"],
      "env": { "WORKSPACE_TOKEN": "wsk_…" }
    }
  }
}
```

## Utilisation (transport HTTP — agents distants)

```bash
pnpm --filter @workspace/mcp-server start -- --http 3333
# puis : Authorization: Bearer wsk_…
```

Le port est celui passé après `--http` (défaut `3333`).

## Développement

```bash
pnpm --filter @workspace/mcp-server dev     # rechargement à chaud (tsx watch)
pnpm --filter @workspace/mcp-server test    # tests d'intégration (serveur MCP réel + PostgreSQL)
```

Le serveur MCP n'est **pas** démarré par `pnpm dev` (qui lance les 14 applications) : il se lance explicitement, comme ci-dessus.

## Règles

- Sans jeton valide : aucun outil ne répond ; chaque refus est journalisé.
- Scope insuffisant, autre organisation, ressource non partagée, action destructive sans confirmation : refus typé, sans détail interne.
- Aucun accès direct à la base : les outils appellent les mêmes services que l'application web.
- Les outils destructifs (corbeille, purge, suppression d'événement) exigent `confirm: "SUPPRIMER"`.
