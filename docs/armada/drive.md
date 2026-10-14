# Armada — escouade drive

## Missions

- [x] TASK-001 : Fil d'Ariane cliquable avec navigation par menu
- [x] TASK-002 : Menu Trier (nom, date, taille) et densité d'affichage persistés
- [x] TASK-003 : Sélection multiple (clic, Ctrl+A, maj) + barre d'actions (télécharger, supprimer, déplacer)
- [x] TASK-004 : Raccourcis clavier de la grille (flèches, Entrée, Suppr, Échap)
- [x] TASK-005 : Création de dossier inline avec validation immédiate
- [x] TASK-006 : Zone de dépôt visuelle (état actif au survol)
- [ ] TASK-007 : Aperçu de fichier en dialogue pour texte et images
- [ ] TASK-008 : File de téléversement avec progression et erreurs par fichier
- [ ] TASK-009 : Corbeille: restaurer/vider avec confirmation FR
- [ ] TASK-010 : Dialogue de partage poli (rôles FR, copie de lien)
- [ ] TASK-011 : Messages d'erreur actionnables (quota, type, taille)
- [ ] TASK-012 : États vides illustrés avec actions
- [ ] TASK-013 : Rôles ARIA de grille et navigation clavier complète
- [ ] TASK-014 : Relecture française complète de l'interface

## Journal

### TASK-001..003 (livré)

- **Fil d'Ariane** : chaque segment est un lien ; les chemins longs sont repliés en
  menu « … » ; le dossier courant ouvre un menu de ses sous-dossiers (chargement
  paresseux, états chargement/erreur/vide). Nom accessible = chemin complet.
- **Trier & densité** : menu « Trier » (Nom / Date / Taille + sens), menu
  « Densité » (Confort / Compact), en-têtes de colonne cliquables avec
  `aria-sort`. Persistance locale (`workspace.drive.view`), lecture tolérante aux
  données corrompues.
- **Sélection multiple** : clic, Ctrl/⌘ + clic, Maj + clic (plage), Ctrl/⌘ + A,
  Échap, case par ligne, case d'en-tête (dont état indéterminé). Barre d'actions
  (télécharger, déplacer, supprimer) avec comptes rendus par toast.
- **Serveur** : `moveEntries`, `trashEntries`, `listMoveTargets` (service) +
  `moveEntriesFn`, `trashEntriesFn`, `listMoveTargetsFn` (server fns). Échecs
  isolés par élément, audit `drive.entry.move` par déplacement réel, garde-fou
  contre le déplacement d'un dossier dans sa descendance.
- **Fichiers** : `ui/breadcrumb.ts`, `ui/breadcrumbs.tsx`, `ui/view-prefs.ts`,
  `ui/view-controls.tsx`, `ui/selection.ts`, `ui/selection-bar.tsx`, `ui/menu.tsx`,
  `ui/entry-menus.tsx`, `ui/linked-files.ts`, `ui/browser.tsx`, `src/service.ts`,
  `src/server.ts`.
- **Tests** : `test/view-prefs.test.ts` (22), `test/breadcrumb.test.ts` (15),
  `test/selection.test.ts` (18), `test/drive-bulk.test.ts` (17 intégration).
  100 tests au total, tous verts.

### TASK-004..006 (livré)

- **Navigation clavier de la liste** : le tableau porte le rôle ARIA `grid`
  (`aria-multiselectable`), chaque ligne est focalisable en onglet mobile
  (roving tabindex). Flèches haut/bas (et Début/Fin, Page haut/bas) déplacent le
  curseur, Entrée ou flèche droite ouvre, flèche gauche remonte au dossier
  parent, Espace bascule la sélection, Suppr met la sélection à la corbeille
  derrière la confirmation. Le focus n'est reposé qu'après une action clavier :
  un rafraîchissement de liste ne vole pas la place. Position annoncée dans une
  région `aria-live` (« Élément 3 sur 12 : Fichier notes.txt, sélectionné »).
  La composition de la liste (nombre, tri) vit dans la légende du tableau, lue
  à l'entrée dans la grille.
- **Création de dossier inline** : le formulaire s'insère en tête de liste, le
  focus est posé dans le champ, Entrée crée, Échap annule et rend le focus à la
  liste. Validation immédiate en français (`validateEntryName` : nom obligatoire,
  limite de 255, refus des séparateurs `/` `\` et des caractères de contrôle),
  `aria-invalid` + message en `role="alert"`, compteur de caractères restants.
  Le refus serveur (conflit de nom) reste affiché tel quel.
- **Zone de dépôt** : état actif au survol de fichier pendant un glisser-déposer,
  avec compte d'entrées (`dragenter`/`dragleave`) pour éviter le clignotement au
  passage sur les enfants. Message explicite nommant le dossier de destination
  (« Déposez les fichiers pour les téléverser dans « Projets 2026 » »). Envoi
  séquentiel avec un sort par fichier : la file affiche En attente / Envoi… /
  Envoyé / Échec, le message d'erreur exact, et relance individuellement chaque
  échec ou tous d'un coup. Compte rendu accordé en `aria-live`.
- **Primitif de menu** : le `Menu` de `@workspace/ui` remplace le menu local
  partout où son API suffit (fil d'Ariane : repli « … » et sous-dossiers). Le
  module garde `ui/radio-menu.tsx` (renommé depuis `ui/menu.tsx`) pour les deux
  menus à options cochées (Trier, Densité) : le primitif partagé n'expose pas
  encore `checked`/`aria-checked`, et s'en passer priverait un lecteur d'écran de
  l'option active. À remplacer dès que le primitif l'expose.
- **Fichiers** : `ui/grid-nav.ts`, `ui/entry-name.ts`, `ui/upload-queue.ts`,
  `ui/radio-menu.tsx`, `ui/browser.tsx`, `ui/breadcrumbs.tsx`,
  `ui/view-controls.tsx`.
- **Tests** : `test/grid-nav.test.ts` (19), `test/entry-name.test.ts` (10),
  `test/upload-queue.test.ts` (20). Suite complète : 8 fichiers, 149 tests verts.
