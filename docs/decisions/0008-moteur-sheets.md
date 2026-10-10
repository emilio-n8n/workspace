# ADR-0008 — Moteur de tableur (Sheets)

**Statut** : accepté sous réserve des POC listés
**Date** : 2026-10-10
**Source** : [`docs/studies/sheets-engine.md`](../studies/sheets-engine.md)

## Contexte

Sheets doit couvrir : feuilles, formules courantes, tri/filtres, formats, import/export xlsx/csv, intégration Drive et permissions. Contrainte clé révélée par l'étude : les fonctionnalités *Pro* d'Univer (import/export, collaboration, impression) sont commerciales et le resteront pour la partie OSS.

## Décision

- **Grille et calcul embarqués** : **Univer OSS** (Apache-2.0) — grille, formules, tri/filtres, formats, validation — sans dépendre des briques Pro.
- **Échange de fichiers maison** : pont xlsx/csv développé par nos soins (génération + lecture), brique confirmée en POC (SheetJS npm gelé avec CVE → pas de dépendance directe non validée ; 0.20.3 sain uniquement hors npm).
- **Repli documenté** : **FortuneSheet** (MIT) si POC Univer défavorable ; **HyperFormula** (GPL-3.0, clé `gpl-v3`) envisageable comme moteur de formules séparé — compatibilité AGPL-3.0 analysée dans l'étude (sans blocage, réserves signalées).
- **Sidecars ONLYOFFICE/Collabora** : option « compatibilité » hors cœur, pas de dépendance par défaut.

## Conséquences

- Positif : moteur moderne (TS) sous Apache-2.0, UI intégrée à la suite, pas de licence commerciale cachée *tant que* nous évitons les briques Pro.
- Négatif : l'import/export xlsx est **notre responsabilité** (effort + tests de fidélité) ; performances sur grosses feuilles à mesurer nous-mêmes.
- Obligation : POC — 100 000 cellules sur 4 cœurs (édition, formules, scroll), aller-retour xlsx avec un classeur réel complexe, vérification qu'aucune fonctionnalité Pro n'est nécessaire au parcours MVP.

## Alternatives étudiées

| Option | Pourquoi écartée (à ce stade) |
|---|---|
| Luckysheet | Archivé (npm gelé depuis 2021) |
| FortuneSheet | Maintenance ralentie — conservé en repli, pas en premier choix |
| Handsontable | Licence propriétaire + clause de non-concurrence → exclu |
| AG Grid Community | Grille, pas un tableur (formules/édition absentes du périmètre gratuit) |
| Streameur xlsx npm (SheetJS CE) | Version npm gelée 0.18.5 avec CVE → à remplacer par pont maison ou brique validée |
| Sidecars comme cœur | Poids, UI incohérente, dépendance à un produit tiers pour le parcours principal |
