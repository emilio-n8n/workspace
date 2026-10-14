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
- [x] E2E des critères de preuve MVP : parcours Drive/Docs/Tasks + partage réel entre deux comptes avec révocation — **10/10 verts (multi-applications, SSO inclus)**
- [x] **Refonte multi-applications** (ADR-0012) : accueil (lanceur), Drive, Docs et Tasks en applications isolées, SSO par cookie partagé, rail d'applications, sélecteur d'organisation, palette ⌘K — design system v2 « Papier & encre », polices auto-hébergées, thème sombre complet

## Phase 3 — Suite de productivité ▶

- [x] Tasks : listes partagées, tâches (échéances, priorités, statuts, assignation), filtres, ajout rapide, partage par membre — 8 tests + E2E navigateur ; MCP `tasks.lists` / `tasks.list` / `tasks.create` (2 tests d'intégration)
- [x] Calendar : agendas personnels et d'organisation, invitations et réponses, vues mois/semaine — 16 tests ; **CalDAV reste un chantier dédié** (documenté hors périmètre)
- [x] Forms : questions (5 types), lien public `/f/<slug>`, réponses stables (identifiants de question conservés), export CSV sûr — 15 tests
- [x] Sheets : moteur de formules natif (SUM/AVG/MIN/MAX/COUNT, erreurs typées, plages bornées) — **ADR-0014** ; Univer reste candidat pour le collaboratif — tests moteur + service
- [x] Slides : zones de texte et formes, glisser-déposer, révision optimiste, mode présentation — tests service
- [ ] Collaboration temps réel (Yjs/Hocuspocus) — chantier dédié, non bloquant
- [x] MCP étendu : **20 outils** (calendar, forms, sheets, slides, chat, mail, classroom, sites ajoutés) ; écritures Docs/Drive et recherche plein texte restent à venir

## Phase 4 — Communication ○

- [x] Mail : boîtes locales, SMTP sortant (erreurs jamais silencieuses), ingestion entrante par webhook idempotent — **pas d'IMAP client en v1 (ADR-0013)** ; Stalwart/JMAP reste l'option documentée (ADR-0010) pour aller plus loin
- [x] Chat : canaux et discussions directes, non-lus (requête agrégée unique) — temps réel WebSocket en chantier dédié
- [x] Meet : salles et liens, jeton LiveKit signé serveur, média optionnel (ADR-0011) — exigences réseau (TURN, DNS) toujours à documenter avant promesse grand public

## Phase 5 — Éducation et administration avancée ○

- [x] Classroom : cours à code d'accès (8 caractères non biaisés), devoirs, copies, notation stricte (notes conservées)
- [x] Sites : pages Markdown, rendu HTML sûr (code opaque, liens allowlist)
- [x] Admin : profil d'organisation, membres et rôles (propriétaire protégé), quota de stockage, journal d'audit réservé owner/admin
- [ ] Confidentialité des mineurs, fédération OIDC/MFA — chantiers dédiés

## Phase 6 — MCP, intégrations et maturité ○

Élargissement des outils MCP, API publique documentée, observabilité, sauvegardes testées, image Docker de production, préparation à la production.

## Dépendances structurantes

- Les contrats des packages communs sont gelés (P1 ✅) ; les modules Phase 3 s'y appuient sans les modifier.
- Vague qualité « L11 » (2026-10-11) : 3 audits sévères (~260 constats consignés dans `docs/audits/`), 10 escouades de correction, contraste WCAG **calculé** (`pnpm check:design`, 26/26 paires), lois de layout dérivées (`docs/design-system/layout-laws.md`).
- Vague « Excellence » (2026-10-12) : trace d'audit des mutations web (`@workspace/audit`), `/api/health` sur les 14 apps, verrous optimistes Docs, Drive sans N+1 + index trigram, **recherche globale** (`@workspace/search`), import CSV Sheets, MCP v2 (confirmation destructive), adoption des primitives UI, `pnpm seed:demo`, déploiement Vercel documenté (14 projets, SSO par domaine).

- Vague « la suite » (2026-10-12) : recherche globale en direct dans la palette ⌘K (14 apps), Chat temps réel SSE, images Slides, rétention des versions + partage externe réellement appliqués, rate limiting des surfaces publiques, portes axe/WCAG en E2E, dashboard « Reprendre » + raccourcis, « Mes tâches » transverses, sessions actives (Admin), impression propre des Docs, nettoyage d'indexes — **291 tests / 20 suites**.- Chaque ADR moteur conditionne son module (POC listés avant développement).

- Vague « produit complet » (2026-10-12) : notifications (cœur + cloche dans les 14 apps), commentaires Docs (fils/résolution), MCP `files.write`/`files.delete` (confirmation destructive), Admin → Politiques réglables, récurrences Calendar + salle Meet en un clic, fils de discussion Mail, visionneuse Drive (images/PDF/texte), démarrage guidé, PWA installable (Accueil + Drive), alignement/extension E2E — **322 tests / 21 suites**.- Le serveur MCP utilise exclusivement les services de modules — toute nouvelle capacité passe par eux.

- Vagues « excellence opérationnelle » et « temps réel » (2026-10-13) : audit web exhaustif (10 modules), recherche plein texte française avec dossiers, pièces jointes Mail/Chat, conformité RGPD (export/effacement), mise en forme Sheets, impression Slides, **collaboration Docs temps réel (Yjs : serveur dédié + client Tiptap, dégradation locale propre)**, restauration de versions Docs.
- Vague « collaboration & confort » (2026-10-13) : notifications temps réel (SSE par organisation et utilisateur, cloche instantanée avec repli polling), historique des versions Docs (aperçu, restauration auditée), pièces jointes aux rendus Classroom.
- Vague « agents & propreté » (2026-10-13) : 29 outils MCP (versions Docs: lister/restaurer), polling de notifications unifié sur le SSE, page d'audit admin filtrable et paginée.
- Armada « 200 missions » (2026-10-14, ~100 livrées) : refonte des 14 apps au niveau produit (landing, Drive, Docs éditeur, Sheets, Slides, Calendar, Tasks, Forms, Mail, Chat, Meet, Sites, Classroom, design system), 29 outils MCP, notifications SSE, correctifs produit majeurs (classroom inter-organisations, crash navigateur Sheets). Rapport complet : docs/RAPPORT-ARMADA.md. Refonte Slides : mises en page avec zones à remplir (« Cliquez pour ajouter un titre »), édition du texte en place sur la diapositive, mise en forme complète (gras, italique, souligné, couleurs sémantiques, tailles par paliers), formes consolidées et clavier étendu (flèches/Entrée/Suppr).
## Risques majeurs suivis

- **Moteurs bureautiques** : fidélité OOXML partielle assumée ; POC de conversion exigés avant développement (Docs/Sheets/Slides).
- **Mail / Meet** : complexité opérationnelle — POC de délivrabilité et NAT/charge obligatoires (ADR-0010/0011).
- **Performance** : budget de dépendances côté client (Tiptap ajouté en Phase 2 — à mesurer sur le bundle).
