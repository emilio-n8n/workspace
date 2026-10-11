# Module Classroom

## Objectif
Des cours avec code d'accès : devoirs, copies d'élèves, notation simple.

## Périmètre (livré)
- Cours d'organisation avec enseignant propriétaire, section facultative et
  code d'accès à 8 caractères (alphabet sans ambiguïté, échantillonnage par
  rejet).
- Rôles : enseignant (créateur) et élève (rejoint par code, idempotent).
- Devoirs : titre, consignes, échéance, points (0-1000) ; réservés aux
  enseignants.
- Copies : une par élève et par devoir. Une copie peut toujours être remplacée,
  mais une note déjà posée est conservée (l'enseignant re-note explicitement).
  Liste des copies et notation (note entière entre 0 et les points, sans
  écrêtage : une valeur hors bornes est refusée) réservées aux enseignants.
- MCP : `classroom.list`.

## Modèle de données
`classroom_courses` (join_code unique), `classroom_members` (rôle),
`classroom_assignments`, `classroom_submissions` (unique devoir+élève).

## Autorisations
Appartenance obligatoire ; les enseignants ne rendent pas de copie ; un élève
ne voit que sa copie ; aucun franchissement d'organisation (code d'une autre
organisation inutilisable).

## Critères d'acceptation
Créer un cours, rejoindre par code, créer un devoir, rendre une copie, la
noter ; refus pour les non-membres et hors organisation (tests de service +
E2E deux comptes).

## Hors périmètre
Fichiers joints aux devoirs, quiz, calendriers de cours, notifications.
