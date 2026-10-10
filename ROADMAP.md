# ROADMAP — Workspace

> Source de vérité de l'avancement. Mise à jour à chaque jalon livré et vérifié.
> Dernière mise à jour : 2026-10-10.

**Légende** : ✅ terminé (vérifié) · ▶ en cours · ○ à venir · ⛔ bloqué

## Phase 0 — Découverte et conception ✅ (terminée le 2026-10-10)

- [x] Inspection du dépôt et de l'environnement (PostgreSQL 18 local, Docker, pnpm, dépôt vide initialisé)
- [x] Documents de référence : README, architecture (vue d'ensemble, monorepo, données, frontières), design system, sécurité, contrats de modules (fondations, Drive, Docs), MCP, déploiement
- [x] ADR 0001–0006 : licence, stack/monorepo, authentification, multi-tenant/permissions, stockage, MCP
- [x] Études moteurs livrées (5/5) : S1 Docs, S2 Sheets, S3 Slides, S4 Mail, S5 Meet (`docs/studies/`)
- [x] ADR moteurs 0007–0011 issus des études (acceptés sous réserve des POC listés dans chaque ADR)
- [x] Critères de preuve du MVP définis (contrats modules + `docs/architecture/`)

## Phase 1 — Fondations ✅ (terminée le 2026-10-10)

Objectif : une fondation vérifiée (auth, données, permissions, stockage, UI de base) sur laquelle les modules s'appuient sans la modifier.

- [x] Monorepo : pnpm workspaces + Turborepo + TypeScript strict + Biome (typecheck/lint/build verts)
- [x] `apps/web` : TanStack Start + shell de navigation (sidebar, topbar, thème clair/sombre persistant)
- [x] `packages/design-tokens` + `packages/ui` : tokens sémantiques, composants de base, 404/erreurs stylées
- [x] `packages/database` : Drizzle, schéma better-auth + cœur, migrations appliquées (14 tables)
- [x] `packages/auth` : better-auth 1.7.7 (organisations, équipes, sessions) + jetons d'API scopés/révocables (6 tests)
- [x] `packages/permissions` : `resource_grants`, refus par défaut, héritage par module (11 tests)
- [x] `packages/storage` : interface + LocalFS atomique + S3-compatible (7 tests)
- [x] `packages/config` : validation d'environnement (zod) + charger `.env` partagé
- [x] Audit de base : table + journalisation MCP (succès/refus/erreurs) et UI « Agents & jetons »
- [x] `infrastructure/docker` : compose PostgreSQL dev + `init-test-db` ; `.env.example`
- [x] CI GitHub Actions : lint, typecheck, tests (dont intégration MCP sur vrai serveur), build, E2E Playwright
- [x] `apps/mcp-server` : transports stdio + HTTP, outils v0 réels (`me.whoami`, `audit.recent`), 3 tests d'intégration

**Preuves** : typecheck 8/8 · 27 tests unitaires/intégration · 6 tests E2E navigateur · build client 109 ko gzip.

## Phase 2 — Premier flux complet (MVP) ▶

Prouver de bout en bout : authentification → stockage → permissions → édition → sauvegarde → partage → agent.

- [▶] Drive : **cœur serveur vérifié** — dossiers, upload/download (checksum, limite de taille), corbeille/restauration/purge avec nettoyage du stockage, versions, partages utilisateur/groupe + héritage, liens révocables (11 tests) ; UI navigateur, aperçu et quotas à venir
- [ ] Docs : Tiptap 3 + Yjs (ADR-0007), autosave, versions + restauration, export/import, partage, intégration Drive
- [ ] MCP v0 : `files.search`, `files.read`, `docs.read` — tests de refus inter-organisations
- [ ] E2E Playwright des critères de preuve MVP (2 organisations, partages, révocations, zéro secret)

## Phase 3 — Suite de productivité ○

Sheets (Univer + pont xlsx maison — ADR-0008), Slides (scène maison hybride — ADR-0009) → Calendar (CalDAV), Tasks, Forms. Intégration navigation, recherche et permissions communes.

## Phase 4 — Communication ○

Mail (Stalwart en sidecar + UI maison JMAP — ADR-0010), Chat, Meet (LiveKit + coturn — ADR-0011). Exigences opérationnelles documentées (DNS, TURN, charge) avant toute promesse fonctionnelle.

## Phase 5 — Éducation et administration avancée ○

Classroom (classes, devoirs, remises, rôles établissement, confidentialité des mineurs), politiques organisationnelles, outils d'administration avancés.

## Phase 6 — MCP, intégrations et maturité ○

Élargissement progressif des outils MCP, API publique documentée, observabilité, sauvegardes testées, préparation à la production.

## Dépendances structurantes

- Les contrats des packages communs doivent être **gelés** avant toute parallélisation de modules fonctionnels (P1 → P2).
- Chaque ADR moteur conditionne son module : S1→Docs, S2→Sheets, S3→Slides, S4→Mail, S5→Meet (POC listés dans les ADR avant développement).
- Le serveur MCP est conçu dès la Phase 1 (contrats) et prototypé en Phase 2 pour influencer les interfaces.

## Risques majeurs suivis

- **Moteurs bureautiques** : fidélité OOXML partielle assumée (Docs/Sheets/Slides) ; POC de conversion exigés avant développement.
- **Mail** : complexité opérationnelle (délivrabilité, spam, DNS) — POC de délivrabilité réelle obligatoire (ADR-0010).
- **Meet** : exigences réseau (TURN) et charge — POC NAT + charge sur 4 cœurs requis (ADR-0011).
- **Performance** : budget de dépendances côté client pour un usage sur machines modestes.
