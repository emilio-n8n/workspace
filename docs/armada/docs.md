# Armada — escouade docs

## Missions

- [x] TASK-001 : Barre d'outils accessible: info-bulles FR, aria-pressed, focus
- [x] TASK-002 : Raccourcis markdown (Ctrl+B/I/U) cohérents avec la barre
- [x] TASK-003 : Panneau Plan: titres du doc, clic pour naviguer, surlignage de position
- [x] TASK-004 : Mode focus (masque l'interface autour de la page)
- [x] TASK-005 : Statistiques du document (mots, caractères, temps de lecture)
- [x] TASK-006 : Recherche dans le document avec surlignage et compteur
- [ ] TASK-007 : Zone d'enregistrement: statut lisible, erreurs réseau, reprise
- [ ] TASK-008 : Panneau commentaires soigné (ajout, résolution visuelle)
- [ ] TASK-009 : Mode lecture seule renforcé (aucune action d'édition visible)
- [ ] TASK-010 : Comparaison simple de deux versions (texte côte à côte)
- [ ] TASK-011 : Export Markdown téléchargeable
- [ ] TASK-012 : Mise en page d'impression/export PDF soignée
- [ ] TASK-013 : Historique des versions livré: confort d'usage et angles corrigés
- [ ] TASK-014 : Éditeur: rôles, focus, contrastes, aria-live sur les statuts

## Vague 1 (TASK-001 à 003)

`format-actions.ts` (catalogue unique barre/clavier), `tooltip.tsx` + `toolbar.tsx`
(info-bulles FR avec raccourci, `aria-pressed` sur les seules bascules, flèches `←/→`),
`outline.ts` + `outline-panel.tsx` (plan du document, `aria-current="location"`).

## Vague 2 (TASK-004 à 006)

- `focus-mode.ts` + `use-focus-mode.ts` : préférence mémorisée, classe sur `<body>`,
  `Échap` pour sortir. CSS dans `apps/docs/src/styles.css` (rail + barre supérieure).
- `document-stats.ts` : mots, caractères, temps de lecture (200 mots/min) — logique pure.
- `search-text.ts` : positions ProseMirror, occurrences insensibles à la casse et aux
  accents, compteur FR. `search-plugin.ts` : décorations ProseMirror (aucune écriture,
  donc aucun autosave ni synchronisation collaborative).
