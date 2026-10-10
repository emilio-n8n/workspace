# ADR-0009 — Moteur de présentations (Slides)

**Statut** : accepté sous réserve des POC listés
**Date** : 2026-10-10
**Source** : [`docs/studies/slides-engine.md`](../studies/slides-engine.md)

## Contexte

Slides est le moteur le plus difficile : **aucun moteur web OSS dominant**. L'étude montre qu'Univer Slides 1.0 réserve import/export, tableaux et collaboration à sa version Pro (filigrane sans licence) — inutilisable pour notre cœur — et que les alternatives sont soit sous licence non OSI (tldraw), soit des applications monolithes d'un autre framework (PPTist/Vue).

## Décision

Moteur **maison hybride**, assemblage maîtrisé de briques perméables :

- **Scène** : `react-konva` + modèle JSON propriétaire (diapositives, éléments, transformations).
- **Mode présentation** : `reveal.js` (MIT) — pas d'édition, seulement la diffusion.
- **Export PPTX** : `pptxgenjs` (MIT) — risque de maintenance documenté, à surveiller.
- **Import PPTX** : `pptxtojson` (MIT, brique extraite de PPTist) — fidélité partielle assumée.
- **PDF haute fidélité** : **LibreOffice headless** en sidecar optionnel.
- **Sidecar ONLYOFFICE** : option « compatibilité d'édition » hors cœur.

Périmètre MVP réaliste : diapositives, texte, images, formes, thèmes simples, présentation, export PPTX/PDF. Effort estimé (à confirmer par POC) : 8–12 semaines ; risque n°1 identifié : l'édition de texte riche dans une scène canvas.

## Conséquences

- Positif : licence 100 % compatible, UI et modèle entièrement nôtres, pas de plafond commercial.
- Négatif : le module le plus coûteux de la suite — il reste en **Phase 3**, après Sheets ; fidélité PPTX partielle ; `pptxgenjs` à maintenance lente (plan de reprise si abandon).
- Obligation : POC avant développement — édition de texte dans la scène, import/export d'un deck réel, PDF via sidecar.

## Alternatives étudiées

| Option | Pourquoi écartée (à ce stade) |
|---|---|
| Univer Slides | Fonctions essentielles (import/export, tables, collab) hors OSS → impasse MVP |
| PPTist | Application Vue monolithe mature — nous réutilisons sa brique d'import, pas le produit |
| tldraw | Licence source-available non OSI (filigrane/clé en production) → exclue pour un produit distribué |
| reveal.js seul | Diffusion, pas d'édition |
| ONLYOFFICE/Collabora comme cœur | Poids, UI non maîtrisée ; conservés en option compatibilité |
