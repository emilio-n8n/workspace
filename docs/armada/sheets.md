# Armada — escouade sheets

## Missions

- [x] TASK-001 : Redimensionnement des colonnes/lignes au glisser, persisté
- [x] TASK-002 : Menu contextuel (clic droit): insérer/supprimer ligne/colonne, formats, en français
- [x] TASK-003 : Barre de formule (saisie et édition de la cellule active)
- [ ] TASK-004 : Copier/coller TSV depuis et vers le presse-papiers
- [ ] TASK-005 : Figer l'en-tête (et la première colonne) au défilement
- [ ] TASK-006 : Tri d'une plage sélectionnée (croissant/décroissant)
- [ ] TASK-007 : Formats de nombre (entier, décimal, pourcentage, monnaie, date)
- [ ] TASK-008 : Couleurs de police et de fond choisies dans les tokens
- [ ] TASK-009 : Import CSV avec détection du séparateur et aperçu
- [ ] TASK-010 : Export CSV/TSV de la feuille courante
- [ ] TASK-011 : Validation simple de cellule (nombre, texte borné)
- [ ] TASK-012 : Navigation clavier de la grille (Tab, flèches, Ctrl+Début/Fin)
- [ ] TASK-013 : Rôles ARIA de tableau et annonces de changement de cellule
- [ ] TASK-014 : Performance: fenêtre de rendu simple pour les grandes feuilles

## Livré (vagues 1 — TASK-001 à 003)

- **TASK-001** Redimensionnement : `sheet_dimensions` (table dédiée par onglet,
  axe, index, taille) + `dimensions.ts` (logique pure : bornes, immuabilité,
  relecture défensive). Glisser à la souris (capture du pointeur, aperçu
  continu, écriture au relâchement), double-clic et touche Origine pour revenir
  au défaut, flèches (Maj pour un pas plus grand) au clavier via `<div
  role="separator" aria-valuenow/min/max>`.
- **TASK-002** Menu contextuel (`sheet-context-menu.tsx`) au clic droit **ou**
  touche Menu / Maj+F10, sur une cellule, une colonne ou une ligne. Insérer
  au-dessus/en dessous et à gauche/à droite, supprimer la ligne ou la colonne
  (décalage des valeurs, des styles **et** des tailles, en transaction), puis
  les formats (gras, italique, alignements, effacer). `role="menu"` +
  `menuitem`/`menuitemradio`, flèches, Origine/Fin, Échap qui rend le focus.
  En lecture seule les actions restent visibles mais inertes.
- **TASK-003** Barre de formule (`formula-bar.tsx`) : boîte de nom (référence
  active, déplacement validé par `parseKey`) + champ de la valeur brute avec
  aperçu du résultat calculé, Entrée/Tab pour valider et descendre ou passer à
  droite, Échap pour annuler, perte du focus qui valide.

À noter : la grille est désormais un **tableau natif** (`<thead>/<tbody>`,
`th scope=col/row`, `td`) disposé en grille CSS (`display: contents` sur les
enveloppes), avec le rôle ARIA `grid`, `aria-rowcount/colcount`, une légende
`sr-only` et la navigation aux flèches. Les tests d'intégration du service
couvrent tailles, opérations structurelles et journal d'audit (85 tests verts).
