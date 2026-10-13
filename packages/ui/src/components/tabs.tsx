// biome-ignore-all lint/a11y/noNoninteractiveTabindex: le panneau d'onglet est focusable au clavier (tabindex 0), comme le recommande le motif ARIA « tabs ».

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { cn } from "../cn.ts";

/** Onglet individuel d'un jeu d'onglets. */
export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  /** Onglet visible mais non sélectionnable (ex. fonctionnalité à venir). */
  disabled?: boolean;
};

export type TabsProps<T extends string = string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Nom accessible du jeu d'onglets (ex. « Vues du dossier »). */
  ariaLabel: string;
  orientation?: "horizontal" | "vertical";
  /**
   * Préfixe des identifiants (onglet + panneau). Par défaut généré ; à fournir
   * seulement si le jeu d'onglets est rendu dans deux composants distincts.
   */
  idPrefix?: string;
  className?: string;
};

export type TabsPanelProps = {
  /** Préfixe renvoyé par `Tabs` (voir sa prop `idPrefix`). */
  idPrefix: string;
  /** Identifiant de l'onglet actif, tel que déclaré dans `TabItem.id`. */
  tabId: string;
  /** Nom accessible du panneau (utilisé si le libellé de l'onglet est insuffisant). */
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
};

const ORIENTATION_KEYS: Record<"horizontal" | "vertical", { next: string; previous: string }> = {
  horizontal: { next: "ArrowRight", previous: "ArrowLeft" },
  vertical: { next: "ArrowDown", previous: "ArrowUp" },
};

/**
 * Onglets — véritable `tablist` ARIA : les flèches déplacent le focus et
 * sélectionnent l'onglet suivant (activation automatique), Début/Fin sautent
 * aux extrémités, les onglets désactivés sont ignorés. Orientation horizontale
 * ou verticale via `aria-orientation`.
 */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  orientation = "horizontal",
  idPrefix,
  className,
}: TabsProps<T>) {
  const generatedId = useId();
  const prefix = idPrefix ?? generatedId;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const keys = ORIENTATION_KEYS[orientation];

  function focusIndex(index: number) {
    const item = items[index];
    if (!item) return;
    onChange(item.id);
    refs.current[index]?.focus();
  }

  function move(delta: 1 | -1) {
    const count = items.length;
    if (count === 0) return;
    const current = items.findIndex((item) => item.id === value);
    for (let step = 1; step <= count; step += 1) {
      const index = ((((current === -1 ? 0 : current) + delta * step) % count) + count) % count;
      if (!items[index]?.disabled) {
        focusIndex(index);
        return;
      }
    }
  }

  function edge(which: "first" | "last") {
    const index = which === "first" ? 0 : items.length - 1;
    const target = items[index];
    if (target && !target.disabled) {
      focusIndex(index);
      return;
    }
    move(1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === keys.next) {
      event.preventDefault();
      move(1);
    } else if (event.key === keys.previous) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      edge("first");
    } else if (event.key === "End") {
      event.preventDefault();
      edge("last");
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cn(
        "flex",
        orientation === "vertical"
          ? "flex-col items-stretch border-r border-border"
          : "items-center border-b border-border",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${item.id}`}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={onKeyDown}
            className={cn(
              "relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Panneau d'onglet — focusable (Tab), rattaché à son onglet par
 * `aria-labelledby`, masqué aux lecteurs d'écran tant qu'il n'est pas affiché.
 */
export function TabsPanel({ idPrefix, tabId, ariaLabel, children, className }: TabsPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabId}`}
      aria-labelledby={`${idPrefix}-tab-${tabId}`}
      aria-label={ariaLabel}
      tabIndex={0}
      className={cn(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}
