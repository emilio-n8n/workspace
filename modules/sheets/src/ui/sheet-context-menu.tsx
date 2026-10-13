import { cn } from "@workspace/ui";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Séparateur (groupe d'actions distinct) — identifié pour rester une clé stable. */
export type SheetMenuSeparator = { type: "separator"; id: string };
/**
 * Action du menu. `checked: true` rend l'entrée cochable (`aria-checked`), ce
 * qui couvre les bascules de mise en forme ; `disabled` la laisse visible mais
 * inerte (feuille en lecture seule).
 */
export type SheetMenuItem =
  | SheetMenuSeparator
  | {
      type: "item";
      id: string;
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      /** Action irréversible : libellé et survol en teinte destructrice. */
      destructive?: boolean;
      checked?: boolean;
    };

export type SheetContextMenuProps = {
  open: boolean;
  /** Position du clic, en coordonnées d'écran. */
  x: number;
  y: number;
  /** Nom du menu, lu par les lecteurs d'écran (« Menu de la cellule A1 »). */
  label: string;
  items: SheetMenuItem[];
  onClose: () => void;
  /** Rappel rendu sous les actions (aide, mention lecture seule). */
  footer?: ReactNode;
};

const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-50";

/**
 * Menu contextuel de la feuille (clic droit, ou touche Menu / Maj+F10).
 *
 * Accessibilité : `role="menu"` avec actions `role="menuitem"` (bascules en
 * `menuitemradio`), focus placé sur la première entrée activable, navigation
 * aux flèches (Origine / Fin), Échap ferme et rend le focus à la grille, clic
 * à l'extérieur ferme aussi. Le menu est positionné en coordonnées d'écran puis
 * recadré dans la fenêtre, pour rester entièrement visible.
 */
export function SheetContextMenu({
  open,
  x,
  y,
  label,
  items,
  onClose,
  footer,
}: SheetContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // Première entrée activable : le clavier opère immédiatement.
    const first = ref.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])',
    );
    first?.focus();
  }, [open]);

  // Fermeture au clic extérieur : écouté en capture pour devancer la grille.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const menu = ref.current;
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    const onViewportChange = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, onClose]);

  // Recadrage : mesuré après le premier rendu, puis ajusté pour rester visible.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!open || !menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - margin);
    const top = Math.min(y, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
  }, [open, x, y]);

  const moveFocus = useCallback((from: number, delta: number) => {
    const count = itemRefs.current.length;
    if (count === 0) return;
    for (let step = 1; step <= count; step += 1) {
      const index = (from + delta * step + count * count) % count;
      const node = itemRefs.current[index];
      if (node && !node.disabled) {
        node.focus();
        return;
      }
    }
  }, []);

  const onItemKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(index, 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(index, -1);
          break;
        case "Home":
          event.preventDefault();
          moveFocus(-1, 1);
          break;
        case "End":
          event.preventDefault();
          moveFocus(-1, -1);
          break;
        case "Escape": {
          event.preventDefault();
          const target = returnFocusRef.current;
          onClose();
          target?.focus();
          break;
        }
        case "Tab":
          // On ne piège pas le focus : le menu se ferme, la tabulation continue.
          onClose();
          break;
        default:
          break;
      }
    },
    [moveFocus, onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-56 max-w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lift"
    >
      {items.map((item, index) =>
        item.type === "separator" ? (
          <hr key={item.id} className="my-1 border-0 border-t border-border" />
        ) : item.checked === true ? (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="menuitemradio"
            aria-checked
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            onKeyDown={(event) => onItemKeyDown(event, index)}
            className={cn(ITEM_CLASS, item.destructive && "text-destructive hover:bg-muted")}
          >
            <span aria-hidden className="shrink-0 text-xs text-primary">
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        ) : (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            onKeyDown={(event) => onItemKeyDown(event, index)}
            className={cn(ITEM_CLASS, item.destructive && "text-destructive hover:bg-muted")}
          >
            <span aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        ),
      )}
      {footer ? (
        <div className="mt-1 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
