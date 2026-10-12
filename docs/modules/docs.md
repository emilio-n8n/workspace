# Contrat — Docs

- **Statut** : cœur serveur + éditeur vérifiés (tests service + export, parcours E2E navigateur)
- **Propriétaire** : lead
- **Package** : `modules/docs` (`@workspace/docs`)
- **Dépendances autorisées** : `packages/database`, `packages/permissions`, `packages/api`, `packages/ui`, interface publique de `modules/drive` (fichier pointeur, permissions, arborescence)

## Objectif

Édition de documents riche mais sobre : rédiger, structurer, partager, versionner, exporter. Le document est le **prolongement naturel d'un fichier Drive** : même arborescence, mêmes partages, mêmes recherches.

## Décision moteur

**ADR-0007** : Tiptap 3 (ProseMirror, MIT) embarqué ; StarterKit pour le MVP ; collaboration temps réel Yjs/Hocuspocus prévue en Phase 3. Aucun sidecar dans le cœur.

## Périmètre

- **MVP livré** : créer (depuis Docs ou depuis le Drive), renommer (titre synchronisé avec le nom Drive), édition riche (titres, gras/italique/barré, code, listes, citations, blocs de code, séparateur), **autosave** (débounce 1,2 s, mode `replace-latest` : pas d'historique par frappe), **instantanés explicites** (« Enregistrer une version », mode `append`), historique des versions consultable, export Markdown et HTML (téléchargement).
- **Hors périmètre à ce stade** : export DOCX (envisagé avec `docx` + corpus de fidélité), collaboration temps réel, commentaires, suggestions, liens dans la barre d'outils (le modèle les supporte ; l'ajout d'UI viendra avec l'extension Link validée).
- **Évolutions** : Yjs/Hocuspocus (curseurs, présence), commentaires ancrés, modèles, publication web (via Sites).

## Interfaces publiques

- `createDocument`, `getDocumentByFileId`, `saveDocument` (`mode: replace-latest | append`), `listDocumentVersions`, `renameDocument`, `listDocuments`, `exportDocument` (`md` | `html`)
- Conversions sans dépendance : `toMarkdown`, `toHtml`, `toPlainText` (sous-ensemble StarterKit, échappement et neutralisation `javascript:` testés)
- **Server functions web** : `apps/web/src/server/docs.ts` ; export HTTP : `GET /api/docs/export/$fileId?format=md|html`

## Données

- Tables : `docs_documents` (titre, `file_id` unique vers Drive, version courante), `docs_versions` (contenu JSON ProseMirror, version, auteur).
- Le fichier Drive associé est un **pointeur** (aucun binaire) : le nom, l'arborescence et les permissions vivent côté Drive.

## Permissions

- Mappées sur les grants du fichier Drive : `viewer` (lecture + export), `editor` (édition + autosave), `owner` (partage/suppression). Promotion/dépromotion par révocation de grant.
- Isolation inter-organisations testée ; document en corbeille inaccessible.

## UI

- Routes : `/app/docs` (liste + création), `/app/docs/$fileId` (éditeur plein écran avec barre d'outils, statut d'enregistrement, historique, exports) ; création aussi depuis le Drive (« Nouveau document »).

## Outils MCP

| Outil | Scopes | Statut |
|---|---|---|
| `docs.read` (texte extrait, tronqué) | `docs:read` | ✅ livré (tests d'intégration) |
| `docs.create` / `docs.update` | `docs:write` | Phase 3 |

## Tests et critères d'acceptation

- Service : cycle de vie, autosave vs instantané (pas de version par frappe), permissions viewer/editor, isolation, corbeille, export.
- Export : tests unitaires Markdown/HTML/texte (échappement, liens dangereux neutralisés).
- E2E navigateur : création depuis le Drive → frappe → statut « Enregistré » → exports visibles.

## Risques et questions ouvertes

- Fidélité DOCX à mesurer (corpus S1) avant d'annoncer l'export.
- Croissance des versions : rétention (compaction des autosaves par session) à définir avec la politique de rétention Drive.

## Ajouts des vagues S/T
- **Commentaires** : fils par document (auteur, citation ≤ 500, corps ≤ 4 000), résolution/rouverture, suppression par l'auteur ou le propriétaire ; les viewers lisent, les **commenters** commentent (matrice de permissions).
- **Verrous optimistes** : `baseUpdatedAt` sur l'autosave — un conflit répond « modifié ailleurs », le contenu local est conservé et un rechargement est proposé.
- **Impression** : Ctrl+P produit un document propre (chrome masqué, `@page`, pagination sans coupure de blocs).
