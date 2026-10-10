# Architecture — monorepo

> Documents liés : `overview.md`, `module-boundaries.md`, ADR-0002.

## Arborescence

```
apps/
  web/            Application principale (TanStack Start) — routes, shell, montage des modules
  mcp-server/     Serveur MCP officiel (même couche de services que le web)
packages/
  design-tokens/  Tokens visuels sémantiques (CSS variables + @theme Tailwind v4)
  ui/             Composants React partagés (à venir — Phase 1)
  database/       Schéma Drizzle, migrations, helpers de transaction (à venir)
  auth/           Sessions et comptes (better-auth), intégration serveur (à venir)
  permissions/    Rôles, resource_grants, politique de refus par défaut (à venir)
  api/            Contrats de services, erreurs typées, helpers server functions (à venir)
  storage/        Interface de stockage : LocalFS, S3-compatible (à venir)
  config/         Validation d'environnement, constantes, logger (à venir)
  test-utils/     Utilitaires de test partagés (à venir)
modules/          Un package par module fonctionnel (drive/, docs/, sheets/…)
infrastructure/   docker/, deployment/ — compose dev et self-host
docs/             architecture/, decisions/, design-system/, modules/, security/, deployment/, mcp/, studies/
```

Règle : on ne crée pas de package vide. Un package apparaît quand il porte du code réel et testé.

## Conventions

- Nommage : `@workspace/<nom>`, tous privés, versionnés par le monorepo (`workspace:*`).
- TypeScript strict partagé (`tsconfig.base.json`), formatage et lint via **Biome** (racine).
- Orchestration : **Turborepo** (`turbo run build|lint|typecheck|test|dev`).
- Node ≥ 22 ; pnpm ≥ 12 (voir `packageManager`).

## Direction des dépendances

```
apps/*   ──►  modules/*  ──►  packages/*  ──►  (aucune dépendance remontante)
apps/*   ──►  packages/*            modules/* ✗──► modules/*   (interdit sauf interface publique déclarée)
packages/* ✗──► modules/*           packages/* ✗──► apps/*
```

- Un module ne lit jamais les tables d'un autre module : il passe par son service public.
- Les appels inter-modules autorisés sont listés dans les contrats (`docs/modules/`), et évoluent par ADR si nécessaire.
- `apps/web` assemble : chaque module expose un **manifeste** (routes, entrées de navigation, fournisseurs de recherche, outils MCP, factory de service) consommé par le registre de l'application.

## Tâches standard d'un package

| Script | Rôle |
|---|---|
| `build` | Compilation si nécessaire (beaucoup de packages sont consommés en source par Vite) |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest (unitaire) — les tests d'intégration vivent aussi ici |
| `lint` | Réservé ; le lint global passe par Biome à la racine |

## Ajouter un package ou un module

1. Lire `docs/architecture/module-boundaries.md` et les contrats existants.
2. Créer `packages/<nom>/` ou `modules/<nom>/` avec `package.json` (`@workspace/<nom>`), `tsconfig.json` étendant la base, et son entrée `src/index.ts`.
3. Ajouter le contrat dans `docs/modules/` (objectif, interfaces, données, permissions, tests d'acceptation).
4. Mettre à jour la roadmap si l'échéancier change.
