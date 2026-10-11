# ADR-0014 — Sheets : moteur de formules natif avant Univer

**Statut** : accepté
**Date** : 2026-10-11

## Contexte

L'étude de moteurs comparait Univer, Luckysheet et une grille native. Le POC
Univer n'a pas été réalisé (temps) et l'exigence immédiate est : grille,
onglets, formules usuelles, export CSV — sans dette de performance.

## Décision

- **Moteur natif léger** : stockage creux des cellules, évaluation à la
  demande, parseur récursif pur (~200 lignes) couvrant littéraux, références
  `A1`, plages, `+ - * /`, parenthèses, `SUM/AVG/MIN/MAX/COUNT`, erreurs
  typées (`#DIV/0`, `#CYCLE`, `#ERREUR`), testé unitairement.
- **Univer reste candidat** pour la collaboration temps réel et les fonctions
  avancées ; la grille native ne bloque pas cette évolution (format de
  stockage indépendant du moteur).

## Conséquences

- Positif : bundle minuscule, aucune dépendance lourde, sortie CSV avec
  valeurs calculées, erreurs compréhensibles.
- Négatif : pas de formatage conditionnel, graphiques ni XLSX — documentés
  hors périmètre ; la dette est connue et bornée.
