# Module Sheets

## Objectif
Un tableur d'équipe : grille, plusieurs onglets, formules usuelles et export
CSV, avec la simplicité comme contrainte première.

## Périmètre (livré)
- Feuille = fichier Drive lié ; cellules stockées creuses (row/col, valeur
  brute, jamais calculée).
- Moteur de formules natif, pur et testé : littéraux, références `A1`,
  plages `A1:B2`, `+ - * /`, parenthèses et `SUM`, `AVG`, `MIN`, `MAX`,
  `COUNT` ; erreurs typées `#DIV/0`, `#CYCLE`, `#ERREUR`.
- Jusqu'à 20 onglets, 1 000 lignes, 100 colonnes (limites logiques), autosave
  par lots, sauvegarde avant changement d'onglet.
- Export CSV d'un onglet avec **valeurs calculées** (`/api/sheets/export`).
- MCP : `sheets.read` (valeurs calculées, 50×20 maximum).

## Décision de moteur
Le moteur natif remplace provisoirement Univer (ADR-0014) : le besoin
d'aujourd'hui (grille + formules usuelles) est couvert sans dépendre d'un
moteur lourd de 1,5 Mo ; Univer reste candidat pour le collaboratif temps
réel et les fonctions avancées.

## Autorisations
Droits Drive (lecture / écriture) ; organisme isolé ; validations de bornes
et de tailles côté service.

## Critères d'acceptation
Saisir des cellules, évaluer `=SUM(A1:A2)`, persister après rechargement,
détecter cycles et divisions par zéro, exporter en CSV (tests unitaires du
moteur + service + E2E).

## Hors périmètre
Collaboration temps réel (Yjs), mise en forme conditionnelle, graphiques,
imports XLSX/CSV.
