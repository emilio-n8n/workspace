# ROADMAP — Workspace

> Source de vérité de l'avancement. Mise à jour à chaque jalon livré et vérifié.
> Dernière mise à jour : 2026-10-10.

**Légende** : ✅ terminé (vérifié) · ▶ en cours · ○ à venir · ⛔ bloqué

## Phase 0 — Découverte et conception ✅ (terminée le 2026-10-10)

- [x] Inspection du dépôt et de l'environnement
- [x] Documents de référence : README, architecture (vue d'ensemble, monorepo, données, frontières), design system, sécurité, contrats de modules, MCP, déploiement
- [x] ADR 0001–0006 : licence, stack/monorepo, authentification, multi-tenant/permissions, stockage, MCP
- [x] Études moteurs livrées (5/5) : S1 Docs, S2 Sheets, S3 Slides, S4 Mail, S5 Meet
- [x] ADR moteurs 0007–0011 issus des études (acceptés sous réserve des POC listés)

## Phase 1 — Fondations ✅ (terminée le 2026-10-10)

- [x] Monorepo pnpm + Turborepo + TypeScript strict + Biome
- [x] `apps/web` : TanStack Start + shell de navigation + thème clair/sombre
- [x] `packages/design-tokens` + `packages/ui` (boutons, champs, dialogues, cartes — tokens uniquement)
- [x] `packages/database` : schéma better-auth + cœur, migrations appliquées
- [x] `packages/auth` : sessions, organisations, équipes, jetons d'API scopés
- [x] `packages/permissions` : `resource_grants`, refus par défaut, héritage (11 tests)
- [x] `packages/storage` : LocalFS atomique + S3-compatible (7 tests)
- [x] `packages/config` : validation d'environnement (zod) + chargement `.env`
- [x] CI GitHub Actions (lint, typecheck, tests, build, E2E) + compose PostgreSQL dev
- [x] `apps/mcp-server` : stdio + HTTP, audit, outils v0

## Phase 2 — Premier flux complet (MVP) ▶

Prouver de bout en bout : authentification → stockage → permissions → édition → sauvegarde → partage → agent.

- [x] Drive — cœur : dossiers, upload/download (checksum, limite), corbeille/restauration/purge avec nettoyage du stockage, versions, partages + héritage, liens révocables (11 tests)
- [x] Drive — interface : navigateur, glisser-déposer, dialogues (dossier/document/renommage/partage/détails), corbeille, page publique `/s/$token`
- [x] Docs — cœur : autosave (`replace-latest`) + instantanés (`append`), permissions mappées sur Drive, exports Markdown/HTML, conversions testées
- [x] Docs — éditeur Tiptap 3 (StarterKit) : barre d'outils, statut d'enregistrement, historique des versions, lecture seule pour les viewers
- [x] MCP v1 : `files.search`, `files.read`, `docs.read` — refus sans scope et isolation inter-organisations testés
- [▶] E2E des critères de preuve MVP : parcours Drive/Docs + partage réel entre deux comptes avec révocation (vérification en cours)

## Phase 3 — Suite de productivité ○

Sheets (Univer + pont xlsx maison — ADR-0008), Slides (scène maison hybride — ADR-0009) → Calendar (CalDAV), Tasks, Forms. Intégration navigation, recherche et permissions communes. Collaboration temps réel Docs (Yjs/Hocuspocus). MCP étendu (`docs.create/update`, `files.write/delete`, recherche plein texte).

## Phase 4 — Communication ○

Mail (Stalwart en sidecar + UI maison JMAP — ADR-0010), Chat, Meet (LiveKit + coturn — ADR-0011). Exigences opérationnelles documentées (DNS, TURN, charge) avant toute promesse fonctionnelle.

## Phase 5 — Éducation et administration avancée ○

Classroom (classes, devoirs, remises, confidentialité des mineurs), politiques organisationnelles, administration avancée, fédération OIDC/MFA.

## Phase 6 — MCP, intégrations et maturité ○

Élargissement des outils MCP, API publique documentée, observabilité, sauvegardes testées, image Docker de production, préparation à la production.

## Dépendances structurantes

- Les contrats des packages communs sont gelés (P1 ✅) ; les modules Phase 3 s'y appuient sans les modifier.
- Chaque ADR moteur conditionne son module (POC listés avant développement).
- Le serveur MCP utilise exclusivement les services de modules — toute nouvelle capacité passe par eux.

## Risques majeurs suivis

- **Moteurs bureautiques** : fidélité OOXML partielle assumée ; POC de conversion exigés avant développement (Docs/Sheets/Slides).
- **Mail / Meet** : complexité opérationnelle — POC de délivrabilité et NAT/charge obligatoires (ADR-0010/0011).
- **Performance** : budget de dépendances côté client (Tiptap ajouté en Phase 2 — à mesurer sur le bundle).
