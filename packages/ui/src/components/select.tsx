import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "../cn.ts";
import { startsWithQuery } from "../lib/text-match.ts";
import { Label } from "./label.tsx";

export type SelectOption = {
  value: string;
  label: string;
  /** Option visible mais non sélectionnable. */
  disabled?: boolean;
};

export type SelectProps = {
  /** Libellé affiché au-dessus du sélecteur (obligatoire : il nomme le combobox). */
  label: string;
  options: SelectOption[];
  /** Valeur choisie, ou `null` lorsqu'aucune option n'est sélectionnée. */
  value: string | null;
  onChange: (value: string) => void;
  /** Texte affiché quand rien n'est sélectionné (défaut : « Sélectionner… »). */
  placeholder?: string;
  disabled?: boolean;
  /** Texte d'aide affiché sous le sélecteur. */
  hint?: string;
  className?: string;
};

const ACTIVATION_KEYS = ["ArrowDown", "ArrowUp", "Enter", " "];

/**
 * Sélecteur — liste déroulante accessible bâtie sur le motif ARIA
 * « combobox à liste seule » (WAI-ARIA APG) : le focus reste sur le déclencheur,
 * l'option active est annoncée par `aria-activedescendant`, flèches / Début /
 * Fin naviguent, Entrée ou clic valident, Échap annule. Frappe au clavier
 * tolérante aux accents (ex. « eteint » trouve « Éteint »).
 */
export function Select({
  label,
  options,
  value,
  onChange,
  placeholder = "Sélectionner…",
  disabled = false,
  hint,
  className,
}: SelectProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const triggerId = `${baseId}-trigger`;
  const valueId = `${baseId}-value`;
  const listId = `${baseId}-list`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const queryRef = useRef("");
  const queryTimer = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(
    () => () => {
      if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  }

  function step(delta: 1 | -1): number {
    const count = options.length;
    if (count === 0) return 0;
    for (let offset = 1; offset <= count; offset += 1) {
      const index =
        ((((activeIndex < 0 ? 0 : activeIndex) + delta * offset) % count) + count) % count;
      if (!options[index]?.disabled) return index;
    }
    return activeIndex;
  }

  function edge(which: "first" | "last") {
    const range = which === "first" ? options.keys() : [...options.keys()].reverse();
    for (const index of range) {
      if (!options[index]?.disabled) {
        setActiveIndex(index);
        return;
      }
    }
  }

  function search(character: string) {
    const nextQuery = (queryRef.current + character).slice(0, 24);
    queryRef.current = nextQuery;
    if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => {
      queryRef.current = "";
    }, 600);

    const index = options.findIndex(
      (option) => !option.disabled && startsWithQuery(option.label, nextQuery),
    );
    if (index >= 0) setActiveIndex(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (ACTIVATION_KEYS.includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(step(1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(step(-1));
    } else if (event.key === "Home") {
      event.preventDefault();
      edge("first");
    } else if (event.key === "End") {
      event.preventDefault();
      edge("last");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      commit(activeIndex);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      search(event.key);
    }
  }

  return (
    <div className={cn("relative flex flex-col gap-1.5", className)} ref={rootRef}>
      <Label id={labelId} htmlFor={triggerId}>
        {label}
      </Label>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        id={triggerId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-ring",
        )}
      >
        <span
          id={valueId}
          className={cn(
            "min-w-0 truncate text-left",
            selected ? undefined : "text-muted-foreground",
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          tabIndex={-1}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lift"
        >
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">Aucune option</p>
          ) : (
            options.map((option, index) => {
              const active = index === activeIndex;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: la navigation clavier est portée par le déclencheur, qui conserve le focus.
                <div
                  key={option.value}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={active}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={-1}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                    option.disabled ? "cursor-not-allowed opacity-50" : undefined,
                    active ? "bg-accent text-accent-foreground" : undefined,
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {index === selectedIndex ? (
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden
                      className="size-4 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    >
                      <path d="M3 8.5l3.5 3.5L13 5" />
                    </svg>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
