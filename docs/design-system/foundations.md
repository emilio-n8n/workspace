# Design system — fondations

> Direction : **« instrument de précision »** — surfaces calmes, information dense sans encombrement, un seul accent, aucune décoration gratuite. Source des valeurs : `packages/design-tokens/tokens.css`. Règle absolue : **aucune couleur, ombre ou rayon codé en dur dans un composant**.

## Principes

1. **Une suite, une identité.** Tous les modules consomment les mêmes tokens et les mêmes composants de base.
2. **Tokens sémantiques uniquement.** `bg-background`, `text-foreground`, `bg-muted`, `border-border`, `bg-primary`… — jamais `bg-white`, `bg-[#123]` ou une couleur brute.
3. **Parité clair/sombre.** Chaque token a ses deux valeurs ; une interface qui ne fonctionne que dans un thème est refusée.
4. **Sobriété.** Pas de dégradés décoratifs, pas de glassmorphism, pas d'ombres portées pour « faire profond ». Les bordures structurent, les ombres sont réservées aux surfaces flottantes (menus, dialogues).
5. **Performance perçue.** Transitions courtes (≤ 150 ms), pas d'animation d'entrée sur chaque page, pas de bibliothèque d'icônes complète (imports nommés).
6. **Accessibilité intégrée.** Contraste AA minimum, focus visible par défaut (`ring`), navigation clavier complète, HTML sémantique, cibles ≥ 32 px (44 px tactile).
7. **Contenu clair.** Libellés en français au lancement ; les chaînes destinées à la traduction seront centralisées (i18n prévu, pas de texte enfoui).

## Couleur

- Neutres frais et calmes ; un **accent unique pétrole** (`primary`) ; `destructive` pour les actions dangereuses ; `accent` pour les états sélectionnés/survols.
- Tokens actuels : `background/foreground`, `card`, `muted`, `border/input/ring`, `primary`, `accent`, `destructive` (voir `tokens.css`).
- À ajouter avant leur premier usage : `success`, `warning`, `info` (état de messages système) — avec paires clair/sombre.

## Typographie

- **Décision en attente d'un prototype visuel** (Phase 1) entre :
  - **Geist** (grotesque neutre et précise, OFL) — cohérente, discrète ;
  - **Instrument Sans** (plus caractéristique, OFL) — identité plus marquée.
- Contrainte : **polices auto-hébergées** (aucun CDN de polices — confidentialité et self-host), sous-ensembles latins, `font-display: swap`.
- Monospace pour code et identifiants : Geist Mono ou JetBrains Mono.
- Échelle : 12/14/16 px texte, 16 px minimum pour les corps de documents ; titres **600** maximum.

## Forme, espace, mouvement

- Rayon de base `--radius` (8 px) décliné `sm/md/lg/xl` ; les contrôles s'alignent sur la grille d'espacement Tailwind (4 px).
- Densité : confortable par défaut ; un mode compact (tables) pourra être ajouté pour les écrans d'administration — testé avant adoption.
- Mouvement : uniquement fonctionnel (apparition de menus, chargements squelettes). Pas d'animation sur chaque interaction.

## Composants

- Base : boutons, champs, sélecteurs, menus, dialogues, badges, avatars, tables, onglets — construits sur Radix primitives (accessibilité) + variantes **cva**. Package : `packages/ui` (Phase 1).
- Un composant = une API de variantes documentée (`variant`, `size`, `disabled`, `loading`) ; pas d'explosion de props booléennes.
- Chaque composant doit exister en clair **et** sombre et être utilisable au clavier ; une page « vitrine » interne servira de référence visuelle vivante.

## Ce qui est proscrit

- `text-white` / `bg-black` / couleurs hexadécimales dans les composants.
- SVG décoratifs lourds, emojis dans la chrome d'interface, 3 tailles de texte pour le même niveau.
- Polices chargées depuis un CDN externe.
- Thème « IA générique » : dégradés violet/indigo, cartes arrondies partout, hero interchangeables (explicitement rejetés dans le brief produit).
