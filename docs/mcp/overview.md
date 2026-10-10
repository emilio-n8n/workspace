# MCP — vue d'ensemble

> Décision structurante : [ADR-0006](../decisions/0006-mcp.md). Le serveur MCP est un **client privilégié mais bridé** des mêmes services que l'interface web.

## Objectif

Permettre à des agents IA compatibles MCP (Claude, Codex, autres) d'utiliser Workspace — lire, chercher, créer, organiser — **avec les mêmes règles d'autorisation que les humains**, des jetons révocables et un journal d'audit complet.

## Architecture

```
Agent (stdio ou HTTP) ──► apps/mcp-server ──► modules/*/service.ts ──► permissions.can(actor)
                                │                     │
                                │                     └── database / storage (comme le web)
                                └── audit_events, rate limiting, confirmation des actions sensibles
```

- Aucune logique métier propre : les outils sont des adaptateurs fins.
- Aucun accès direct à la base qui contournerait `packages/permissions`.
- Deux transports : **stdio** (agents locaux) et **HTTP streamable** (agents distants).

## Authentification et jetons

- Jetons émis par l'utilisateur dans l'interface (**Agents & jetons**, `/app/settings/tokens`), liés à (utilisateur, organisation).
- **Scopes** : `drive:read`, `drive:write`, `docs:read`, `docs:write`, `tasks:read`, `tasks:write`, `calendar:read`, `calendar:write`, `audit:read` (état actuel).
- Stockage : empreinte SHA-256 uniquement ; le jeton en clair n'est montré qu'à la création ; révocation immédiate ; « dernier usage » visible.
- Le jeton ne peut jamais voir plus que son propriétaire au moment de l'appel : l'`Actor` est construit par le serveur puis les mêmes contrôles que le web s'appliquent.

## Contrat d'un outil

| Champ | Règle |
|---|---|
| `name` | stable, préfixé par domaine (`files.search`, `docs.read`…) |
| `input` | JSON Schema strict, validé avant tout traitement |
| `scopes` | liste minimale ; `read` séparé de `write` |
| `confirmation` | obligatoire pour les actions destructrices (à venir avec `files.delete`) |
| `errors` | typées — jamais de détail interne au-delà du message métier |
| `audit` | acteur, org, outil, résultat (succès **et** refus) dans `audit_events` |

## Outils livrés (v1)

| Outil | Scopes | Description |
|---|---|---|
| `me.whoami` | — (jeton valide) | Identité, organisation et scopes du jeton courant |
| `audit.recent` | `audit:read` | Derniers événements d'audit de l'organisation |
| `files.search` | `drive:read` | Recherche de fichiers accessibles (partages hérités compris) |
| `files.read` | `drive:read` | Lecture d'un fichier texte (text/\*, JSON, Markdown, XML), tronquée à 60 k caractères |
| `docs.read` | `docs:read` | Lecture du texte d'un document (extraction plain text) |
| `tasks.lists` | `tasks:read` | Listes de tâches accessibles (personnelles et partagées) avec le rôle |
| `tasks.list` | `tasks:read` | Tâches d'une liste (ou de toutes) : statut, priorité, échéance |
| `tasks.create` | `tasks:write` | Création d'une tâche dans une liste accessible en écriture |

## Feuille de route des outils

- Prochaines briques : `tasks.update` / `tasks.delete` (confirmation explicite pour la suppression), `docs.create`, `docs.update`, `files.write`, `files.delete` (confirmation), recherche plein texte.
- Phases suivantes : Calendar, Tasks, Forms, administration selon permissions — toujours sous les mêmes règles.

## Sécurité et tests obligatoires

- Jeton révoqué → refus ; scope insuffisant → refus ; autre organisation → refus ; ressource non partagée → refus ; action destructive sans confirmation → refus (à venir avec l'outil).
- Les tests d'intégration démarrent le **vrai serveur MCP** (stdio) contre une base PostgreSQL réelle et vérifient aussi que les refus sont **journalisés**.

## Limites connues

- Pas d'administration exposée au MCP à ce stade ; pas de recherche plein texte (nom uniquement).
- L'API HTTP publique documentée (Phase 6) est un canal distinct, avec sa propre authentification.
