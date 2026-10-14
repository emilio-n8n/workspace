# Armada — escouade sheets

## Missions

- [x] TASK-001 : Redimensionnement des colonnes/lignes au glisser, persisté
- [x] TASK-002 : Menu contextuel (clic droit): insérer/supprimer ligne/colonne, formats, en français
- [x] TASK-003 : Barre de formule (saisie et édition de la cellule active)
- [x] TASK-004 : Copier/coller TSV depuis et vers le presse-papiers
- [x] TASK-005 : Figer l'en-tête (et la première colonne) au défilement
- [x] TASK-006 : Tri d'une plage sélectionnée (croissant/décroissant)
- [ ] TASK-007 : Formats de nombre (entier, décimal, pourcentage, monnaie, date)
- [ ] TASK-008 : Couleurs de police et de fond choisies dans les tokens
- [ ] TASK-009 : Import CSV avec détection du séparateur et aperçu
- [ ] TASK-010 : Export CSV/TSV de la feuille courante
- [ ] TASK-011 : Validation simple de cellule (nombre, texte borné)
- [ ] TASK-012 : Navigation clavier de la grille (Tab, flèches, Ctrl+Début/Fin)
- [ ] TASK-013 : Rôles ARIA de tableau et annonces de changement de cellule
- [ ] TASK-014 : Performance: fenêtre de rendu simple pour les grandes feuilles

## Livré (vague 1 — TASK-001 à 003)

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

## Livré (vague 2 — TASK-004 à 006)

Sélection de plage, presse-papiers TSV et tri reposent sur des modules purs
testés sans navigateur (`range.ts`, `sort.ts`, `freeze.ts`) ; seul le dialogue
avec le presse-papiers du système vit dans l'interface.

- **TASK-004** Copier/coller TSV (`range.ts`). Sélection de plage au **Maj+clic**
  ou **Maj+flèche** (ancre + cellule active, libellé « A1:B3 ») ; `Ctrl/Cmd+C`
  sérialise la plage en TSV (valeurs aplaties, injection de formule neutralisée
  comme l'export CSV), `Ctrl/Cmd+V` relit un TSV et l'écrit à partir de la
  cellule active — les cellules qui déborderaient la grille sont ignorées,
  jamais écrites hors limites. Le refus du navigateur est expliqué en français
  dans la région `role="alert"`, copies et collages sont annoncés dans la région
  `aria-live`, et les cellules de la plage sélectionnée sont teintées
  (`bg-accent/25`).
- **TASK-005** Figement de l'en-tête et de la première colonne (`freeze.ts`) :
  deux boutons `aria-pressed` (« Figer l'en-tête », « Figer la première
  colonne ») appliquent ou retirent `position: sticky` sur les repères (le coin
  cumule les deux axes) ; l'état est résumé sous la barre d'outils et annoncé
  aux lecteurs d'écran.
- **TASK-006** Tri de la plage sélectionnée (`sort.ts`) depuis le menu
  contextuel (« Trier A1:B4 (croissant/décroissant) », dès que la plage fait
  plus d'une cellule). Le tri porte sur la colonne de la cellule active et
  déplace les **lignes entières** ; nombres comparés comme des nombres, texte à
  la collation française, cellules vides toujours en dernier, tri stable.
  Seules les cellules dont la valeur change repartent dans l'autosave.

L'intégrateur a ajouté le bouton « Exporter CSV » dans la barre d'onglets (route
d'export existante) : il n'a pas été refait ici.

Total : 123 tests verts (85 en vague 1 + 38 pour la logique pure de la vague 2).
