import { cn } from "@workspace/ui";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * Menu d'options cochées (groupe radio) local au module Drive.
 *
 * Le menu ordinaire vient du primitif `Menu` de `@workspace/ui`. Ce composant
 * n'existe que pour ce que le primitif ne couvre pas encore : une option
 * cochée (`checked`) avec le rôle `menuitemradio` et `aria-checked` — sans
 * quoi un lecteur d'écran ne peut pas savoir quelle clé de tri ou quelle
 * densité est active. Il pourra céder la place dès que le primitif exposera
 * cet état.
 */

/** Trait de séparation entre deux groupes d'entrées. */
export type MenuSeparator = { id: string; separator: true };

/** Entrée de menu : action simple ou option cochable d'un groupe. */
export type MenuItem = {
  /** Toujours absent sur une entrée : ne sert qu'au discriminant du type. */
  separator?: false;
  id: string;
  label: string;
  /** Libellé secondaire (sens du tri, nombre d'éléments). */
  hint?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Dessine la coche et expose l'entrée en `menuitemradio`. */
  checked?: boolean;
  /** Action irréversible : libellé en rouge. */
  destructive?: boolean;
  /** Trace un filet au-dessus de cette entrée. */
  separated?: boolean;
};

export type MenuEntry = MenuItem | MenuSeparator;

/** Vrai pour les séparateurs, qui ne sont pas des entrées de menu. */
function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return entry.separator === true;
}

/** Coche du menu, dans la géométrie des icônes de la suite (16 px, trait 1,6). */
function CheckGlyph() {
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
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export type RadioMenuProps = {
  /** Libellé du déclencheur, aussi utilisé comme nom accessible du menu. */
  label: string;
  entries: MenuEntry[];
  /** Ouverture contrôlée ; sans elle, le menu gère son propre état. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Déclencheur réduit à une icône (le libellé reste le nom accessible). */
  triggerIcon?: ReactNode;
  /** Alignement du panneau (défaut : aligné sur le bord droit du déclencheur). */
  align?: "start" | "end";
  /** Classes ajoutées au déclencheur (variante du bouton). */
  triggerClassName?: string;
  /** Contenu rendu à la place du déclencheur standard. */
  trigger?: (state: { open: boolean }) => ReactNode;
  className?: string;
};

/**
 * Menu d'options maniable au clavier dans son intégralité : flèches (bas/haut
 * avec bouclage), Début/Fin, frappe de lettres pour sauter à un libellé,
 * Entrée ou Espace pour activer, Échap pour refermer en rendant le focus au
 * déclencheur, Tab pour refermer et poursuivre la navigation.
 */
export function RadioMenu({
  label,
  entries,
  open: controlledOpen,
  onOpenChange,
  triggerIcon,
  align = "end",
  triggerClassName,
  trigger,
  className,
}: RadioMenuProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typedRef = useRef("");
  const typedTimerRef = useRef<number | null>(null);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const restoreFocusRef = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const enabledIndexes = entries.flatMap((entry, index) =>
    !isSeparator(entry) && !entry.disabled ? [index] : [],
  );

  // À l'ouverture — clavier comme souris — le focus va sur la première entrée
  // activable : les flèches prennent alors le relais sans détour.
  useEffect(() => {
    if (!open) return;
    const first = entriesRef.current.findIndex((entry) => !isSeparator(entry) && !entry.disabled);
    itemRefs.current[first >= 0 ? first : 0]?.focus();
  }, [open]);

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function focusItem(index: number) {
    itemRefs.current[index]?.focus();
  }

  // Rend le focus au déclencheur après une fermeture au clavier (Échap, Tab) ;
  // un clic extérieur, lui, laisse le focus là où l'utilisateur l'a mis.
  useEffect(() => {
    if (open) return;
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Nettoie le minuteur de la recherche par frappe au démontage.
  useEffect(
    () => () => {
      if (typedTimerRef.current !== null) window.clearTimeout(typedTimerRef.current);
    },
    [],
  );

  /** Prochaine entrée activable dans le sens demandé, en bouclant. */
  function step(from: number, delta: 1 | -1): number {
    if (enabledIndexes.length === 0) return from;
    const position = enabledIndexes.indexOf(from);
    const start = position === -1 ? (delta === 1 ? -1 : 0) : position;
    const next = (start + delta + enabledIndexes.length) % enabledIndexes.length;
    return enabledIndexes[next] ?? from;
  }

  function search(character: string) {
    typedRef.current = (typedRef.current + character).slice(0, 24);
    if (typedTimerRef.current !== null) window.clearTimeout(typedTimerRef.current);
    typedTimerRef.current = window.setTimeout(() => {
      typedRef.current = "";
    }, 600);

    const needle = typedRef.current.toLowerCase();
    const index = entries.findIndex(
      (entry) =>
        !isSeparator(entry) && !entry.disabled && entry.label.toLowerCase().startsWith(needle),
    );
    if (index >= 0) focusItem(index);
  }

  // Referme le menu au clic extérieur : `onBlur` ne suffit pas, un clic dans
  // un autre cadre fermerait le menu sans le référencier.
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      restoreFocusRef.current = true;
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
      const first = enabledIndexes[0];
      if (first !== undefined) focusItem(first);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = enabledIndexes[enabledIndexes.length - 1];
      if (last !== undefined) focusItem(last);
    } else if (event.key === "Escape") {
      event.preventDefault();
      restoreFocusRef.current = true;
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      search(event.key);
    }
  }

  function select(index: number) {
    const entry = entries[index];
    if (!entry || isSeparator(entry) || entry.disabled) return;
    restoreFocusRef.current = true;
    setOpen(false);
    entry.onSelect?.();
  }

  return (
    // Le conteneur capte les clics extérieurs : `onBlur` ne suffit pas, un clic
    // dans un autre cadre fermerait le menu sans le référencer.
    <div
      ref={rootRef}
      className={cn("relative inline-block", className)}
      onPointerDown={(event) => {
        if (open && !rootRef.current?.contains(event.target as Node)) setOpen(false);
      }}
    >
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
          "inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted",
          open ? "bg-muted" : undefined,
          triggerClassName,
        )}
      >
        {trigger ? (
          trigger({ open })
        ) : (
          <>
            {triggerIcon ? (
              <span className="grid size-4 place-items-center [&_svg]:size-4" aria-hidden>
                {triggerIcon}
              </span>
            ) : null}
            {triggerIcon ? <span className="sr-only">{label}</span> : label}
          </>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          id={menuId}
          aria-labelledby={triggerId}
          className={cn(
            "absolute top-full z-40 mt-1 max-h-80 min-w-52 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lift",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {entries.map((entry, index) => {
            if (isSeparator(entry)) {
              return <hr key={entry.id} className="my-1 border-0 border-t border-border" />;
            }

            const checked = entry.checked === true;
            return (
              <div
                key={entry.id}
                role="none"
                className={entry.separated ? "mt-1 border-t border-border pt-1" : undefined}
              >
                {checked ? (
                  <button
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked
                    disabled={entry.disabled}
                    onClick={() => select(index)}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                      entry.destructive ? "text-destructive" : undefined,
                    )}
                  >
                    <CheckGlyph />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>
                    ) : null}
                  </button>
                ) : (
                  <button
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitem"
                    disabled={entry.disabled}
                    onClick={() => select(index)}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                      entry.destructive ? "text-destructive" : undefined,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>
                    ) : null}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
