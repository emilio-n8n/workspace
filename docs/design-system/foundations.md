# Design system — fondations

> Direction : **« Papier & encre »** — surfaces papier chaudes, encre profonde, **un accent evergreen**, ambre pour l'attention, et une **couleur d'identité par application** (petites marques uniquement). Typographies **auto-hébergées** (aucun CDN). Source des valeurs : `packages/design-tokens/` (`tokens.css`, `fonts.css`). Règle absolue : **aucune couleur, ombre ou rayon codé en dur dans un composant**.

## Principes

1. **Une suite, des applications distinctes.** Chaque application a son site, son port/sous-domaine et son domaine de responsabilité ; l'identité visuelle est commune (mêmes tokens, mêmes composants), la navigation est assurée par le **rail d'applications**, le **lanceur** (grille 9 points) et la **palette de commandes ⌘K**.
2. **Tokens sémantiques uniquement.** `bg-background`, `text-foreground`, `bg-surface`, `border-border`, `bg-primary`, `bg-rail`, `text-app-drive`, `text-file-pdf`… — jamais `bg-white`, `bg-[#…]`.
3. **Parité clair/sombre complète.** Chaque token a ses deux valeurs ; un composant qui ne fonctionne que dans un thème est refusé.
4. **Sobriété.** Pas de dégradés décoratifs, pas de glassmorphism ; les bordures structurent, les ombres (`shadow-soft`, `shadow-lift`) sont réservées aux surfaces flottantes.
5. **Performance perçue.** Transitions ≤ 160 ms, pas d'animation d'entrée par page, aucune police d'icônes (icônes SVG maison, 16 px, stroke 1,6).
6. **Accessibilité intégrée.** Contraste AA, focus visible (`ring` 2 px), navigation clavier complète (⌘K, Échap ferme les menus), HTML sémantique, cibles ≥ 32 px.

## Typographie

- **Interface** : **Public Sans** (variable, OFL, auto-hébergée) — lisible, neutre, professionnelle.
- **Display** : **Bricolage Grotesque** (variable 500-700, OFL, auto-hébergée) — titres `h1-h3`, marque, chiffres de mise en avant : c'est la signature visuelle de la suite.
- **Monospace** : pile système.
- Chargement : `fonts.css` (sous-ensemble latin, `font-display: swap`) — aucun appel réseau tiers.

## Couleur

- Neutres **chauds** (papier ~hue 85 en clair, encre ~hue 75 en sombre) ; `surface` pour les barres, `rail` (sombre, hue 160) pour le rail d'applications.
- **Primary evergreen** (`oklch(0.42 0.075 168)` en clair, éclairci en sombre) : actions principales, sélection.
- **Attention ambre** : avertissements, échéances proches — jamais pour des actions.
- **Tons par application** (`--app-drive`, `--app-docs`…) : réservés aux icônes et pastilles d'identité, jamais aux surfaces.
- **Couleurs de fichiers** (`--file-*`) : icônes des types de fichiers dans Drive — contenu, pas interface.

## Espace, forme, mouvement

- Rayon de base `--radius` = 10 px (`sm/md/lg/xl` déclinés) ; grille 4 px ; densité d'outil (tableaux compacts, padding 8-12 px).
- Ombres : `shadow-soft` (cartes, barre), `shadow-lift` (popovers, dialogues).
- Mouvement : uniquement fonctionnel (menus, dialogues, indicateurs) ; jamais d'animation décorative.

## Shell partagé (package `ui`)

- **Rail d'applications** (76 px) : marque, applications livrées (état actif), palette ⌘K.
- **Barre supérieure** : nom de l'application active, recherche/palette, lanceur, thème, menu du compte (organisations + jetons + déconnexion).
- **Palette ⌘K** (cmdk) : navigation vers les applications, actions (thème, jetons).
- **Registre `SUITE_APPS`** : source unique des applications (nom, description, phase, ton, livrée) — le lanceur n'affiche jamais un lien mort, les applications non livrées portent leur phase.

## Composants

- Base : boutons, champs, sélecteurs, dialogues natifs (`<dialog>`), badges, cartes — variantes `cva`, tokens uniquement.
- Un composant = une API de variantes documentée ; pas d'explosion de props booléennes.
- Chaque composant existe en clair **et** sombre, utilisable au clavier.

## Ce qui est proscrit

- Couleurs en dur, dégradés violet/indigo, glassmorphism, cartes arrondies partout.
- Polices chargées depuis un CDN externe (violation self-host + vie privée).
- Applications qui introduisent leurs propres couleurs, espacements ou composants sans validation (voir ADR-0012 et le registre).
- Faux liens : une application non livrée est affichée avec sa phase, jamais cliquable vers une page vide.
