import { cn, IconChevronDown, IconGrid } from "@workspace/ui";
import type { ReactNode } from "react";
import { Menu, type MenuEntry } from "./menu.tsx";
import {
  ariaSortFor,
  DENSITIES,
  DENSITY_LABELS,
  DIRECTION_LABELS,
  defaultDirection,
  SORT_KEYS,
  SORT_LABELS,
  type SortKey,
  sortSummary,
  toggleDirection,
  type ViewPrefs,
} from "./view-prefs.ts";

/** Icône du tri (trois épaisseurs décroissantes), géométrie de la suite. */
function SortGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 4.5h10M3 8h7M3 11.5h4" />
    </svg>
  );
}

export type ViewControlsProps = {
  prefs: ViewPrefs;
  onChange: (next: ViewPrefs) => void;
};

/**
 * Barre de contrôle de l'affichage : menu « Trier » (nom, date, taille et sens)
 * et menu « Densité ». La persistance est du ressort de l'appelant ; ce
 * composant reste sans état.
 */
export function ViewControls({ prefs, onChange }: ViewControlsProps) {
  function applySortKey(key: SortKey) {
    onChange({
      ...prefs,
      sortKey: key,
      sortDirection:
        key === prefs.sortKey ? toggleDirection(prefs.sortDirection) : defaultDirection(key),
    });
  }

  const sortEntries: MenuEntry[] = [
    ...SORT_KEYS.map((key) => ({
      id: key,
      label: SORT_LABELS[key],
      checked: prefs.sortKey === key,
      hint: prefs.sortKey === key ? DIRECTION_LABELS[prefs.sortDirection] : undefined,
      onSelect: () => applySortKey(key),
    })),
    { id: "sep", separator: true },
    {
      id: "direction",
      label: `Ordre : ${DIRECTION_LABELS[prefs.sortDirection].toLowerCase()}`,
      icon: <SortGlyph />,
      onSelect: () => onChange({ ...prefs, sortDirection: toggleDirection(prefs.sortDirection) }),
    },
  ];

  const densityEntries: MenuEntry[] = DENSITIES.map((density) => ({
    id: density,
    label: DENSITY_LABELS[density],
    checked: prefs.density === density,
    onSelect: () => onChange({ ...prefs, density }),
  }));

  return (
    <div className="flex items-center gap-2">
      <Menu
        label={`Trier : ${sortSummary(prefs)}`}
        entries={sortEntries}
        trigger={() => (
          <>
            <SortGlyph />
            <span className="hidden sm:inline">Trier</span>
            <span className="sr-only sm:hidden">{`Trier : ${sortSummary(prefs)}`}</span>
            <IconChevronDown className="size-3.5" aria-hidden />
          </>
        )}
      />
      <Menu
        label={`Densité : ${DENSITY_LABELS[prefs.density]}`}
        entries={densityEntries}
        trigger={() => (
          <>
            <IconGrid className="size-4" aria-hidden />
            <span className="hidden sm:inline">Densité</span>
            <span className="sr-only sm:hidden">{`Densité : ${DENSITY_LABELS[prefs.density]}`}</span>
            <IconChevronDown className="size-3.5" aria-hidden />
          </>
        )}
      />
    </div>
  );
}

export type SortableColumnProps = {
  column: SortKey;
  prefs: ViewPrefs;
  onChange: (next: ViewPrefs) => void;
  label: string;
  /** Classes de la cellule d'en-tête (masquage responsive, alignement). */
  className?: string;
  children: ReactNode;
};

/**
 * En-tête de colonne triable : un clic change la clé de tri, un second clic
 * inverse le sens. `aria-sort` porte l'état pour les lecteurs d'écran, et la
 * flèche n'apparaît que sur la colonne qui trie réellement la liste.
 */
export function SortableColumn({
  column,
  prefs,
  onChange,
  label,
  className,
  children,
}: SortableColumnProps) {
  const active = prefs.sortKey === column;
  return (
    <th
      scope="col"
      aria-sort={ariaSortFor(column, prefs)}
      className={cn("px-4 py-2 font-medium", className)}
    >
      <button
        type="button"
        onClick={() =>
          onChange({
            ...prefs,
            sortKey: column,
            sortDirection: active ? toggleDirection(prefs.sortDirection) : defaultDirection(column),
          })
        }
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "text-foreground" : undefined,
        )}
        title={`${label} — ${sortSummary({ ...prefs, sortKey: column })}`}
      >
        {children}
        <span aria-hidden className="text-[0.7em]">
          {active ? (prefs.sortDirection === "asc" ? "↑" : "↓") : ""}
        </span>
        <span className="sr-only">{` — trier par ${SORT_LABELS[column]}`}</span>
      </button>
    </th>
  );
}

/** Rappel du tri et de la densité en cours, lisible sans survol. */
export function ViewControlsHint({ prefs }: { prefs: ViewPrefs }) {
  return (
    <p className="text-xs text-muted-foreground">
      {`Tri : ${sortSummary(prefs)} · Affichage ${DENSITY_LABELS[prefs.density].toLowerCase()}`}
    </p>
  );
}
