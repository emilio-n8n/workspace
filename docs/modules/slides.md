# Module Slides

## Objectif
Des présentations simples et propres : diapositives, mises en page avec zones
à remplir, édition du texte en place, formes, mode plein écran.

## Périmètre (livré)
- Présentation = fichier Drive lié ; diapositives ordonnées (100 max) avec
  titre, notes du présentateur et éléments.
- **Mises en page** : « Titre » (titre + sous-titre), « Titre et contenu »
  (titre + corps), « Vierge ». Une nouvelle présentation démarre sur la mise
  en page « Titre » ; la barre d'outils propose les trois à chaque ajout.
- **Zones à remplir** : une zone vide affiche son invitation (« Cliquez pour
  ajouter un titre ») dans l'éditeur seulement — jamais en présentation,
  impression ni vignette. Un clic ouvre l'édition, un double-clic sur un
  élément texte aussi.
- **Édition en place** : le texte se modifie directement sur la diapositive,
  avec la typographie exacte du rendu final (le panneau latéral reste
  disponible pour les lecteurs d'écran et la saisie au clavier).
- Éléments : zone de texte, formes (rectangle, ellipse, ligne — variante
  interchangeable), image téléversée (8 Mo max, PNG/JPEG/WebP/GIF/AVIF).
- Mise en forme : taille (8-200 px base 960, boutons A− / A+ par paliers),
  gras, italique, souligné, couleur sémantique (défaut, discret, accent,
  attention, alerte — jetons du design system, jamais de couleur codée en
  dur), alignement gauche/centre/droite.
- Éditeur : glisser-déposer, poignée de redimensionnement, ordre z
  (avant/arrière-plan, Ctrl+↑/↓), clavier complet (flèches pour déplacer —
  Maj : pas de 5 % —, Entrée pour éditer, Suppr pour supprimer, Échap pour
  désélectionner), panneau de propriétés, duplication et réordonnancement,
  autosave avec contrôle de révision, annulation de duplication/suppression
  (6 s).
- Formats 16:9 / 4:3 (conversion des scènes), thèmes papier / encre / accent.
- Mode présentation plein écran (flèches, Échap), notes du présentateur,
  chronomètre, impression d'une diapositive par page.

## Modèle de données
`presentations` (fichier lié, révision, format, thème),
`presentation_slides` (position, titre, notes), `slide_elements` (type,
coordonnées relatives, texte, `font_size`, `bold`, `italic`, `underline`,
`text_color`, `placeholder`, `media_key`, alignement).
Migration `0004` : ajout de `italic`, `underline`, `text_color`, `placeholder`.

## Autorisations
Droits Drive ; bornes validées côté service (pourcentages bornés, tailles,
texte 2 000 caractères, notes 5 000, couleurs et rôles de zone normalisés —
une valeur inconnue retombe sur le défaut).

## Critères d'acceptation
Créer, modifier, sauvegarder et relire une présentation ; la première
diapositive porte la mise en page « Titre » ; l'édition en place, la mise en
forme et les mises en page persistent après rechargement ; un lecteur ouvre
en lecture seule ; réordonnancement conservé (tests de service + E2E).

## Hors périmètre
Vidéo et audio intégrés, transitions et animations, export PowerPoint/PDF,
SmartArt et tableaux. Le MCP expose `slides.read` (plan : titres, notes,
textes).
