# v3 — Écarts de parité Docs / Slides / Sheets vs Word, PowerPoint et Excel web

> Audit du 2026-10-20 (branche `upgrade/v3`, base `main` @ 5d300f9).
> Méthode : lecture du code (`modules/{docs,slides,sheets}/src`) + exécution locale
> (Postgres 17, `pnpm dev`, Playwright Chromium 1440×900). Captures :
> `e2e-explore/v3/before-*.png` et `e2e-explore/v3/after-*.png`
> (script : `e2e-explore/v3-audit.spec.ts`, `SHOT_TAG=before|after`).
>
> Classement par **impact utilisateur** : P0 = bloque l'usage « vrai produit »
> (on s'en rend compte dans la première minute), P1 = attendu par tout
> utilisateur régulier, P2 = confort / utilisateurs avancés, P3 = niche.
> ✅ = livré dans la vague v3 (cette branche), ○ = reste à faire.

## Docs (Tiptap 3) vs Word web

| # | Prio | Écart constaté | État |
|---|---|---|---|
| D1 | P0 | **Pas de vue page** : le texte flotte sur le fond, pas de feuille A4, pas de marges visibles, pas de règle. Word web = page blanche ombrée sur fond gris, marges, règle. | ✅ feuille A4/Lettre ombrée, marges réglables, orientation, règle horizontale |
| D2 | P0 | **Pas de barre de menus** (Fichier / Édition / Affichage / Insertion / Format / Outils). Toutes les commandes rares sont cachées ou absentes. | ✅ barre de menus complète |
| D3 | P0 | **Barre d'outils tronquée** : « Enregistrer une version » coupé à 1440 px, statut et actions mélangés aux outils. | ✅ actions déplacées (menu Fichier), barre allégée |
| D4 | P0 | **Pas de police** (famille) ni **interligne** : `fontFamily` et `lineHeight` désactivés dans `TextStyleKit`. | ✅ police (8 familles sûres), interligne 1 / 1,15 / 1,5 / 2 |
| D5 | P0 | **Pas de rechercher-remplacer** (recherche seule). | ✅ Remplacer / Tout remplacer, casse, Ctrl+H |
| D6 | P1 | **Pas de menu contextuel** (clic droit = menu natif du navigateur). | ✅ couper/copier/coller, coller sans mise en forme, lien, commentaire, outils de tableau |
| D7 | P1 | **Raccourcis manquants** : Ctrl+K lien, Ctrl+Alt+1/2/3 titres, Ctrl+Maj+7/8 listes, Ctrl+Maj+L/E/R/J alignement, Ctrl+\ effacer la mise en forme, Ctrl+./Ctrl+, exposant/indice, Ctrl+S, Ctrl+P, Tab/Maj+Tab dans les listes. | ✅ |
| D8 | P1 | Pas d'**exposant / indice**, pas d'**effacer la mise en forme**, pas de **liste de tâches** (cases à cocher), pas de **retrait**. | ✅ |
| D9 | P1 | Couleurs : sélecteurs `<select>` textuels au lieu de nuanciers ; pas de surlignage visuel. | ○ (vague suivante : nuanciers) |
| D10 | P1 | **Commentaires non ancrés** : fils au niveau du document, pas sur une sélection de texte (pas de surlignage, pas de marge de commentaires). | ○ (nécessite marque `comment` + colonne d'ancre additive) |
| D11 | P1 | **Tableaux** : colonnes non redimensionnables (`resizable: false`), pas d'en-tête basculable, pas de fond de cellule, pas d'insertion avant/après. | ✅ redimensionnement, ligne/colonne avant/après, en-tête basculable |
| D12 | P1 | **Images** : URL seulement (pas de téléversement), pas de redimensionnement ni d'habillage. | ○ |
| D13 | P1 | **Pagination réelle** (sauts de page automatiques, n° de page, en-têtes/pieds). Aujourd'hui : sauts manuels seulement. | ○ (moteur de pagination à concevoir) |
| D14 | P2 | Fidélité du **copier-coller depuis Word/Google Docs** : police/interligne perdus (extensions désactivées). | ✅ partiel (police, interligne, exposant/indice conservés) ; ○ styles de tableau |
| D15 | P2 | Zoom : 4 paliers dans le pied de page, pas de « largeur de page ». | ✅ 50–200 % + menu Affichage |
| D16 | P2 | Pas de **nombre de pages** ni de dialogue « Nombre de mots ». | ✅ dialogue « Nombre de mots » (Outils) |
| D17 | P2 | Import/export **.docx** (OOXML) absent ; export .md/.html/impression uniquement. | ○ |
| D18 | P2 | Suivi des modifications, suggestions, styles personnalisés, table des matières insérée, notes de bas de page, colonnes. | ○ |
| D19 | P3 | Dictée, traduction, vérification orthographique propre (le navigateur la fournit). | ○ |

## Sheets (moteur natif) vs Excel web

| # | Prio | Écart constaté | État |
|---|---|---|---|
| S1 | P0 | **5 fonctions seulement** (SUM/AVG/MIN/MAX/COUNT), pas de comparaisons, pas de `&`, `^`, `%`, pas de booléens, pas de références absolues `$A$1`, pas de noms français (SOMME, SI…), pas de séparateur `;`. | ✅ moteur v2 : ~90 fonctions (logique, maths, stats, texte, dates, recherche), noms FR, `;`, `$`, comparaisons, `&`, `^`, `%`, booléens, erreurs Excel (#N/A, #VALEUR!, #REF!, #NOM?) |
| S2 | P0 | **Clic = édition immédiate** : impossible de sélectionner sans entrer en saisie ; taper sur une cellule sélectionnée ne la remplace pas ; pas de F2 / Entrée pour éditer ; Suppr n'efface pas. | ✅ modèle Excel : clic sélectionne, saisie remplace, F2/Entrée/double-clic éditent, Suppr/Retour arrière effacent la plage |
| S3 | P0 | **Sélection invisible** : la cellule active n'a pas de cadre ; la plage n'a qu'un fond pâle ; pas de sélection à la souris (glisser). | ✅ cadre de cellule active, contour de plage, glisser-sélectionner, clic sur en-tête = colonne/ligne entière, Ctrl+A |
| S4 | P0 | **Navigation clavier cassée** : `focusCell` cherche `data-cell-row` que `GridCell` ne rend pas → le focus ne suit pas la sélection. | ✅ corrigé |
| S5 | P0 | **Mise en forme sur une seule cellule** (v1) : gras/couleur/format ignorent la plage. | ✅ appliqué à toute la plage |
| S6 | P0 | **Pas de poignée de recopie** (fill handle) ni de recopie incrémentée. | ✅ poignée : séries numériques, recopie, formules décalées ; Ctrl+D / Ctrl+R |
| S7 | P1 | **Copier-coller de formules** sans ajustement des références relatives. | ✅ références relatives décalées au collage interne ; Ctrl+X couper |
| S8 | P1 | **Pas d'autocomplétion de formules** ni d'aide de syntaxe. | ✅ suggestions de fonctions + signature dans la cellule et la barre de formule |
| S9 | P1 | Aperçu de la barre de formule faux pendant la saisie (clés `ligne:col` passées au moteur au lieu de `A1`). | ✅ corrigé |
| S10 | P1 | **Grille limitée à 20 colonnes × 100 lignes**, sans virtualisation. | ✅ 26 colonnes × 1 000 lignes, lignes virtualisées |
| S11 | P1 | Raccourcis : Ctrl+B/I/U sur la grille, Ctrl+flèche (bord des données), Maj+Entrée, Tab/Maj+Tab, Ctrl+; (date du jour). | ✅ |
| S12 | P1 | **Filtres** (filtre automatique) et tri multi-critères. | ○ |
| S13 | P1 | **Graphiques** (barres, courbes, secteurs). | ○ (stockage additif à prévoir) |
| S14 | P1 | Formats de nombre : pas de date, monnaie paramétrable, séparateur de milliers explicite, format personnalisé. | ✅ partiel (Date, Milliers) ; ○ format personnalisé |
| S15 | P2 | Figer les volets limité à 1re ligne / 1re colonne. | ○ |
| S16 | P2 | Références entre onglets (`Feuil2!A1`), plages nommées. | ○ |
| S17 | P2 | Fusion de cellules, bordures, retour à la ligne, alignement vertical. | ○ |
| S18 | P2 | Mise en forme conditionnelle, validation de données, listes déroulantes. | ○ |
| S19 | P2 | Import/export **.xlsx**. | ○ |
| S20 | P3 | Tableaux croisés dynamiques, fonctions matricielles dynamiques. | ○ |

## Slides vs PowerPoint web

| # | Prio | Écart constaté | État |
|---|---|---|---|
| P1 | P0 | **Pas de menu contextuel** sur la diapositive ni sur les vignettes. | ✅ éléments (couper/copier/coller/dupliquer/premier plan/arrière-plan/supprimer) et vignettes (nouvelle, dupliquer, monter/descendre, supprimer) |
| P2 | P0 | Glyphes `＋` pleine chasse rendus en « tofu » (▯) sans police CJK (boutons Diapositive, Onglet, filmstrip). | ✅ remplacés par des icônes SVG |
| P3 | P1 | **Pas de trieuse de diapositives** (vue grille pour réorganiser). | ✅ vue Trieuse (grille, glisser/clavier, ouverture au double-clic) |
| P4 | P1 | **Pas de couleur de remplissage** des formes. | ✅ remplissage (6 jetons) persisté — migration additive |
| P5 | P1 | Copier/coller limité à l'éditeur (pas le presse-papiers système) ; coller du texte brut ne crée pas de zone de texte. | ✅ coller du texte crée une zone de texte |
| P6 | P1 | **Mode présentateur** séparé (diapo suivante, notes, minuteur dans une 2e fenêtre). | ○ |
| P7 | P1 | Pas de **rotation** des éléments. | ✅ rotation (poignée Maj = pas de 15°) — migration additive |
| P8 | P1 | Texte brut par zone (pas de mise en forme par mot), pas de police. | ○ |
| P9 | P2 | Tableaux, graphiques, vidéos, icônes. | ○ |
| P10 | P2 | Animations d'éléments, masques/modèles, thèmes personnalisés. | ○ |
| P11 | P2 | Masquer une diapositive, sections. | ○ |
| P12 | P2 | Import/export **.pptx**, export PDF dédié. | ○ |

## Transverse

- Collaboration temps réel : Docs seulement (Yjs) ; Sheets/Slides en verrou optimiste. ○
- Interop OOXML (docx/xlsx/pptx) : absente — c'est la prochaine marche « vrai produit » après celle-ci. ○
