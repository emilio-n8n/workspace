import { cn } from "@workspace/ui";
import { type KeyboardEvent, type PointerEvent, useCallback, useRef, useState } from "react";
import {
  clampSize,
  DIMENSION_KEY_STEP,
  DIMENSION_KEY_STEP_LARGE,
  DIMENSION_LIMITS,
  type DimensionAxis,
} from "../dimensions.ts";

/** Sens du geste selon l'axe. */
const ORIENTATION: Record<DimensionAxis, "horizontal" | "vertical"> = {
  col: "horizontal",
  row: "vertical",
};

export type ResizeHandleProps = {
  axis: DimensionAxis;
  index: number;
  /** Nom accessible (« Redimensionner la colonne B », « … la ligne 7 »). */
  label: string;
  /** Taille enregistrée en pixels (celle que rend `aria-valuenow`). */
  current: number;
  /** Taille en cours de glisser, pour le rappel visuel en pixels. */
  preview: number | null;
  disabled: boolean;
  /** Aperçu pendant le glisser (aucune écriture). */
  onPreview: (axis: DimensionAxis, index: number, size: number) => void;
  /** Fin du glisser ou pas au clavier : la taille est alors enregistrée. */
  onCommit: (axis: DimensionAxis, index: number, size: number) => void;
  /** Fin de geste sans changement : on abandonne l'aperçu. */
  onSettle: (axis: DimensionAxis, index: number) => void;
  /** Double-clic ou touche Origine : retour à la taille par défaut. */
  onReset: (axis: DimensionAxis, index: number) => void;
};

/**
 * Poignée de redimensionnement d'une colonne ou d'une ligne.
 *
 * À la souris : glisser (capture du pointeur, aperçu continu, écriture au
 * relâchement) ; double-clic pour revenir à la taille par défaut. Au clavier,
 * la poignée est un séparateur focusable (`role="separator"`), flèches pour
 * ajuster, Majuscule pour un pas plus grand, Origine pour réinitialiser —
 * aucune action n'exige donc la souris.
 */
export function ResizeHandle({
  axis,
  index,
  label,
  current,
  preview,
  disabled,
  onPreview,
  onCommit,
  onSettle,
  onReset,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  // Point de départ du geste et dernière taille aperçue (refs : pas de rendu).
  const originRef = useRef({ pointer: 0, size: current });
  const previewRef = useRef<number | null>(null);
  const limits = DIMENSION_LIMITS[axis];

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      // Le geste ne doit ni sélectionner la ligne/colonne ni déplacer du texte.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      originRef.current = {
        pointer: axis === "col" ? event.clientX : event.clientY,
        size: current,
      };
      previewRef.current = null;
      setDragging(true);
    },
    [axis, current, disabled],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const pointer = axis === "col" ? event.clientX : event.clientY;
      const size = clampSize(axis, originRef.current.size + pointer - originRef.current.pointer);
      previewRef.current = size;
      onPreview(axis, index, size);
    },
    [axis, dragging, index, onPreview],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!dragging) return;
      const element = event.currentTarget;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      const size = previewRef.current;
      previewRef.current = null;
      if (commit && size !== null) onCommit(axis, index, size);
      else onSettle(axis, index);
    },
    [axis, dragging, index, onCommit, onSettle],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const step = event.shiftKey ? DIMENSION_KEY_STEP_LARGE : DIMENSION_KEY_STEP;
      const grow = axis === "col" ? "ArrowRight" : "ArrowDown";
      const shrink = axis === "col" ? "ArrowLeft" : "ArrowUp";
      if (event.key === grow || event.key === shrink) {
        event.preventDefault();
        onCommit(axis, index, current + (event.key === grow ? step : -step));
      } else if (event.key === "Home") {
        event.preventDefault();
        onReset(axis, index);
      }
    },
    [axis, current, disabled, index, onCommit, onReset],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: séparateur ARIA portant la poignée (pointeur + clavier), pas une simple règle décorative.
    <div
      role="separator"
      aria-orientation={ORIENTATION[axis]}
      aria-label={label}
      aria-valuenow={current}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={`${current} pixels`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset(axis, index);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "group/resize absolute touch-none",
        axis === "col"
          ? "top-0 right-0 flex h-full w-2 items-center justify-end pr-px cursor-col-resize"
          : "bottom-0 left-0 flex h-2 w-full cursor-row-resize items-end justify-center pb-px",
        disabled ? "cursor-default" : undefined,
      )}
    >
      {/* Trait de saisie : discret au survol, pleinement visible pendant le glisser. */}
      <span
        aria-hidden
        className={cn(
          "rounded-full bg-border transition-colors",
          axis === "col" ? "h-4 w-0.5" : "h-0.5 w-4",
          !disabled && "group-hover/resize:bg-ring",
          dragging && "bg-ring",
        )}
      />
      {dragging && preview !== null ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-md border border-border bg-popover px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-popover-foreground shadow-soft",
            axis === "col" ? "top-full right-0 mt-1" : "top-0 left-full ml-1",
          )}
        >
          {preview} px
        </span>
      ) : null}
    </div>
  );
}
