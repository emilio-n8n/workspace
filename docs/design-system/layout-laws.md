# Design system — lois de layout (mathématiques du papier)

> Chaque valeur est dérivée, pas choisie au hasard. Base : **1 unité = 4 px**
> (Tailwind : `p-1` = 4 px). Tout espacement de l'interface est un multiple
> de 4 ; les demis-pas (2 px) sont réservés aux bordures internes de grilles
> denses (cellules, onglets), jamais aux blocs. La vérification du contraste
> des tokens est **calculée** (`pnpm check:design`, conversion OKLCH→sRGB +
> WCAG 2.1) — les valeurs ne sont pas « à l'œil ».

## 1. Grille spatiale

| Usage | Valeur | Formule |
|---|---|---|
| Rail d'applications | 76 px | 19 u |
| Barre supérieure | 56 px | 14 u |
| Padding de contenu | 16 px / 24 px (md) | 4 u / 6 u |
| Gouttière entre cartes | 12 px | 3 u |
| Padding de carte (interne) | 16 px | 4 u |
| Hauteur de champ / bouton | 36 px | 9 u |
| Cible tactile minimale | 32 px (souris), 44 px (tactile) | 8 u / 11 u |

**Loi du viewport** : la coquille est une colonne `100dvh` fixe. La zone
`#contenu` occupe `100dvh − 56px`, se défile seule, et les pages pleine
hauteur utilisent `h-full` — aucun `calc(100vh − X)` n'est autorisé (quatre
valeurs magiques divergentes ont été supprimées pour cette raison).

## 2. Largeurs de contenu

Dérivées de la mesure de lecture (≈ 75 caractères à 16 px ≈ 66ch ≈ 672 px) :

| Rôle | Largeur | Formule |
|---|---|---|
| Liste / grille d'applications | 896 px (`max-w-4xl`) | 56 u |
| Éditeur de document (confort de lecture) | 768 px (`max-w-3xl`) | 48 u |
| Deux panneaux (Chat, Mail, Tasks) | 1152 px (`max-w-6xl`) | 72 u |
| Dialogue standard | 448 px (`max-w-md`) | 28 u |
| Dialogue éditeur | 672 px (`max-w-2xl`) | 42 u |
| Formulaire public | 576 px (`max-w-xl`) | 36 u |

## 3. Échelle typographique

Ratio ≈ 1,2 (petite seconde), hauteurs de ligne rationnelles (arrondies au
pas de 4 px) :

| Rôle | Taille / interligne | Usage |
|---|---|---|
| `text-xs` | 12 / 16 | Métadonnées, badges, `kbd` (jamais en dessous de 12 px) |
| `text-sm` | 14 / 20 | Interface dense (tableaux, listes, contrôles) |
| `text-base` | 16 / 24 | Corps de texte |
| `text-lg` | 18 / 28 | Sous-titres d'éditeur |
| `text-xl` | 20 / 28 | Titres d'éditeurs (Calendar) |
| `text-2xl` | 24 / 32 | **H1 de page — unique, partout** |
| `text-3xl` | 30 / 36 | Accueil marketing uniquement |

**Lois de tête** : un seul `h1` par page, `font-display` (Bricolage
Grotesque), `tracking-tight` ; les nombres (dates, tailles, notes, compteurs)
portent `tabular-nums`.

## 4. Grilles denses (dérivées)

- **Calendar — mois** : 42 cellules = 6 semaines × 7 jours, cellule
  `min-h-28` (112 px = 28 u) ; 3 pastilles + compteur « +n ».
- **Sheets** : en-tête de ligne 44 px (11 u), colonne minimale 96 px (24 u),
  ligne 32 px (8 u) ; zone visible `max-h-[70vh]`.
- **Slides** : canvas 16:9, unité de design 960 × 540 ; les positions des
  éléments sont des pourcentages (0-100) ; la police d'un élément est
  `px_design × 100cqw / 960` (container query sur la diapositive).
- **Rail** : icônes 44 × 44 px (11 u), rayon 12 px (3 u) ; la colonne défile
  au-delà de 10 applications (14 livrées ≈ 790 px).

## 5. Formes et profondeur

- Rayon : `sm` 6 px, `md` 10 px (contrôles), `lg` 12 px (cartes), `xl` 14 px
  (dialogues, panneaux).
- Ombres : `shadow-soft` (cartes, barres), `shadow-lift` (popovers,
  dialogues) — aucune ombre Tailwind par défaut (`shadow-xs/lg`) n'est
  autorisée : les trois niveaux d'ombre historiques ont été ramenés à deux.
- Scrim : token `--overlay` (foncé dans les deux thèmes), jamais
  `foreground/30` (qui donnait un voile clair en mode sombre).

## 6. Mouvement

- Durée : 120 ms (survol), 160 ms (entrée de menu), 200 ms (dialogues) ;
  courbe unique `ease-out`. Aucune animation décorative.

## 7. Application

- `pnpm check:design` — contraste WCAG calculé sur 13 paires × 2 thèmes.
- Le présent document fait foi en cas de litige sur un pixel.
