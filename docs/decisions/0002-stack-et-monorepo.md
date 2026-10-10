# ADR-0002 — Stack et organisation du monorepo

**Statut** : accepté
**Date** : 2026-10-10

## Contexte

La suite couvre à terme une quinzaine d'applications qui doivent partager comptes, fichiers, permissions, design et recherche. Il faut un socle technique unique, performant sur machines modestes, entièrement auto-hébergeable (aucune dépendance à un PaaS), et productif pour un développement mené en grande partie par des agents.

## Décision

- **TanStack Start** (React, SSR, server functions typées, routage typé) comme cadre applicatif unique — plutôt que Next.js afin d'éviter tout couplage à un fournisseur d'hébergement et de garder un build Vite standard.
- **React + TypeScript strict** (options renforcées partagées dans `tsconfig.base.json`).
- **Tailwind CSS v4** (configuration CSS-first) avec **tokens sémantiques** dans `packages/design-tokens`.
- **pnpm workspaces + Turborepo** pour le monorepo.
- **PostgreSQL + Drizzle ORM** (schéma typé, migrations versionnées) — pas d'ORM propriétaire ni de dépendance à un BaaS.
- **Biome** pour format + lint (un seul outil rapide) ; ESLint ajoutable plus tard si un plugin le justifie.
- **Vitest** (unitaire/intégration) et **Playwright** (E2E navigateur) — ajoutés en Phase 1.
- **Monolithe modulaire** : `apps/*` (web, mcp-server), `packages/*` (fondations), `modules/*` (applications fonctionnelles). Aucune séparation en services sans contrainte concrète.

## Conséquences

- Positif : build et déploiement sous notre contrôle total ; cohérence des types de la base au navigateur ; démarrage rapide ; agents outillés par des conventions claires.
- Négatif : écosystème de composants moins dense que Next.js ; versions très récentes de l'outillage (TS 6, Vite 8) à suivre activement ; certaines intégrations nécessiteront du travail maison.
- Règle : toute nouvelle dépendance doit être justifiée (licence, self-host, maintenance, poids) et passer par un ADR si structurante.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Next.js | Couplage culturel et pratique à Vercel ; server actions moins explicites pour nos contrats ; poids |
| Remix / React Router framework | Moins adapté au modèle « server functions + modules » visé ; migration en cours d'écosystème |
| NestJS + front séparé | Deux stacks à maintenir, duplication des contrats, plus lourd à auto-héberger |
| Microservices dès le départ | Complexité opérationnelle prématurée (brief §4.1) |
