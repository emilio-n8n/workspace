import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { nextGridIndex } from "./date-grid.ts";

export type UseDayGridOptions = {
  /** Nombre de cases de la grille. */
  count: number;
  /** Colonnes de la grille (7 pour un mois, autant que de jours affichés). */
  columns: number;
  /** Page haut / Page bas : période précédente / suivante. */
  onPage: (direction: 1 | -1) => void;
  /** Entrée ou Espace sur une case. */
  onActivate?: (index: number) => void;
  /** Case focusée au montage. */
  initialIndex?: number;
};

export type DayGridCellProps = {
  ref: (node: HTMLElement | null) => void;
  tabIndex: number;
  "data-cell-index": number;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

/** Lit l'index de case porté par `data-cell-index`. */
function cellIndexOf(target: EventTarget | null): number | null {
  const index = (target as HTMLElement | null)?.dataset?.cellIndex;
  if (index === undefined) return null;
  const value = Number(index);
  return Number.isNaN(value) ? null : value;
}

/**
 * Navigation clavier d'une grille de jours : focus mobile (une seule case
 * atteignable par Tab), flèches, Début / Fin, Page haut / bas, Entrée.
 *
 * Les cases restent des éléments conteneurs (`<td>` ou `<div>`) : les boutons
 * qu'elles contiennent (créer, ouvrir un événement) gardent leur propre
 * tabulation. Le gestionnaire de touches n'agit que lorsque la case elle-même
 * a le focus, pour ne pas doubler l'action d'un bouton interne.
 */
export function useDayGrid(options: UseDayGridOptions) {
  const { count, columns, onPage, onActivate } = options;
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(options.initialIndex ?? 0);
  const pendingFocus = useRef(false);

  // Hors bornes (changement de vue, mois plus court) : la dernière case prend
  // le relais pour qu'une grille garde toujours une case atteignable.
  const safeIndex = count > 0 ? Math.min(focusIndex, count - 1) : 0;

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    refs.current[safeIndex]?.focus();
  }, [safeIndex]);

  function cellProps(index: number): DayGridCellProps {
    return {
      ref: (node) => {
        refs.current[index] = node;
      },
      tabIndex: index === safeIndex ? 0 : -1,
      "data-cell-index": index,
      onFocus: () => setFocusIndex(index),
      onKeyDown: (event) => {
        const index = cellIndexOf(event.currentTarget);
        if (index === null || index !== cellIndexOf(event.target)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate?.(index);
          return;
        }
        if (event.key === "PageUp" || event.key === "PageDown") {
          event.preventDefault();
          onPage(event.key === "PageUp" ? -1 : 1);
          return;
        }
        const next = nextGridIndex(index, columns, count, event.key);
        if (next === null) return;
        event.preventDefault();
        pendingFocus.current = true;
        setFocusIndex(next);
      },
    };
  }

  return { focusIndex: safeIndex, cellProps };
}
