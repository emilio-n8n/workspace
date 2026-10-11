# Module Slides

## Objectif
Des présentations simples et propres : diapositives, zones de texte et
formes, mode plein écran.

## Périmètre (livré)
- Présentation = fichier Drive lié ; diapositives ordonnées (100 max) avec
  titre, notes du présentateur et éléments.
- Éléments : zone de texte et forme, positions/tailles en pourcentage de la
  diapositive, police (8-200 px base 960), gras, alignement.
- Éditeur : glisser-déposer, poignée de redimensionnement, panneau de
  propriétés, duplication et réordonnancement, autosave.
- Mode présentation plein écran (flèches, Échap), notes conservées.
- MCP : `slides.read` (plan : titres, notes, textes).

## Modèle de données
`presentations` (fichier lié), `presentation_slides` (position, titre,
notes), `slide_elements` (type, coordonnées relatives, texte, style).

## Autorisations
Droits Drive ; bornes validées côté service (pourcentages bornés, tailles,
texte 2 000 caractères, notes 5 000).

## Critères d'acceptation
Créer, modifier, sauvegarder et relire une présentation ; un lecteur ouvre en
lecture seule ; réordonnancement conservé (tests de service + E2E).

## Hors périmètre
Images et vidéos intégrées, transitions, export PowerPoint/PDF, animations.
