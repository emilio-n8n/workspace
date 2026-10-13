# Armada — escouade classroom

## Missions

- [x] TASK-001 : Fil d'actualité du cours (publications, commentaires)
- [x] TASK-002 : Devoirs: création/édition complète avec pièces jointes
- [x] TASK-003 : Rendus: statuts (rendu, en retard, noté) et sélection
- [ ] TASK-004 : Notes: barème, saisie, moyenne du cours
- [ ] TASK-005 : Commentaires privés du professeur sur un rendu
- [ ] TASK-006 : Gestion des personnes (rôles, retrait)
- [ ] TASK-007 : Calendrier du cours (devoirs à venir)
- [ ] TASK-008 : Code d'invitation (régénérer, afficher)
- [ ] TASK-009 : Archivage et désarchivage d'un cours
- [ ] TASK-010 : Tri et filtres des rendus (statut, élève)
- [ ] TASK-011 : Export CSV des notes
- [ ] TASK-012 : Notifications de cours (nouveau devoir, note)
- [ ] TASK-013 : Détails du devoir lisibles (consigne, date, barème)
- [ ] TASK-014 : Accessibilité: rôles des listes, focus, contrastes

## Livré (vagues classroom)

**TASK-001 — fil d'actualité.** Tables `classroom_announcements` et
`classroom_announcement_comments` (migration `0002_calm_tide.sql`), service
(`createAnnouncement`, `listAnnouncements`, `addComment`, `deleteAnnouncement`,
`deleteComment`, 4 serveurs fonctions) et écran `ui/course-feed.tsx` :
publication réservée à l'enseignant, commentaires ouverts à tous les membres,
fils repliés (`aria-expanded`), suppression confirmée, auteurs affichés avec
leurs initiales. 6 tests d'intégration.

**TASK-002 — devoirs et pièces jointes.** `updateAssignment` (édition champ par
champ, consigne vidée et échéance retirée à la demande), `ui/assignment-dialog.tsx`
(un seul formulaire pour créer et modifier), `ui/attachment-picker.tsx` (dépôt au
clic **et** au glisser-déposer, 5 fichiers de 10 Mo, retrait d'un fichier déjà
déposé), `ui/submission-dialog.tsx` (réponse + pièces jointes, compteur de
caractères annoncé). 5 tests d'intégration.

**TASK-003 — statuts et sélection des copies.** `src/status.ts` (logique pure :
noté > en retard > rendu ; à rendre / non rendu), `ui/status-badge.tsx` (pastille
sur tokens sémantiques), `ui/submissions-dialog.tsx` (liste de copies au clavier
— flèches, Début/Fin, focus qui suit la sélection —, détail de la copie
sélectionnée, note + commentaire, rappel du retard en jours). 11 tests purs
(status, formatage).

## Correctif E2E « Exercice 1 »

**Symptôme.** `e2e/suite-phase4-5.spec.ts` échouait ligne 122 : après avoir
rejoint le cours avec le code, l'élève ne voyait jamais le devoir « Exercice 1 ».

**Cause.** `joinByCode` et `requireCourse` filtraient sur
`classroom_courses.orgId = actor.orgId`. Chaque inscription ouvre son propre
espace personnel (`ensurePersonalOrganization`) : l'enseignant et l'élève sont
donc dans **deux organisations différentes**. La jointure était refusée
(« Aucun cours ne correspond à ce code. ») et l'élève restait sur la liste des
cours. Même verrou sur `listCourses`, les publications, les commentaires et le
téléchargement des pièces jointes.

**Correctif.** Le cours se rejoint par son code, et **l'adhésion**
(`classroom_members`) devient la seule frontière d'accès : le code d'accès est
l'invitation, il fait franchir l'organisation. `listCourses` aussi. Les pièces
jointes restent bornées au déposant (`classroom/<orgId>/…`), un tiers non membre
ne peut toujours rien lire. La notification de note est déposée dans
l'organisation de l'élève (celle du cours s'il en est membre, sinon son espace
personnel).

**Régression couverte** par
`test/classroom-assignment-editing.test.ts` (« jointure inter-organisation ») :
jointure par code, devoir visible, copie rendue, note visible par l'élève.
