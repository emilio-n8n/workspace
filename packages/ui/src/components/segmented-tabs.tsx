import { type KeyboardEvent, useRef } from "react";
import { cn } from "../cn.ts";

export type SegmentedTabItem<T extends string = string> = {
  id: T;
  label: string;
};

export type SegmentedTabsProps<T extends string = string> = {
  items: SegmentedTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
};

/**
 * Onglets segmentés — véritable tablist ARIA horizontal : les flèches
 * gauche/droite déplacent le focus et sélectionnent l'onglet (tabindex mobile,
 * un seul onglet focusable).
 */
export function SegmentedTabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(delta: 1 | -1) {
    const index = items.findIndex((item) => item.id === value);
    if (index === -1 || items.length === 0) return;
    const nextIndex = (index + delta + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current[nextIndex]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex overflow-hidden rounded-lg border border-border", className)}
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
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={onKeyDown}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
