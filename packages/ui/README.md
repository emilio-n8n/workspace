# @workspace/ui — primitifs partagés

Bibliothèque de primitifs de la suite « Workspace » (React 19 + Tailwind v4 +
`class-variance-authority`). Les composants n'écrivent jamais une couleur en
dur : **uniquement des tokens sémantiques** (`bg-card`, `text-muted-foreground`,
`ring`, …), thème clair et sombre compris.

Cette série d'ajouts est **strictement additive** : aucun fichier existant n'a
été modifié. Les nouveaux primitifs vivent dans `src/components/`, les styles
additifs dans `src/styles/`, les hooks dans `src/hooks/`.

---

## 1. Brancher les ajouts (deux lignes dans des fichiers existants)

L'ajout de fichiers n'a volontairement touché à aucun fichier existant. Pour que
les nouveaux exports sortent du paquet, il reste **deux modifications d'une
ligne chacune** dans des fichiers existants (à faire par le propriétaire du
paquet, hors périmètre additif) :

**a) `packages/ui/src/index.ts`** — ajouter, dans l'ordre alphabétique du
fichier :

```ts
export {
  type MenuItem,
  Menu,
  type MenuProps,
} from "./components/menu.tsx";
export {
  type SelectOption,
  Select,
  type SelectProps,
} from "./components/select.tsx";
export {
  Sheet,
  type SheetProps,
  type SheetSide,
} from "./components/sheet.tsx";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  type TableCellProps,
  TableFooter,
  TableHead,
  type TableHeadProps,
  TableHeader,
  TableRow,
  type TableAlign,
} from "./components/table.tsx";
export {
  type TabItem,
  Tabs,
  type TabsProps,
  TabsPanel,
  type TabsPanelProps,
} from "./components/tabs.tsx";
export {
  Tooltip,
  type TooltipProps,
  type TooltipSide,
} from "./components/tooltip.tsx";
```

Vague 2 (squelettes, états vides, badges, raccourcis, helpers) — mêmes
fichiers `src/index.ts` / `src/hooks` / `src/lib` :

```ts
export { CountBadge, DotBadge } from "./components/count-badge.tsx";
export {
  EmptyStateBlock,
  type EmptyStateBlockProps,
} from "./components/empty-state-block.tsx";
export {
  Shortcut,
  type ShortcutKey,
  ShortcutList,
  ShortcutListRow,
} from "./components/shortcut.tsx";
export {
  LoadingRegion,
  type LoadingRegionProps,
  Skeleton,
  SkeletonCard,
  SkeletonCircle,
  SkeletonTable,
  SkeletonText,
  type SkeletonProps,
} from "./components/skeleton.tsx";
export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusBadgeSize,
  type StatusBadgeTone,
  statusBadgeVariants,
} from "./components/status-badge.tsx";
export { useOverlayBehavior, type OverlayBehaviorOptions } from "./hooks/use-overlay-behavior.ts";
export { pluralizeFr } from "./lib/french-text.ts";
export {
  FOCUSABLE_SELECTOR,
  getFocusableElements,
  lockScroll,
  trapFocus,
  type TrapFocusOptions,
} from "./lib/overlay.ts";
```

> **Extension réelle des exports** : les composants sont exportés en `.tsx`
> (`./components/skeleton.tsx`), les hooks et utilitaires en `.ts`
> (`./hooks/use-overlay-behavior.ts`). Un `.ts` sur un fichier `.tsx` casse le
> build Vite (module introuvable).

**b) `packages/ui/package.json`** — exposer les feuilles de style additives :

```json
"exports": {
  ".": "./src/index.ts",
  "./focus.css": "./src/styles/focus.css",
  "./reduced-motion.css": "./src/styles/reduced-motion.css"
}
```

> En attendant (a), les consommateurs peuvent importer directement le fichier :
> `import { Select } from "../../packages/ui/src/components/select.tsx";`
> Le chemin relatif est déjà utilisé pour les sources Tailwind
> (`@source "../../../packages/ui/src"`).

---

## 2. Feuilles de style additives

