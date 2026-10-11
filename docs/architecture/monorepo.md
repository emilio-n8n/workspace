# Architecture — monorepo

> Documents liés : `overview.md`, `module-boundaries.md`, ADR-0002, ADR-0012.

## Arborescence

```
apps/
  home/           Portail : lanceur d'applications, compte, jetons (port 3000)
  drive/          Fichiers et dossiers (port 3001)
  docs/           Documents (port 3002)
  tasks/          Tâches et listes (port 3003)
  mcp-server/     Serveur MCP officiel (même couche de services que le web)
packages/
  design-tokens/  Tokens « Papier & encre » + polices auto-hébergées
  ui/             Design system : composants, icônes, shell (rail, barre, palette ⌘K), registre des applications
  database/       Schéma Drizzle cœur, migrations, helpers
  auth/           Sessions, organisations, jetons d'API, requireActor (better-auth)
  permissions/    Rôles, resource_grants, refus par défaut
  api/            Contrats de services, erreurs typées (à venir)
  storage/        Interface de stockage : LocalFS, S3-compatible
  config/         Validation d'environnement, URLs des applications (getAppUrls)
  test-utils/     Utilitaires de test partagés (à venir)
modules/          Un package par module fonctionnel : drive/, docs/, tasks/
infrastructure/   docker/, deployment/ — compose dev et self-host
docs/             architecture/, decisions/, design-system/, modules/, security/, deployment/, mcp/, studies/
e2e/              Tests Playwright multi-applications (racine)
```

## Applications et SSO

- Chaque application est un **serveur TanStack Start indépendant** avec son bundle, monté sur son port (dev) ou son sous-domaine (production).
- Toutes partagent **un seul PostgreSQL et une seule configuration better-auth** ; le gestionnaire `/api/auth/*` est monté dans chaque application.
- **SSO** : cookie de session partagé — en développement `localhost` avec ports différents (les cookies ignorent les ports) ; en production sous-domaines + `BETTER_AUTH_COOKIE_DOMAIN` (+ `trustedOrigins` calculées par `getAppUrls()`).
- Les URLs publiques des applications sont **calculées côté serveur** (`getAppUrls` dans `packages/config`) : ports 3000-3003 en développement, sous-domaines dérivés de `PUBLIC_URL` en production, surcharges explicites `DRIVE_URL` / `DOCS_URL` / `TASKS_URL`.

## Anatomie d'un module

```
modules/<module>/
  src/schema.ts    tables Drizzle du module
  src/service.ts   logique métier (contrôle d'autorisation obligatoire)
  src/server.ts    server functions TanStack (adaptateurs fins)
  src/ui.tsx       barrel d'interface (composants React du module)
  src/export.ts    conversions pures (ex. Docs)
```

Exports : `"."` (schéma + services — sûr pour le MCP), `"./server"` (server functions — pour les applications), `"./ui"` (interface React). Les applications montent ces briques ; aucun accès aux tables d'un autre module.

## Direction des dépendances

```
apps/*      ──►  modules/*  ──►  packages/*        (jamais l'inverse)
apps/*      ──►  packages/ui, packages/auth, packages/config, …
modules/*   ──►  modules/* : uniquement via interfaces publiques déclarées
                (aujourd'hui : docs → drive ; drive → docs est interdit —
                 la création de document depuis Drive passe par une server
                 function de l'application, jamais par le module)
packages/*  ✗──►  modules/* · packages/* ✗──► apps/*
```

## Conventions

- Nommage : `@workspace/*` (packages et modules), `@app/<nom>` (applications).
- TypeScript strict partagé (`tsconfig.base.json`), formatage et lint via **Biome**.
- Orchestration : **Turborepo** (`turbo run build|lint|typecheck|test|dev|generate-routes`).
- Développement : `pnpm dev` démarre les quatre applications (3000-3003).
- Tests : unitaires/intégration par package (`pnpm test`), E2E multi-origines à la racine (`pnpm test:e2e`).
