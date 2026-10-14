import { cn, Kbd } from "@workspace/ui";
import { useEffect, useId, useRef, useState } from "react";
import { type EditorSlide, slideTitle } from "../editor-model.ts";
import { DEFAULT_SLIDE_ASPECT, type SlideAspectId } from "../slide-aspect.ts";
import { slideNavigationAnnouncement } from "../slide-navigation.ts";
import {
  dropIndex,
  filmstripKeyAction,
  filmstripOptionLabel,
  insertionIndex,
  reorderAnnouncement,
  type StripItem,
} from "../slide-order.ts";
import { DEFAULT_SLIDE_THEME, type SlideThemeId } from "../slide-theme.ts";
import { SlideCanvas } from "./slide-canvas.tsx";

/** Déplacement minimal (px) avant qu'un glisser ne devienne un réordonnancement. */
const DRAG_THRESHOLD = 6;

type DragState = {
  from: number;
  startX: number;
  startY: number;
  active: boolean;
  /** Destination dans la liste privée de la diapositive déplacée. */
  over: number;
};

export type SlideFilmstripProps = {
  slides: EditorSlide[];
  selectedIndex: number;
  /** Sans droit d'écriture : sélection autorisée, réordonnancement non. */
  canEdit: boolean;
  fileId: string;
  onSelect: (index: number) => void;
  onMove: (from: number, to: number) => void;
  /** Format et thème de la présentation : les vignettes sont fidèles au rendu. */
  aspect?: SlideAspectId;
  theme?: SlideThemeId;
};

/**
 * Bande de vignettes des diapositives : mini-rendu fidèle, sélection au clavier
 * comme à la souris, réordonnancement par glisser-déposer ou avec Alt+flèches.
 *
 * Une seule vignette est atteignable à la tabulation (tabindex mobile) : Tab
 * entre dans la bande sur la diapositive courante, les flèches déplacent la
 * sélection et le focus ensemble, et chaque vignette est nommée pour les
 * lecteurs d'écran (« Diapositive 3 sur 8 : Chiffres — 2 éléments »).
 */
