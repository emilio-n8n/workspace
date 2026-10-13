import {
  cloneElement,
  type FocusEvent,
  isValidElement,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../cn.ts";

export type TooltipSide = "top" | "bottom";

export type TooltipProps = {
  /** Texte de l'infobulle — devient la description de l'élément déclencheur. */
  content: string;
  /** Élément déclencheur (un seul enfant, impérativement focusable). */
  children: ReactNode;
  side?: TooltipSide;
  /** Délai avant l'apparition au survol, en millisecondes (défaut : 250). */
  delay?: number;
  className?: string;
};

/** Délai de disparition après le départ du pointeur ou du focus. */
const CLOSE_DELAY_MS = 120;

type PointerHandler = (event: PointerEvent<HTMLElement>) => void;
type FocusHandler = (event: FocusEvent<HTMLElement>) => void;
type KeyboardHandler = (event: KeyboardEvent<HTMLElement>) => void;

/**
 * Recopie l'élément déclencheur en y ajoutant les gestionnaires d'affichage et
 * l'association `aria-describedby`, sans écraser ceux fournis par l'appelant.
 */
function decorate(
  child: ReactNode,
  id: string,
  handlers: {
    onPointerEnter: PointerHandler;
    onPointerLeave: PointerHandler;
    onFocus: FocusHandler;
    onBlur: FocusHandler;
    onKeyDown: KeyboardHandler;
  },
): ReactNode {
  if (!isValidElement(child)) return child;
  const props = child.props as Record<string, unknown>;
  const existing = props["aria-describedby"];
  const describedBy = typeof existing === "string" ? `${existing} ${id}` : id;
  const enter = props.onPointerEnter as PointerHandler | undefined;
  const leave = props.onPointerLeave as PointerHandler | undefined;
  const focus = props.onFocus as FocusHandler | undefined;
  const blur = props.onBlur as FocusHandler | undefined;
  const keyDown = props.onKeyDown as KeyboardHandler | undefined;

  return cloneElement(child as ReactElement<Record<string, unknown>>, {
    "aria-describedby": describedBy,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      enter?.(event);
      handlers.onPointerEnter(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      leave?.(event);
      handlers.onPointerLeave(event);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      focus?.(event);
      handlers.onFocus(event);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      blur?.(event);
      handlers.onBlur(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      keyDown?.(event);
      handlers.onKeyDown(event);
    },
  });
}

/**
 * Infobulle — texte court attaché à un élément focusable : apparition au survol
 * souris ou au focus clavier (jamais au simple focus souris), disparition à la
 * sortie, à la perte du focus ou avec Échap. L'association passe par
 * `aria-describedby`, donc l'infobulle est annoncée par les lecteurs d'écran.
 * L'animation cède sous `prefers-reduced-motion` (variante `motion-reduce:`).
 */
export function Tooltip({ content, children, side = "top", delay = 250, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  function show() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), delay);
  }

  function hide() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function onPointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") show();
  }

  function onFocus(event: FocusEvent<HTMLElement>) {
    const target = event.target as Element;
    if (typeof target.matches === "function" && target.matches(":focus-visible")) show();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      clearTimers();
      setOpen(false);
    }
  }

  return (
    <span className="relative inline-flex">
      {decorate(children, id, {
        onPointerEnter,
        onPointerLeave: hide,
        onFocus,
        onBlur: hide,
        onKeyDown,
      })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lift transition-opacity duration-150 motion-reduce:transition-none",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          open ? "opacity-100" : "invisible opacity-0",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
