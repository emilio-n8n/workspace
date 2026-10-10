# Contrat de module — modèle

> Copier ce squelette pour chaque nouveau module (`docs/modules/<module>.md`). Le contrat est **écrit avant** le développement et fait foi pendant les revues.

## <Module>

- **Statut** : spécifié | en développement | vérifié
- **Propriétaire** : (lead ou sous-agent désigné)
- **Package** : `modules/<module>` (`@workspace/<module>`)
- **Dépendances autorisées** : (packages communs + interfaces d'autres modules, explicitement listées)

### Objectif

Ce que le module apporte, en 2–3 phrases.

### Périmètre

- **MVP** : …
- **Hors périmètre (explicite)** : …
- **Évolutions prévues** : …

### Interfaces publiques

```ts
// Service (appelé par server functions et outils MCP)
export type <Module>Service = {
  // ex. : create(actor, input): Promise<Result>
};
```

- **Server functions** exposées : liste.
- **Événements émis / écoutés** : liste.
- **Recherche** : contribution au fournisseur global (entités indexées, champs).

### Données

- Tables possédées (préfixe, `org_id` obligatoire) : …
- Invariants et contraintes : …
- Migration : référence de la migration initiale.

### Permissions

- Actions et rôles requis (via `packages/permissions`) : …
- Héritage (parents → enfants) : …
- Partage externe : lien, expiration, révocation.

### UI

- Routes et entrées de navigation : …
- États : vide, chargement, erreur, permissions insuffisantes.

### Outils MCP

| Outil | Scopes | Confirmation | Notes |
|---|---|---|---|
| … | … | … | … |

### Tests et critères d'acceptation

- Unitaires (service) : …
- Autorisation : autorisé / refusé sans grant / refusé autre org / expiration / révocation.
- E2E navigateur : parcours vérifié manuellement + Playwright.
- Migration sur base vierge.

### Risques et questions ouvertes

- …
