import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "../cn.ts";
import { startsWithQuery } from "../lib/text-match.ts";
import { Separator } from "./separator.tsx";

export type MenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  /** Icône affichée avant le libellé (rendue en 16 px). */
  icon?: ReactNode;
  /** Raccourci clavier affiché à droite (ex. « ⌘ K »). */
  shortcut?: string;
  disabled?: boolean;
  /** Action irréversible : libellé en rouge. */
  destructive?: boolean;
  /** Trace un filet de séparation au-dessus de cet élément. */
  separated?: boolean;
};

export type MenuProps = {
  /** Libellé du bouton déclencheur (sert aussi de nom accessible). */
  label: string;
  items: MenuItem[];
  /**
   * Ouverture contrôlée (facultatif). Sans cette prop, le menu gère lui-même
   * son état ; `onOpenChange` reste appelé à chaque bascule.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Déclencheur réduit à une icône (le libellé reste le nom accessible). */
  triggerIcon?: ReactNode;
  /** Classes supplémentaires du déclencheur (barres d'outils compactes). */
  triggerClassName?: string;
  /** Alignement du panneau (défaut : à droite du déclencheur). */
  align?: "start" | "end";
  className?: string;
};

/**
 * Menu déroulant — panneau `role="menu"` entièrement maniable au clavier :
 * flèches (bas/haut), Début/Fin, frappe de lettres pour sauter à un libellé,
 * Entrée ou Espace pour activer, Échap pour refermer en rendant le focus au
 * déclencheur, Tab pour refermer et poursuivre la navigation.
 */
export function Menu({
  label,
  items,
  open: controlledOpen,
  onOpenChange,
  triggerIcon,
  triggerClassName,
  align = "end",
  className,
}: MenuProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const queryRef = useRef("");
  const queryTimer = useRef<number | null>(null);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const focusRestore = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(
    () => () => {
      if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      if (focusRestore.current) {
        focusRestore.current = false;
        triggerRef.current?.focus();
      }
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        focusRestore.current = false;
        setOpenRef.current(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = itemsRef.current.findIndex((item) => !item.disabled);
    itemRefs.current[first >= 0 ? first : 0]?.focus();
  }, [open]);

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  // Référence stable : l'écouteur pointerdown lit toujours la dernière version
  // (onOpenChange peut changer à chaque rendu) sans se réabonner.
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  function focusItem(index: number) {
    itemRefs.current[index]?.focus();
  }

  function step(from: number, delta: 1 | -1) {
    const count = items.length;
    if (count === 0) return 0;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = ((((from < 0 ? 0 : from) + delta * offset) % count) + count) % count;
      if (!items[index]?.disabled) return index;
    }
    return from;
  }

  function search(character: string) {
    const nextQuery = (queryRef.current + character).slice(0, 24);
    queryRef.current = nextQuery;
    if (queryTimer.current !== null) window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => {
      queryRef.current = "";
    }, 600);

    const index = items.findIndex(
      (item) => !item.disabled && startsWithQuery(item.label, nextQuery),
    );
    if (index >= 0) focusItem(index);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      focusRestore.current = true;
      setOpen(true);
    }
  }

  function onItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(step(index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(step(index, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = items.findIndex((item) => !item.disabled);
      if (first >= 0) focusItem(first);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (!items[index]?.disabled) {
          focusItem(index);
          return;
        }
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      focusRestore.current = true;
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      search(event.key);
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    focusRestore.current = true;
    setOpen(false);
    item.onSelect();
  }

  return (
    <div className={cn("relative inline-block", className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          triggerIcon ? "w-9 px-0" : undefined,
          triggerClassName,
        )}
      >
        {triggerIcon ? (
          <span className="grid size-4 place-items-center [&_svg]:size-4" aria-hidden>
            {triggerIcon}
          </span>
        ) : null}
        {triggerIcon ? <span className="sr-only">{label}</span> : label}
      </button>
      {open ? (
        <div
          role="menu"
          id={menuId}
          aria-labelledby={triggerId}
          className={cn(
            "absolute top-full z-50 mt-1 min-w-52 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lift",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <div key={item.id} role="none">
              {item.separated ? <Separator className="my-1" /> : null}
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => select(item)}
                onKeyDown={(event) => onItemKeyDown(event, index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors focus:bg-accent focus:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                  item.destructive
                    ? "text-destructive hover:bg-destructive/10"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.icon ? (
                  <span
                    className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4"
                    aria-hidden
                  >
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="shrink-0 font-sans text-xs text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
