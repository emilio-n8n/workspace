# Armada — escouade drive

## Missions

- [x] TASK-001 : Fil d'Ariane cliquable avec navigation par menu
- [x] TASK-002 : Menu Trier (nom, date, taille) et densité d'affichage persistés
- [x] TASK-003 : Sélection multiple (clic, Ctrl+A, maj) + barre d'actions (télécharger, supprimer, déplacer)
- [ ] TASK-004 : Raccourcis clavier de la grille (flèches, Entrée, Suppr, Échap)
- [ ] TASK-005 : Création de dossier inline avec validation immédiate
- [ ] TASK-006 : Zone de dépôt visuelle (état actif au survol)
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
