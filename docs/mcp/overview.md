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

## Outils livrés (v3 — 29)

| Outil | Scopes | Description |
|---|---|---|
| `me.whoami` | — (jeton valide) | Identité, organisation et scopes du jeton courant |
| `audit.recent` | `audit:read` | Derniers événements d'audit (réservé owner/admin de l'organisation) |
| `files.search` | `drive:read` | Recherche de fichiers accessibles (partages hérités compris) |
| `files.read` | `drive:read` | Lecture d'un fichier texte (tronquée à 60 k caractères) |
| `files.write` | `drive:write` | Création d'un fichier texte (mime allowlist, ≤ 2 Mo, quota appliqué) |
| `files.delete` | `drive:write` | Suppression (corbeille par défaut ; définitive = propriétaire + déjà en corbeille) — **confirmation « SUPPRIMER » exigée** |
| `docs.read` | `docs:read` | Lecture du texte d'un document (extraction plain text) |
| `docs.list_versions` | `docs:read` | Historique des versions d'un document |
| `docs.restore_version` | `docs:write` | Restaure une version (crée une nouvelle version, auditée) |
| `tasks.lists` / `tasks.list` | `tasks:read` | Listes accessibles avec rôle ; tâches (statut, priorité, échéance) |
| `tasks.create` / `tasks.update` / `tasks.complete` | `tasks:write` | Création, mise à jour, terminaison |
| `calendar.list` / `calendar.create` | `calendar:read` / `calendar:write` | Événements par plage ; création dans l'agenda personnel |
| `calendar.delete` | `calendar:write` | Suppression — **confirmation littérale requise** (`confirm: "SUPPRIMER"`) |
| `forms.list` / `forms.responses` | `forms:read` | Formulaires ; réponses avec intitulés (éditeurs) |
| `sheets.read` | `sheets:read` | Valeurs **calculées** d'un onglet (50×20 maximum) |
| `slides.read` | `slides:read` | Plan d'une présentation (titres, notes, textes) |
| `chat.list` / `chat.read` / `chat.send` | `chat:read` / `chat:write` | Conversations, messages, envoi |
| `mail.list` / `mail.read` / `mail.send` | `mail:read` / `mail:write` | Dossiers, lecture (corps tronqué), envoi (erreurs visibles) |
| `classroom.list` | `classroom:read` | Cours avec rôle, élèves et devoirs |
| `sites.read` | `sites:read` | Pages d'un site et contenu Markdown d'une page |

## Feuille de route des outils

- Prochaines briques : recherche plein texte transverse, `sheets.write`, `slides.write`, outils Formulaires en écriture.
- Les outils destructifs exigent toujours une confirmation littérale (principe : aucun agent ne supprime par accident).

## Sécurité et tests obligatoires

- Jeton révoqué → refus ; scope insuffisant → refus ; autre organisation → refus ; ressource non partagée → refus ; action destructive sans confirmation → refus (à venir avec l'outil).
- Les tests d'intégration démarrent le **vrai serveur MCP** (stdio) contre une base PostgreSQL réelle et vérifient aussi que les refus sont **journalisés**.

## Limites connues

- Pas d'administration exposée au MCP à ce stade ; pas de recherche plein texte (nom uniquement).
- L'API HTTP publique documentée (Phase 6) est un canal distinct, avec sa propre authentification.
