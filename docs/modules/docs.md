# Contrat — Docs

- **Statut** : spécifié (développement en Phase 2 ; moteur selon étude S1 → ADR-0007)
- **Propriétaire** : à désigner au lancement de la Phase 2
- **Package** : `modules/docs` (`@workspace/docs`)
- **Dépendances autorisées** : `packages/database`, `packages/permissions`, `packages/api`, `packages/ui`, interface publique de `modules/drive` (ranger/lister un document comme un fichier).

## Objectif

Édition de documents riche mais sobre : rédiger, structurer, partager, versionner, exporter. Le document est le **prolongement naturel d'un fichier Drive** : même arborescence, mêmes partages, mêmes recherches.

## Décision moteur (en attente d'ADR)

L'étude S1 recommande **Tiptap 3 (ProseMirror, MIT) + Yjs/Hocuspocus (MIT)** en option C : éditeur embarqué, collaboration temps réel progressive, conversion (`docx` à l'export, `mammoth` durci à l'import), Pandoc et LibreOffice en sidecars pour les formats avancés. L'ADR-0007 confirmera ce choix avant le développement.

## Périmètre

- **MVP** : créer/renommer/supprimer (corbeille Drive), édition riche (titres, gras/italique, listes, citations, blocs de code, tableaux simples, liens, images par référence Drive), autosave (debounce + indicateur d'état), versions (snapshots espacés + restauration), export Markdown/HTML/DOCX, partage (via Drive/permissions), ouverture depuis Drive.
- **Hors périmètre MVP** : collaboration temps réel (Phase 3, après stabilisation du stockage de contenu), commentaires, suggestions, historique ligne à ligne.
- **Évolutions** : Yjs/Hocuspocus (curseurs, présence), commentaires ancrés, modèles, publication web (via Sites).

## Interfaces publiques (esquisse)

```ts
export type DocsService = {
  create(actor, { title, parentFolderId? }): Promise<Document>;   // crée aussi l'entrée Drive
  get(actor, docId): Promise<Document>;
  list(actor, { parentId?, query?, page }): Promise<Page<DocumentMeta>>;
  save(actor, docId, { content, baseVersion }): Promise<{ version: number }>; // conflit → ConflictError
  listVersions(actor, docId): Promise<DocVersion[]>;
  restoreVersion(actor, docId, versionId): Promise<Document>;
  export(actor, docId, format: "md" | "html" | "docx"): Promise<{ stream; contentType; name }>;
  import(actor, { parentFolderId?, name, stream, format }): Promise<Document>;
};
```

- **Événements émis** : `document.updated` (alimente recherche/notifications/audit).
- **Recherche** : titre + contenu texte (extraction depuis le JSON ProseMirror), v1.

## Données

- Tables : `docs_documents` (titre, `file_id` Drive, version courante, propriétaire), `docs_content_versions` (JSON ProseMirror, taille, auteur, raison : autosave | manuel | restauration).
- Le binaire « export » n'est **pas** la vérité : la vérité est le JSON versionné (+ le fichier Drive associé pour la cohérence de l'arborescence).
- Conflits : concurrence optimiste par numéro de version ; politique MVP = prévenir l'utilisateur, pas de fusion silencieuse.

## Permissions

- Actions mappées sur `resource_grants` du fichier Drive associé (`resource_type = 'file'`) : `viewer` (lecture + export), `commenter` (à venir), `editor` (édition), `owner` (partage/suppression).
- Les outils MCP respectent exactement ces rôles.

## UI

- Route `/docs/$docId` (zone plein écran, barre de contexte minimale) ; création depuis `/drive` (« Nouveau → Document ») et depuis Home.
- États : sauvegarde en cours/sauvegardé/erreur, conflit de version, document vide (gabarits légers), permissions insuffisantes (lecture seule explicite).

## Outils MCP (v0 Phase 2)

| Outil | Scopes | Confirmation |
|---|---|---|
| `docs.read` (texte extrait) | `docs:read` | non |
| `docs.list` | `docs:read` | non |
| `docs.create` / `docs.update` (Phase 3) | `docs:write` | non |

## Tests et critères d'acceptation

- Cycle : créer → éditer (formatage riche) → autosave → recharger (contenu identique) → 2 versions visibles → restaurer.
- Conflit : deux onglets, sauvegarde concurrente → le second reçoit un conflit explicite, aucune perte silencieuse.
- Export/import : MD et HTML aller-retour sans perte des structures MVP ; DOCX exporté s'ouvre dans LibreOffice (vérification manuelle).
- Permissions : `viewer` ne peut pas éditer (UI **et** serveur) ; isolation multi-organisations testée ; MCP refusé sans scope.
- E2E Playwright : parcours nominal + état lecture seule.

## Risques et questions ouvertes

- Fidélité DOCX : mesurée par un corpus de test (S1 §6) — communiquer honnêtement les limites.
- Images dans les documents : référence Drive (droits hérités) vs copie — décision à POC.
- Coût de l'autosave : fréquence et taille des snapshots à calibrer (delta vs snapshot complet).
