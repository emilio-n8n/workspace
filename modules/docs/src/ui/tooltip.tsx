import { cn, Kbd } from "@workspace/ui";
import {
  type ButtonHTMLAttributes,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type TooltipProps = {
  /** Texte de l'info-bulle, en français. */
  content: string;
  /** Raccourci clavier affiché à la suite du texte (ex. « Ctrl+B »). */
  shortcut?: string;
  /** Déclencheur : reçoit les props à poser sur l'élément focusable. */
  children: (props: TooltipTriggerProps) => ReactNode;
};

/** Props qui branchent l'info-bulle sur son déclencheur. */
export type TooltipTriggerProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-describedby" | "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur" | "onKeyDown"
>;

/** Délai avant l'apparition au survol (millisecondes). */
const OPEN_DELAY_MS = 200;
/** Délai de disparition après le départ du pointeur ou du focus. */
const CLOSE_DELAY_MS = 120;
/** Décalage vertical entre le déclencheur et l'info-bulle (pixels). */
const GAP_PX = 6;
/** Sous cette hauteur, l'info-bulle passe sous le déclencheur (mode focus). */
const FLIP_THRESHOLD_PX = 56;

/** Position écran mesurée à l'ouverture. */
type TooltipPosition = { top: number; left: number; below: boolean };

/**
 * Info-bulle de la barre d'outils : texte français et raccourci clavier.
 *
 * Apparaît au survol de la souris et au focus clavier (`:focus-visible`, pas au
 * clic souris), disparaît à la sortie du pointeur, à la perte du focus et avec
 * `Échap`. Le raccourci est référencé par `aria-describedby` : il est donc
 * annoncé par les lecteurs d'écran, pas seulement visible.
 *
 * Positionnée en `fixed` d'après le rectangle du déclencheur : elle échappe
 * ainsi au conteneur `overflow-x-auto` de la barre d'outils qui la rognerait.
 *
 * Seul le raccourci entre dans l'arbre d'accessibilité — le texte de l'infobulle
 * est masqué aux lecteurs d'écran, sinon il double le nom accessible du bouton.
 */
export function Tooltip({ content, shortcut, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  /** Déclencheur de la mesure : le bouton qui a demandé l'info-bulle. */
  const anchor = useRef<HTMLElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Mesure le déclencheur à l'ouverture puis à chaque défilement (la barre
  // défile horizontalement) : l'info-bulle reste collée au bouton. Si le
  // défilement l'emporte hors de l'écran, on la referme.
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const node = anchor.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const below = rect.top < FLIP_THRESHOLD_PX;
      setPosition({
        top: below ? rect.bottom + GAP_PX : rect.top - GAP_PX,
        left: rect.left + rect.width / 2,
        below,
      });
    };
    measure();
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [open]);

  /** `immediate` : le focus clavier n'attend pas (l'annonce serait décalée). */
  function show(immediate: boolean, trigger: HTMLElement) {
    anchor.current = trigger;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (immediate) {
      setOpen(true);
      return;
    }
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function hide() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  /** Focus clavier seulement : un clic souris n'ouvre pas l'info-bulle. */
  function onFocus(event: FocusEvent<HTMLButtonElement>) {
    const target = event.target;
    if (typeof target.matches === "function" && !target.matches(":focus-visible")) return;
    show(true, event.currentTarget);
  }

  /** Souris uniquement : les tactiles n'ouvrent pas l'info-bulle. */
  function onPointerEnter(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse") show(false, event.currentTarget);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      clearTimers();
      setOpen(false);
    }
  }

  return (
    <>
      {children({
        "aria-describedby": id,
        onPointerEnter,
        onPointerLeave: hide,
        onFocus,
        onBlur: hide,
        onKeyDown,
      })}
      <span
        role="tooltip"
        id={id}
        style={position ? { top: position.top, left: position.left } : undefined}
        className={cn(
          "pointer-events-none fixed z-50 flex w-max max-w-56 -translate-x-1/2 items-center rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lift transition-opacity duration-150 motion-reduce:transition-none",
          position?.below ? undefined : "-translate-y-full",
          open && position ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <span aria-hidden>{content}</span>
        {shortcut ? <Kbd className="ml-1.5">{shortcut}</Kbd> : null}
      </span>
    </>
  );
}