À importer **après les tokens** (l'ordre de la cascade fait la cohérence), dans
le `styles.css` de l'application ou du module :

```css
@import "tailwindcss" source(none);
@import "@workspace/design-tokens/fonts.css";
@import "@workspace/design-tokens/tokens.css";

@import "@workspace/ui/focus.css";
@import "@workspace/ui/reduced-motion.css";
```

| Fichier                  | Rôle                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/styles/focus.css`   | Un seul anneau de focus pour toute la suite (2 px, `--ring`, décalage 2 px) : liens, boutons, champs et rôles ARIA pilotés au clavier. Pas d'anneau au clic souris, couleur système en contrastes forcés. Utilitaires `.focus-ring` (focus virtuel, `aria-activedescendant`) et `.focus-ring-none` (opt-out). |
| `src/styles/reduced-motion.css` | Sous `prefers-reduced-motion: reduce` : transitions et animations décoratives neutralisées, indicateurs d'activité (`.animate-spin`, `.animate-pulse`) ralentis à 2 s / 2,4 s.                                |

---

## 3. Hook de mouvement

```ts
import { usePrefersReducedMotion } from "@workspace/ui";

const reduced = usePrefersReducedMotion();
const duration = reduced ? 0 : 240; // ms, pour une animation JS
```

- `usePrefersReducedMotion()` — état React abonné au réglage système.
- `prefersReducedMotion()` — lecture ponctuelle (hors rendu, `false` si
  l'API `matchMedia` manque).

---

## 4. Primitifs

### `Tabs` / `TabsPanel` — onglets

```tsx
// import { useId } from "react";
const prefix = useId(); // ou n'importe quelle chaîne stable

<Tabs
  ariaLabel="Vues du dossier"
  idPrefix={prefix}
  value={onglet}
  onChange={setOnglet}
  items={[
    { id: "liste", label: "Liste" },
    { id: "grille", label: "Grille" },
    { id: "archive", label: "Archives", disabled: true },
  ]}
/>
{onglet === "liste" ? (
  <TabsPanel idPrefix={prefix} tabId="liste">
    …
  </TabsPanel>
) : null}
```

- Motif ARIA « tabs » complet : `tablist`, flèches (ou haut/bas en
  `orientation="vertical"`), Début/Fin, onglets désactivés ignorés,
  `tabindex` mobile, `aria-selected`.
- `idPrefix` relie les onglets à leurs panneaux ; à fournir dès que le
  `tablist` et le panneau sont rendus dans deux composants distincts.

### `Table` — tableau sémantique

```tsx
<Table>
  <TableCaption>Fichiers du dossier</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead>Nom</TableHead>
      <TableHead align="right" className="w-24">
        Taille
      </TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {fichiers.map((f) => (
      <TableRow key={f.id} aria-selected={f.id === selection}>
        <TableCell className="font-medium">{f.nom}</TableCell>
        <TableCell numeric>{f.taille}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

- `<table>` / `<thead>` / `<tbody>` / `<tfoot>` / `<tr>` / `<th scope="col">` /
  `<td>` / `<caption>` : sémantique native, défilement horizontal automatique.
- `align`: `"left" | "center" | "right"` ; `numeric` aligne à droite en
  chiffres tabulaires ; `aria-selected` sur `TableRow` colore la ligne via le
  token `accent` ; `TableCaption` accepte `visuallyHidden`.

### `Select` — liste déroulante accessible

```tsx
<Select
  label="Droit d'accès"
  hint="S'applique à tous les membres du dossier."
  value={droit}
  onChange={setDroit}
  options={[
    { value: "lecture", label: "Lecture seule" },
    { value: "ecriture", label: "Écriture" },
    { value: "admin", label: "Administrateur", disabled: true },
  ]}
/>
```

- Motif ARIA « combobox à liste seule » (WAI-ARIA APG) : le focus reste sur le
  déclencheur, l'option active est annoncée par `aria-activedescendant`.
- Clavier : Entrée/Espace/flèches ouvrent, flèches naviguent, Début/Fin,
  Entrée valide, Échap annule, Tab valide et sort. La frappe au clavier saute
  au libellé voulu, **accents ignorés** (« eteint » trouve « Éteint »).
- `value` vaut `null` quand rien n'est sélectionné (`placeholder` : « Sélectionner… »).

### `Menu` — menu déroulant

```tsx
<Menu
  label="Actions"
  triggerIcon={<span>⋯</span>}
  items={[
    { id: "renommer", label: "Renommer", shortcut: "F2", onSelect: renommer },
    { id: "dupliquer", label: "Dupliquer", shortcut: "⌘ D", onSelect: dupliquer },
    { id: "partager", label: "Partager…", separated: true, onSelect: partager },
    { id: "supprimer", label: "Supprimer", destructive: true, onSelect: supprimer },
  ]}
/>
```

- `role="menu"` / `role="menuitem"`, `aria-haspopup`, `aria-expanded`.
- Clavier intégral : flèches, Début/Fin, frappe de lettres, Entrée/Espace,
  Échap referme **en rendant le focus au déclencheur**, Tab referme et laisse
  la navigation continuer.
- `separated` trace un filet (`Separator` existant), `destructive` colore en
  `destructive`, `open`/`onOpenChange` permettent le pilotage extérieur.

### `Tooltip` — infobulle

```tsx
<Tooltip content="Copier le lien de partage">
  <Button variant="ghost" aria-label="Copier le lien">
    <LinkIcon />
  </Button>
</Tooltip>
```

- Association par `aria-describedby` sur l'élément déclencheur : l'infobulle est
  **annoncée** par les lecteurs d'écran, pas seulement visible.
- Apparition au survol souris ou au focus clavier (jamais au focus souris),
  disparition au départ, à la perte du focus ou avec Échap ; `delay` en ms.
- Les gestionnaires de l'enfant sont conservés (composition, pas d'écrasement).

### `Sheet` — panneau latéral

```tsx
<Sheet
  open={details}
  onClose={() => setDetails(false)}
  title="Détails du fichier"
  description="Nom, taille et droits"
  side="right"
  footer={<Button onClick={() => setDetails(false)}>Fermer</Button>}
>
  …
</Sheet>
```

- Élément natif `<dialog>` en `showModal()` : focus piégé, fermeture par Échap,
  reste de la page inertée. Titre par `aria-labelledby`, description par
  `aria-describedby`.
- `side`: `"right" | "left"` ; largeur par défaut `max-w-md`, débordable via
  `className`.

### `Skeleton` — placeholders de chargement

```tsx
<LoadingRegion>
  <SkeletonCard lines={3} />
</LoadingRegion>

<SkeletonTable rows={5} columns={4} />
```

- `Skeleton` : bloc neutre (`bg-muted`, `animate-pulse`), **`aria-hidden`** — le
  squelette ne porte jamais l'état accessible.
- `SkeletonText` (`lines`, `lastLineWidth`), `SkeletonCircle` (`size`),
  `SkeletonCard` (`lines`), `SkeletonTable` (`rows`, `columns`).
- `SkeletonTable` réutilise les primitifs `Table` réels : la mise en page ne
  saute pas à l'arrivée des données.

### `LoadingRegion` — état de chargement annoncé

```tsx
<LoadingRegion label="Chargement des fichiers…">
  <SkeletonTable />
</LoadingRegion>
```

- `role="status"` + `aria-busy="true"` + libellé en lecture seule d'écran :
  c'est **le seul nœud porteur de l'état**, les squelettes restant invisibles.
- Sous `prefers-reduced-motion`, la pulsation est ralentie (2 s) plutôt que
  supprimée : l'activité reste perceptible.

### `EmptyStateBlock` — état vide enrichi

```tsx
<EmptyStateBlock
  icon={<FolderIcon />}
  title="Aucun fichier"
  description="Déposez un fichier ou créez un dossier pour commencer."
  secondaryAction={<Button variant="ghost">Importer</Button>}
  action={<Button>Créer un dossier</Button>}
  bare
/>
```

- Grand frère de `EmptyState` : deux actions, description libre, variante
  `bare` (sans bordure ni fond, pour un panneau déjà bordé).
- `role="status"` : le message est annoncé dès son apparition (liste filtrée
  sans résultat, dossier vide), là où un paragraphe muet ne l'est pas.

### `StatusBadge` — pastille d'état

```tsx
<StatusBadge tone="success" dot>
  Actif
</StatusBadge>
<StatusBadge tone="warning">En attente</StatusBadge>
```

- Cinq tons : `neutral`, `info`, `success`, `warning`, `danger` ; tailles `sm`
  et `md` ; `dot` affiche une pastille colorée devant le libellé.
- Le libellé reste **normatif** : `warning` et `danger` s'emploient avec un
  texte explicite, jamais seuls (l'information ne repose pas sur la couleur).
- Couleurs issues des tokens sémantiques (`accent`, `attention`, `destructive`),
  thème clair et sombre compris.

### `CountBadge` / `DotBadge` — compteurs et points d'état

```tsx
<CountBadge count={12} />
<CountBadge count={130} label="message" />
<CountBadge count={3} destructive label="échec" />
<DotBadge tone="accent" label="Non lu" />
```

- `CountBadge` : nombre en chiffres tabulaires, **masqué au-delà de `max`**
  (`99+` par défaut) ; le texte lu par les lecteurs d'écran est un pluriel
  français correct via `pluralizeFr` (« 1 élément », « 12 éléments »).
- `DotBadge` : point de 8 px (`tone` : `primary`, `accent`, `destructive`,
  `attention`) toujours accompagné d'un `label` annoncé.
- `pluralizeFr(n, singulier, pluriel?)` — « 2 non lus » avec un pluriel
  irrégulier : `pluralizeFr(n, "non lu", "non lus")`.

### `Shortcut` / `ShortcutList` / `ShortcutListRow` — aide clavier

```tsx
<Shortcut keys={["⌘", "K"]} />
<Shortcut keys={[{ keys: "⌘", label: "Commande" }, "K"]} />

<ShortcutList>
  <ShortcutListRow action="Ouvrir la palette" keys={["⌘", "K"]} />
  <ShortcutListRow action="Enregistrer" keys={["⌘", "S"]} />
</ShortcutList>
```

- `Shortcut` : `<fieldset>` inline avec `<legend>` en lecture seule d'écran ;
  le nom accessible est « Raccourci : ⌘ + K », les glyphes n'étant que visuels.
  Une touche accepte un libellé (`{ keys: "⌘", label: "Commande" }`).
- `ShortcutList` : liste de définitions (`<dl>`) ; `ShortcutListRow` aligne
  l'action à gauche et les puces `Kbd` à droite.

---

## 5. Helpers de superposition (verrou de défilement, focus trap)

Pour un panneau **non `<dialog>`** (palette de commandes, popover, tiroir
maison) :

```tsx
const panelRef = useRef<HTMLDivElement>(null);

useOverlayBehavior({
  active: ouvert,
  container: panelRef,
  onEscape: () => setOuvert(false),
});

return (
  <div ref={panelRef} role="dialog" aria-modal="true">
    …
  </div>
);
```

- `lockScroll()` — fige le défilement de la page et compense la barre pour
  éviter le saut de mise en page ; **compté** entre appels concurrents (le
  défilement n'est restauré qu'au dernier déverrouillage). Retourne la fonction
  de déverrouillage.
- `trapFocus(container, { onEscape, autoFocus })` — Tab / Maj+Tab cyclent dans
  le conteneur, Échap appelle `onEscape` (la fermeture reste à l'appelant).
  Retourne la fonction de nettoyage.
- `getFocusableElements(container)` / `FOCUSABLE_SELECTOR` — détection des
  éléments focalisables (exclut `aria-hidden`, `tabindex` négatif et champs
  désactivés).
- `useOverlayBehavior({ active, container, onEscape, restoreFocus, autoFocus })`
  — branche les trois ci-dessus et **rend le focus** à l'élément actif à la
  fermeture. À n'utiliser que hors `<dialog>` : `Dialog` et `Sheet` s'appuient
  sur `showModal()`, qui gère déjà focus, inertie et Échap.

---

## 6. Règles de contribution

1. **Tokens sémantiques uniquement** — jamais de couleur littérale, jamais de
   `text-white` / `bg-black`.
2. **Libellés par défaut en français impeccable** (« Fermer », « Sélectionner… »,
   « Aucune option », « Annuler »).
3. **Accessibilité native** — rôles ARIA explicites, navigation clavier
   complète, focus visible (les primitifs existants utilisent
   `focus-visible:ring-*`, la base globale reste la même teinte), contrastes
   assurés par les tokens.
4. **Additif** — cette série n'a modifié aucun fichier existant ; les éventuels
   correctifs de primitifs existants sont listés dans les rapports d'escouade,
   jamais appliqués en parallèle.
