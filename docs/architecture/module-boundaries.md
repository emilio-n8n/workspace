# Architecture — frontières des modules

> Un module = un package `@workspace/<module>` sous `modules/`. Objectif : permettre un développement parallèle **sans divergence** de style, de données ou de sécurité.

## Anatomie d'un module

```
modules/<module>/
  package.json          @workspace/<module>, privé, workspace:*
  tsconfig.json         étend ../../tsconfig.base.json
  src/
    schema.ts           tables Drizzle du module (préfixées, org_id obligatoire)
    service.ts          logique métier ; entre TOUJOURS par un contrôle d'autorisation
    server.ts           server functions TanStack : validation d'entrée → service
    ui/                 composants React du module (consommés par apps/web)
    mcp.ts              outils MCP : adaptateurs fins vers service.ts
    search.ts           contributions à la recherche globale (optionnel)
    index.ts            manifeste du module (voir ci-dessous)
  test/                 tests unitaires et d'intégration du module
```

## Manifeste de module

Chaque module exporte un manifeste consommé par le registre de `apps/web` :

```ts
export type ModuleManifest = {
  id: string;                    // "drive", "docs"…
  title: string;
  nav?: NavEntry[];              // entrées de navigation
  routes: RouteConfig[];         // routes montées par l'application
  searchProviders?: SearchProvider[];
  mcpTools?: McpTool[];
  service: ModuleService;        // factory recevant les dépendances (db, storage, permissions…)
};
```

`apps/web` ne connaît pas les internes des modules : il monte leur manifeste. Ajouter un module = ajouter une entrée au registre, pas modifier le cœur de l'application.

## Règles non négociables

1. **Autorisation** : chaque point d'entrée de `service.ts` reçoit un `Actor` (utilisateur + organisation + scopes) et vérifie les permissions via `packages/permissions`. Aucun chemin ne contourne le contrôle ; le MCP et l'UI passent par les mêmes services.
2. **Données** : accès uniquement à ses propres tables + les tables cœur via les helpers de `packages/database`. Jamais de `SELECT` direct dans les tables d'un autre module.
3. **Inter-modules** : autorisé uniquement via les interfaces publiques listées dans le contrat du module cible (`docs/modules/`). Toute nouvelle dépendance inter-modules passe par une mise à jour de contrat revue par le lead.
4. **Server functions** : fines — validation (schéma d'entrée), appel du service, sérialisation. Aucune logique métier.
5. **Transactions** : l'orchestration transactionnelle appartient au module qui initie l'opération ; les services exposent leurs opérations composables.
6. **Erreurs** : types d'erreur partagés (`packages/api`) : `not_found`, `forbidden`, `validation`, `conflict`, `rate_limited`, `internal`. Jamais de message interne ou SQL exposé.
7. **Journalisation** : les actions sensibles émettent un événement d'audit (acteur, org, ressource, résultat).

## Propriété et processus

- Chaque module a **un propriétaire unique** (lead ou sous-agent désigné) et un contrat écrit avant tout développement.
- Un sous-agent n'a le droit de modifier que les fichiers de son périmètre (module + son contrat). Les foundations (`packages/*`) sont gelées : toute évolution passe par le lead et un ADR si structurante.
- Avant de rendre un lot : typecheck, lint, tests unitaires, test d'autorisation (refus pour un acteur non autorisé et pour une autre organisation), vérification navigateur des parcours UI.

## Critères de recevabilité d'un module

- [ ] Contrat respecté (interfaces, données, permissions)
- [ ] Aucun fichier hors périmètre modifié
- [ ] Tests : unitaires service + intégration permission (positif et négatif) + isolation organisation
- [ ] Migrations présentes, réversibles (note de rollback), appliquées sur base vierge
- [ ] UI branchée sur des données réelles (pas de données fictives), états chargement/vide/erreur traités
- [ ] Accessibilité clavier de base, tailles d'écran courantes
- [ ] Contract et roadmap mis à jour
