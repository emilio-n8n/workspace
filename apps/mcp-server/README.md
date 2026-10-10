# Workspace — serveur MCP

Serveur MCP officiel (ADR-0006) : les agents IA utilisent Workspace **avec les mêmes règles
d'autorisation que l'interface web**, via des jetons révocables, scopés et journalisés.

## Statut

Squelette Phase 1 : authentification par jeton (réelle), journal d'audit, premiers outils
de diagnostic. Les outils Drive/Docs arrivent avec la Phase 2 (mêmes services que l'application).

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

## Outils disponibles (v0)

| Outil | Scope requis | Description |
|---|---|---|
| `me.whoami` | aucun (jeton valide) | Identité et scopes du jeton courant |
| `audit.recent` | `audit:read` | Derniers événements d'audit de l'organisation |

## Règles

- Sans jeton valide : aucun outil ne répond, chaque refus est journalisé.
- Chaque appel (succès, refus, erreur) écrit un événement dans `audit_events`.
- Les jetons se créent dans l'application : **Agents & jetons** (`/app/settings/tokens`).
