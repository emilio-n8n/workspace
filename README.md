# Workspace

Suite bureautique open source, auto-hébergeable et pensée pour l'ère de l'IA — Drive, Docs, Sheets, Slides, Mail, Calendar, Meet, Chat, Forms, Sites, Tasks, Classroom et une console d'administration — avec un **serveur MCP officiel** permettant à des agents IA autorisés d'utiliser les mêmes applications, avec les mêmes règles de permission.

> **Statut : Phase 0/1 — fondations en construction.** Rien n'est encore utilisable en production. L'avancement réel est suivi dans [ROADMAP.md](ROADMAP.md).

## Principes

- **Une seule suite** : une identité visuelle, une logique d'interaction, des comptes, des fichiers et des permissions partagés.
- **Simplicité et qualité** : des fonctionnalités terminées plutôt qu'une multitude de prototypes.
- **Interopérabilité** : formats ouverts, protocoles standards (CalDAV, JMAP/IMAP, S3), migration facilitée.
- **Autonomie** : chaque organisation peut héberger et administrer sa propre instance ; aucune dépendance obligatoire à un service propriétaire.
- **Sécurité dès la conception** : autorisation côté serveur, isolation des organisations, sessions révocables, journaux d'audit — vérifiable, pas déclarative.
- **IA native** : API publique et serveur MCP officiels, privilèges minimaux, confirmations pour les actions sensibles.

## Stack

TanStack Start · React · TypeScript strict · Tailwind CSS v4 · pnpm workspaces + Turborepo · PostgreSQL · Drizzle ORM · Vitest + Playwright · Docker Compose (self-hosting).

## Structure du dépôt

```
apps/            web (TanStack Start) · mcp-server
packages/        ui · design-tokens · database · auth · permissions · api · storage · config · test-utils
modules/         drive · docs · sheets · … (un package par module fonctionnel)
infrastructure/  docker · deployment
docs/            architecture · decisions · design-system · modules · security · deployment · mcp · studies
```

## Prérequis (développement)

- Node ≥ 22 (testé sur 26)
- pnpm
- PostgreSQL ≥ 16 (testé sur 18)

## Démarrage

En cours de construction (Phase 1). Les instructions exactes (`pnpm install`, migrations, `pnpm dev`) seront documentées ici au fur et à mesure que les fondations sont posées et vérifiées.

## Documentation

- [ROADMAP.md](ROADMAP.md) — phases, priorités, avancement
- `docs/architecture/` — architecture, données, frontières des modules
- `docs/decisions/` — décisions structurantes (ADR)
- `docs/design-system/` — principes visuels et tokens
- `docs/modules/` — contrats et responsabilités des modules
- `docs/security/` — modèle de permissions, menaces, contrôles
- `docs/deployment/` — installation, configuration, mise à jour
- `docs/mcp/` — serveur MCP : outils, autorisations, journalisation
- `docs/studies/` — études comparatives des moteurs (Docs, Sheets, Slides, Mail, Meet)

## Licence

**AGPL-3.0-only** (décision par défaut, voir `docs/decisions/0001-licence.md`) — évaluée pour un produit réseau auto-hébergé ; les licences de toutes les dépendances sont vérifiées avant intégration.

## Sécurité

Aucun secret n'est versionné. La configuration locale vit dans `.env` (ignoré par git) ; un `.env.example` documente les variables. Les failles éventuelles seront signalées selon la procédure décrite dans `docs/security/`.