export function SlideFilmstrip({
  slides,
  selectedIndex,
  canEdit,
  fileId,
  onSelect,
  onMove,
  aspect = DEFAULT_SLIDE_ASPECT,
  theme = DEFAULT_SLIDE_THEME,
}: SlideFilmstripProps) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Index de la vignette en cours de glisser (estompée pendant le trajet). */
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Index à focaliser après le prochain rendu (navigation au clavier). */
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);

  useEffect(() => {
    if (pendingFocus === null) return;
    const list = listRef.current;
    list?.querySelectorAll<HTMLButtonElement>("[data-thumb]")[pendingFocus]?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  /** Mesure les vignettes sur l'axe de déplacement (sens donné par la CSS). */
  function measure(
    clientX: number,
    clientY: number,
  ): { items: StripItem[]; pointer: number } | null {
    const list = listRef.current;
    if (!list) return null;
    const vertical = getComputedStyle(list).flexDirection.startsWith("column");
    const items: StripItem[] = Array.from(list.querySelectorAll<HTMLElement>("[data-thumb]")).map(
      (child) => {
        const rect = child.getBoundingClientRect();
        return vertical
          ? { start: rect.top, size: rect.height }
          : { start: rect.left, size: rect.width };
      },
    );
    return { items, pointer: vertical ? clientY : clientX };
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (!canEdit || event.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = {
      from: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      over: index,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function onPointerMove(event: PointerEvent) {
    const state = dragRef.current;
    if (!state) return;
    if (!state.active) {
      const travel =
        Math.abs(event.clientX - state.startX) + Math.abs(event.clientY - state.startY);
      if (travel < DRAG_THRESHOLD) return;
      state.active = true;
      setDragging(true);
      setDraggedIndex(state.from);
    }
    const measured = measure(event.clientX, event.clientY);
    if (!measured) return;
    state.over = dropIndex({ from: state.from, items: measured.items, pointer: measured.pointer });
    setDropSlot(insertionIndex(measured.items, measured.pointer));
  }

  function endDrag(cancelled: boolean) {
    const state = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setDraggedIndex(null);
    setDropSlot(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (!state?.active) return;
    // Le clic qui suit un glisser ne doit pas re-sélectionner la vignette.
    suppressClickRef.current = true;
    if (cancelled || state.over === state.from) return;
    onMove(state.from, state.over);
    setAnnouncement(reorderAnnouncement(state.from, state.over));
  }

  function onPointerUp() {
    endDrag(false);
  }

  function onPointerCancel() {
    endDrag(true);
  }

  function onThumbKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const action = filmstripKeyAction({
      key: event.key,
      altKey: event.altKey,
      current: index,
      count: slides.length,
    });
    if (!action) return;
    // Le réordonnancement est une écriture : interdit en lecture seule.
    if (action.kind === "move" && !canEdit) return;
    event.preventDefault();
    // La bande traite ses propres raccourcis : la navigation globale s'arrête.
    event.stopPropagation();
    if (action.kind === "select") {
      onSelect(action.index);
      setAnnouncement(slideNavigationAnnouncement(action.index, slides.length));
      setPendingFocus(action.index);
      return;
    }
    onMove(index, action.index);
    setAnnouncement(reorderAnnouncement(index, action.index));
    setPendingFocus(action.index);
  }

  const cells = slides.map((slide, index) => {
    const selected = index === selectedIndex;
    const hasNotes = slide.notes.trim().length > 0;
    const label = filmstripOptionLabel({
      index,
      count: slides.length,
      title: slide.title,
      elementCount: slide.elements.length,
      hasNotes,
    });
    return (
      <li key={slide.key} className="shrink-0">
        <button
          type="button"
          data-thumb=""
          aria-current={selected ? "true" : undefined}
          aria-label={label}
          tabIndex={selected ? 0 : -1}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onSelect(index);
          }}
          onPointerDown={(event) => startDrag(event, index)}
          onKeyDown={(event) => onThumbKeyDown(event, index)}
          className={cn(
            "relative block w-36 rounded-lg border p-1.5 text-left transition-colors lg:w-full",
            canEdit ? "cursor-grab" : "cursor-pointer",
            dragging && "cursor-grabbing",
            draggedIndex === index && "opacity-50",
            selected
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border bg-card hover:bg-muted",
          )}
        >
          <span aria-hidden className="block">
            <SlideCanvas slide={slide} fileId={fileId} aspect={aspect} theme={theme} />
            <span className="mt-1 flex items-baseline gap-1 text-[11px] font-medium">
              <span className="text-muted-foreground">{index + 1}</span>
              <span className="truncate">{slideTitle(slide, index)}</span>
            </span>
          </span>
          {/* Pastille : la diapositive porte des notes du présentateur. */}
          {hasNotes ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 size-2 rounded-full bg-attention ring-1 ring-background"
            />
          ) : null}
        </button>
      </li>
    );
  });

  if (slides.length === 0) {
    return (
      <div className="flex shrink-0 flex-col gap-2 lg:w-44 print-hide">
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Aucune diapositive.
        </p>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 lg:w-44 print-hide">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Diapositives
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{slides.length}</span>
      </div>

      <ol
        ref={listRef}
        aria-label="Bande des vignettes des diapositives"
        aria-describedby={hintId}
        className={cn(
          "flex gap-2 overflow-auto p-0.5",
          "flex-row lg:flex-col",
          dragging && "select-none",
        )}
      >
        {/* Repère d'insertion : la bande s'ouvre là où la diapositive atterrira. */}
        {dropSlot === null
          ? cells
          : [
              ...cells.slice(0, dropSlot),
              <li
                key="insertion"
                aria-hidden
                className="h-full w-1 shrink-0 rounded-full bg-primary lg:h-1 lg:w-full"
              />,
              ...cells.slice(dropSlot),
            ]}
      </ol>

      <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
        {canEdit ? (
          <>
            Glissez une vignette pour la déplacer, ou <Kbd>Alt</Kbd> + <Kbd>↑</Kbd> / <Kbd>↓</Kbd>{" "}
            lorsque la bande a le focus.
          </>
        ) : (
          "Flèches, Début et Fin pour changer de diapositive."
        )}
      </p>

      {/* Région live : sélections et déplacements annoncés aux lecteurs d'écran. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
