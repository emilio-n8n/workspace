# Module Forms

## Objectif
Créer des formulaires, collecter des réponses par lien public et les
exploiter (lecture, export CSV).

## Périmètre (livré)
- Formulaire = fichier Drive lié (nom, arborescence, permissions héritées).
- Questions : texte court, texte long, choix unique, cases à cocher,
  échelle 1-5, date, oui/non ; obligatoire par question ; ordre
  réorganisable au clavier (Alt + flèches) comme à la souris.
- Statuts : brouillon (invisible publiquement), ouvert, fermé.
- Page publique `/f/<slug>` sans session ; validation stricte des réponses
  (obligatoires, choix autorisés, échelle, tailles maximales).
- Réponses visibles des éditeurs seulement ; export CSV (BOM UTF-8).
- MCP : `forms.list`, `forms.responses`.

## Modèle de données
`forms` (slug unique, statut, fichier lié), `form_questions` (position,
type, options JSONB), `form_responses` (réponses JSONB indexées par question).

## Autorisations
Édition par les droits Drive (effectiveRole ≥ écriture) ; collecte publique
autorisée par le seul statut `ouvert` ; garde-fous : 100 questions, 10 000
réponses par formulaire, réponses de 5 000 caractères maximum.

## Critères d'acceptation
Publier un formulaire, y répondre depuis le lien public, refuser les réponses
invalides et les formulaires fermés, lire et exporter les réponses
(tests de service + E2E).

## Hors périmètre
Limitation de débit anti-abus (documentée comme prochain chantier),
pièces jointes, sections conditionnelles.

## Vague « conditions, thème et aperçu » (14 oct. 2026)
- **Questions conditionnelles** : « afficher si [question] = [valeur] » (`conditions.ts`) — cibles limitées aux questions antérieures enregistrées, valeurs proposées selon le type (liste fermée pour choix/échelle/oui-non, saisie libre sinon) ; le formulaire public ne rend que les questions visibles.
- **Accent par formulaire** : palette de jetons `--color-app-*` (`theme.ts` + `accent-picker.tsx`), appliquée au formulaire public.
- **Aperçu intégré** : rendu fidèle du formulaire dans l'éditeur (`form-preview.tsx`).
