# ROADMAP — Workspace

> Source de vérité de l'avancement. Mise à jour à chaque jalon livré et vérifié.
> Dernière mise à jour : 2026-10-10.

**Légende** : ✅ terminé (vérifié) · ▶ en cours · ○ à venir · ⛔ bloqué

## Phase 0 — Découverte et conception ▶

- [x] Inspection du dépôt et de l'environnement (PostgreSQL 18 local opérationnel, groupe Docker configuré, pnpm installé, dépôt vide initialisé)
- [▶] Documents de référence : README, architecture, ADRs, design system, sécurité, contrats modules, MCP, déploiement
- [▶] Études moteurs (sous-agents parallèles) → `docs/studies/` :
  - [▶] S1 — Docs (`docs-engine.md`)
  - [▶] S2 — Sheets (`sheets-engine.md`)
  - [▶] S3 — Slides (`slides-engine.md`)
  - [▶] S4 — Mail (`mail-stack.md`)
  - [▶] S5 — Meet (`meet-engine.md`)
- [ ] ADRs moteurs issus des études (Docs, Sheets, Slides, Mail, Meet)
- [ ] Critères de preuve du MVP consolidés (dans `docs/architecture/` et contrats de modules)

## Phase 1 — Fondations ○

Objectif : une fondation vérifiée (auth, données, permissions, stockage, UI de base) sur laquelle les modules s'appuient sans la modifier.

- [ ] Monorepo : pnpm workspaces + Turborepo + TypeScript strict + Biome
- [ ] `apps/web` : TanStack Start, shell de navigation global
- [ ] `packages/design-tokens` + `packages/ui` : tokens sémantiques, clair/sombre, composants de base
- [ ] `packages/database` : Drizzle, schéma cœur, migrations (vérifiées sur PostgreSQL local)
- [ ] `packages/auth` : better-auth (sessions révocables, organisations, invitations)
- [ ] `packages/permissions` : rôles, `resource_grants`, refus par défaut, tests
- [ ] `packages/storage` : abstraction + LocalFS + S3-compatible
- [ ] `packages/config` : validation d'environnement ; journalisation + audit de base
- [ ] `infrastructure/docker` : compose dev + squelette self-host, `.env.example` (sans secret)
- [ ] CI : typecheck / lint / tests (aucun déploiement)
- [ ] `apps/mcp-server` : squelette (jetons scopés et révocables, audit)

## Phase 2 — Premier flux complet (MVP) ○

Prouver de bout en bout : authentification → stockage → permissions → édition → sauvegarde → partage → agent.

- [ ] Drive : fichiers/dossiers, upload/download, aperçu, partage utilisateur/groupe, liens révocables, corbeille, versions v1, recherche, quotas
- [ ] Docs : éditeur (moteur selon S1), autosave, versions + restauration, export/import, partage, intégration Drive
- [ ] MCP v0 : `files.search`, `files.read`, `docs.read` — tests de refus inter-organisations
- [ ] E2E Playwright des critères de preuve MVP (2 organisations, partages, révocations, zéro secret)

## Phase 3 — Suite de productivité ○

Sheets, Slides (moteurs selon S2/S3) → Calendar (CalDAV), Tasks, Forms. Intégration navigation, recherche et permissions communes.

## Phase 4 — Communication ○

Mail (référence : S4 — intégration d'un serveur éprouvé, UI au-dessus de JMAP/IMAP), Chat, Meet (référence : S5 — LiveKit ou équivalent). Exigences opérationnelles documentées (DNS, TURN, charge) avant toute promesse fonctionnelle.

## Phase 5 — Éducation et administration avancée ○

Classroom (classes, devoirs, remises, rôles établissement, confidentialité des mineurs), politiques organisationnelles, outils d'administration avancés.

## Phase 6 — MCP, intégrations et maturité ○

Élargissement progressif des outils MCP, API publique documentée, observabilité, sauvegardes testées, préparation à la production.

## Dépendances structurantes

- Les contrats des packages communs doivent être **gelés** avant toute parallélisation de modules fonctionnels.
- S1 requis avant le module Docs ; S2 avant Sheets ; S3 avant Slides ; S4 avant Mail ; S5 avant Meet.
- Le serveur MCP est conçu dès la Phase 1 (contrats) et prototypé en Phase 2 pour influencer les interfaces.

## Risques majeurs suivis

- **Moteurs bureautiques** : fidélité OOXML et effort d'intégration réels à mesurer (études S1–S3).
- **Mail** : complexité opérationnelle (délivrabilité, spam, DNS) — intégration d'un composant éprouvé plutôt que reconstruction (S4).
- **Meet** : exigences réseau (TURN) et de charge à valider avant promesse « complète » (S5).
- **Performance** : budget de dépendances côté client pour un usage sur machines modestes.
