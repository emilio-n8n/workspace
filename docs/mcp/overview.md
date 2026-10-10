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

- Jetons émis par l'utilisateur dans l'interface (page « Agents & jetons »), liés à (utilisateur, organisation).
- **Scopes** par domaine et par niveau : `drive:read`, `drive:write`, `docs:read`, `docs:write`, … ; jamais d'`admin` implicite.
- Stockage : empreinte uniquement (le jeton en clair n'est montré qu'à la création) ; expiration optionnelle ; révocation immédiate ; « dernier usage » visible.
- Le jeton ne peut jamais voir plus que son propriétaire au moment de l'appel : le serveur construit l'`Actor` puis appelle `can()`.

## Contrat d'un outil

| Champ | Règle |
|---|---|
| `name` | stable, préfixé par domaine (`files.search`, `docs.read`…) |
| `input` | JSON Schema strict, validé avant tout traitement |
| `scopes` | liste minimale ; `read` séparé de `write` |
| `confirmation` | obligatoire pour les actions destructrices (l'outil refuse sans `confirm: true` éclairé) |
| `errors` | typées (`not_found`, `forbidden`, `validation`, `conflict`, `rate_limited`) — jamais de détail interne |
| `audit` | acteur, org, outil, ressource visée, résultat (succès **et** refus) |

## Outils v0 (Phase 2)

| Outil | Scopes | Description |
|---|---|---|
| `files.search` | `drive:read` | Rechercher des fichiers accessibles (nom, type, texte simple) |
| `files.read` | `drive:read` | Lire le contenu texte d'un fichier autorisé (types texte/markdown) |
| `docs.read` | `docs:read` | Lire le texte d'un document autorisé |
| `docs.list` | `docs:read` | Lister les documents accessibles |

L'élargissement (écriture, calendrier, formulaires, administration selon permissions) suit la feuille de route des modules, sous les mêmes règles. La liste complète et les schémas seront générés/documentés au fil des phases.

## Sécurité et tests obligatoires

- Jeton révoqué → refus ; scope insuffisant → refus ; autre organisation → refus ; ressource non partagée → refus ; action destructive sans confirmation → refus.
- Limitation de débit par jeton (protection contre les boucles d'agent).
- Les tests s'exécutent contre les services réels (pas de mocks de permissions).

## Limites connues

- Pas d'administration exposée au MCP à ce stade.
- Les écritures riches (édition collaborative, formulaires) attendent leurs modules.
- L'API HTTP publique documentée (Phase 6) est un canal distinct, avec sa propre authentification.
