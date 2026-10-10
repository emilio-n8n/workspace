# Architecture — vue d'ensemble

> Document de référence. Toute modification d'architecture structurante passe par un ADR (`docs/decisions/`).

## Objectifs et contraintes

- **Auto-hébergement** : l'ensemble fonctionne sur une infrastructure contrôlée par l'organisation (Docker Compose), sans dépendance obligatoire à un service propriétaire.
- **Monolithe modulaire** : une seule application déployable au départ ; chaque module a des responsabilités, des données et des interfaces explicites. On ne sépare un processus que sur contrainte réelle (mail, Meet, sidecars bureautiques…).
- **Cohérence** : un design system unique, des permissions uniques, une recherche unifiée.
- **Sécurité** : autorisation côté serveur, isolation des organisations, sessions révocables, journaux d'audit ; aucune décision de sécurité fondée sur l'UI.
- **Performance** : budget de dépendances volontairement contraint côté client ; cible : usage confortable sur machines modestes.
- **IA native** : serveur MCP officiel s'appuyant sur **les mêmes services métier** que l'application, avec les mêmes contrôles d'accès.

## Composants

```
┌────────────────────────── apps/web (TanStack Start) ─────────────────────────┐
│  routes / UI (React)         server functions (createServerFn)              │
│  └─ composent les modules ─┘ └─ fines, délèguent aux services de module ─┘  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ services partagés (packages/*)
        ┌──────────────────────────────┼──────────────────────────────┐
        │ packages/auth (sessions)     │ packages/permissions (ACL)   │
        │ packages/storage (fichiers)  │ packages/database (Drizzle)  │
        └──────────────────────────────┴──────────────────────────────┘
                                       │
              PostgreSQL (métadonnées) ┘ └ stockage objet/local (binaires)

┌──────────────────────── apps/mcp-server ────────────────────────┐
│  outils MCP → mêmes services de module, avec un « Actor »       │
│  utilisateur + scopes, jetons révocables, journal d'audit       │
└──────────────────────────────────────────────────────────────────┘
```

- **`apps/web`** : SSR + routage TanStack Start. La logique métier n'y vit pas : les server functions sont des adaptateurs fins (validation d'entrée → appel service → réponse sérialisable).
- **`apps/mcp-server`** : processus séparé (stdio + HTTP), mais aucune duplication de logique : il importe les mêmes services de module.
- **`packages/*`** : fondations transverses (auth, permissions, stockage, base de données, UI, config). Un module ne peut pas les contourner.
- **`modules/*`** : un package par application fonctionnelle (Drive, Docs, Sheets…), propriétaire de son schéma, de ses services, de son UI et de ses outils MCP.

## Flux d'une requête

1. Le navigateur appelle une **server function** (ou une route `/api/*` pour les appelants externes).
2. La fonction identifie l'**Actor** : session utilisateur (better-auth) ou jeton MCP scopé.
3. Le service de module vérifie l'**autorisation** (`packages/permissions` — refus par défaut), puis exécute la logique.
4. Accès aux données uniquement via `packages/database` (Drizzle) ; accès aux binaires uniquement via `packages/storage` (interface interchangeable LocalFS / S3).
5. Les actions sensibles écrivent un **événement d'audit** ; les notifications s'appuient sur un bus d'événements interne.

## Endpoints externes

Les server functions couvrent la logique applicative interne. Les routes `/api/*` ne servent qu'aux appelants externes (webhooks, callbacks OAuth, intégrations) et **vérifient elles-mêmes** leur appelant (signature, secret, clé API) — masquer une route ne protège rien.

## Données et frontières

- Le modèle de données cœur (utilisateurs, organisations, groupes, permissions, fichiers, audit) est défini dans `docs/architecture/data-model.md`.
- Les frontières et règles d'import sont définies dans `docs/architecture/module-boundaries.md`.
- Chaque module documente son contrat dans `docs/modules/<module>.md`.

## Sécurité et exploitation

- Modèle de menaces et contrôles : `docs/security/`.
- Installation, mise à jour, sauvegardes : `docs/deployment/`.
- Les décisions structurantes sont tracées en ADR (`docs/decisions/`).

## Décisions applicables

- ADR-0001 (licence) · ADR-0002 (stack et monorepo) · ADR-0003 (authentification) · ADR-0004 (multi-tenant et permissions) · ADR-0005 (stockage) · ADR-0006 (MCP).
