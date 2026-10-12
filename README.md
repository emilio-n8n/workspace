# Workspace

Suite bureautique open source, auto-hébergeable et pensée pour l'ère de l'IA — **une suite, plusieurs applications** : Drive, Docs et Tasks aujourd'hui ; Sheets, Slides, Mail, Calendar, Meet, Chat, Forms, Sites, Classroom et administration selon la [roadmap](ROADMAP.md). Un **serveur MCP officiel** permet à des agents IA autorisés d'utiliser les mêmes données avec les mêmes permissions.

> **Statut : MVP en cours de finalisation.** Les fondations (comptes, organisations, permissions, stockage, MCP) sont livrées et testées ; l'avancement réel est suivi dans [ROADMAP.md](ROADMAP.md).

## Applications

| Application | Port (dev) | Contenu |
|---|---|---|
| **Accueil** | 3000 | Portail, compte, lanceur, jetons d'API, stockage |
| **Drive** | 3001 | Fichiers, dossiers, partages, liens révocables, corbeille, versions |
| **Docs** | 3002 | Éditeur riche (Tiptap 3), autosave, versions, export Markdown/HTML |
| **Tasks** | 3003 | Listes partagées, échéances, priorités, assignations |
| **Calendar** | 3004 | Agendas personnels et d'organisation, invitations, réponses |
| **Forms** | 3005 | Formulaires, page publique, réponses, export CSV |
| **Sheets** | 3006 | Tableur, onglets, formules (SUM/AVG/MIN/MAX/COUNT), export CSV |
| **Slides** | 3007 | Présentations, zones de texte et formes, plein écran |
| **Mail** | 3008 | Boîtes locales, SMTP sortant, ingestion webhook, dossiers |
| **Chat** | 3009 | Canaux et discussions directes, non-lus |
| **Meet** | 3010 | Salles et liens, média LiveKit optionnel |
| **Sites** | 3011 | Sites internes en Markdown rendu en HTML sûr |
| **Classroom** | 3012 | Cours, devoirs, copies, notation |
| **Admin** | 3013 | Profil d'organisation, membres, quota, journal d'audit |

Le **SSO est natif** : une connexion sur l'accueil donne accès à toutes les applications (cookie de session partagé). En développement, les applications partagent `localhost` sur des ports différents ; en production, elles vivent sur des sous-domaines (`drive.exemple.org`…).

## Principes

- **Une seule suite** : une identité visuelle (« Papier & encre »), des comptes, des fichiers et des permissions partagés, un registre d'applications unique.
- **Simplicité et qualité** : des fonctionnalités terminées plutôt que des prototypes.
- **Autonomie** : chaque organisation héberge sa propre instance ; aucune dépendance obligatoire à un service propriétaire.
- **Sécurité dès la conception** : autorisation serveur, isolation des organisations, sessions révocables, journal d'audit.
- **IA native** : serveur MCP officiel, jetons scopés et révocables, mêmes règles de permission que l'interface.

## Stack

TanStack Start · React · TypeScript strict · Tailwind CSS v4 · pnpm + Turborepo · PostgreSQL · Drizzle ORM · better-auth · Vitest + Playwright · Docker Compose.

## Démarrage (développement)

Prérequis : Node ≥ 22, pnpm ≥ 12, PostgreSQL ≥ 16 (18 recommandé).

```bash
pnpm install
cp .env.example .env        # renseigner DATABASE_URL / SESSION_SECRET
pnpm db:migrate             # schéma cœur + les 13 modules, dans un ordre déterministe
pnpm dev                    # démarre les 14 applications (3000-3013)
```

Vérifications :

```bash
pnpm typecheck              # TypeScript strict, tous les packages
pnpm test                   # unitaires + intégration (PostgreSQL requis)
pnpm test:e2e               # Playwright multi-applications (SSO inclus)
pnpm build                  # builds de production des applications
pnpm check:design           # contraste WCAG des tokens (calculé, OKLCH→sRGB)
pnpm seed:demo              # jeu de démonstration complet (compte demo@exemple.org)
```

## Serveur MCP

```bash
WORKSPACE_TOKEN=wsk_… pnpm --filter @workspace/mcp-server start
```

Les jetons se créent dans l'application (Accueil → Agents & jetons) avec des scopes minimaux (`drive:read`, `docs:read`, `tasks:write`…), expirent par défaut après 90 jours et sont réservés aux administrateurs pour le scope `audit:read`. **25 outils** couvrent la suite ; les outils destructifs exigent une confirmation littérale. Chaque appel est journalisé (succès, refus, erreurs), et **toutes les mutations web sont auditées** (`@workspace/audit`). Détails : `docs/mcp/`.

## Structure du dépôt

```
apps/        home · drive · docs · tasks · calendar · forms · sheets · slides · mail · chat · meet · sites · classroom · admin · mcp-server
packages/    design-tokens · ui · database · auth · permissions · storage · config · audit · search
modules/     drive · docs · tasks · calendar · forms · sheets · slides · mail · chat · meet · sites · classroom · admin
             (services + server functions + interface)
e2e/         tests de bout en bout multi-applications
docs/        architecture · decisions · design-system · modules · security · deployment · mcp · studies
```

## Documentation

- [ROADMAP.md](ROADMAP.md) — phases et avancement réel
- `docs/architecture/` — vue d'ensemble, monorepo, données, frontières des modules
- `docs/decisions/` — ADR 0001-0012 (licence, stack, auth, permissions, multi-applications…)
- `docs/design-system/` — « Papier & encre » : tokens, typographies, shell
- `docs/modules/` — contrats et critères d'acceptation par module
- `docs/security/` — modèle de permissions, menaces, contrôles
- `docs/deployment/` — installation et exploitation auto-hébergée
- `docs/mcp/` — serveur MCP : outils, scopes, audit

## Licence

**AGPL-3.0-only** (décision de référence, ADR-0001). Les licences de toutes les dépendances sont vérifiées ; les polices (Public Sans, Bricolage Grotesque) sont sous OFL et auto-hébergées.

## Sécurité

Aucun secret versionné : la configuration locale vit dans `.env` (ignoré par git), documentée par `.env.example`. Toute opération sensible est vérifiée côté serveur ; les refus sont journalisés.
