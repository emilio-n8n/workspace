import { Button, cn, Kbd } from "@workspace/ui";
import { useEffect, useId, useRef, useState } from "react";
import type { EditorSlide } from "../editor-model.ts";
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
  /** Ouvre le choix de mise en page pour une nouvelle diapositive. */
  onAdd?: () => void;
  /** Format et thème de la présentation : les vignettes sont fidèles au rendu. */
  aspect?: SlideAspectId;
  theme?: SlideThemeId;
};

/**
 * Colonne des diapositives : mini-rendu fidèle, numéro à gauche de chaque
 * vignette, sélection nette, réordonnancement par glisser-déposer ou avec
 * Alt+flèches, et bouton d'ajout en pied — la disposition d'un éditeur de
 * présentations.
 *
 * Une seule vignette est atteignable à la tabulation (tabindex mobile) : Tab
 * entre dans la colonne sur la diapositive courante, les flèches déplacent la
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
  onAdd,
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
    // La colonne traite ses propres raccourcis : la navigation globale s'arrête.
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
        <div className="flex items-start gap-1.5">
          <span
            aria-hidden
            className={cn(
              "w-5 shrink-0 pt-1 text-right text-[11px] tabular-nums",
              selected ? "font-semibold text-primary" : "text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
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
              "relative block min-w-0 flex-1 rounded-md border bg-card p-0.5 text-left transition-[border-color,box-shadow] duration-150",
              canEdit ? "cursor-grab" : "cursor-pointer",
              dragging && "cursor-grabbing",
              draggedIndex === index && "opacity-40",
              selected
                ? "border-primary ring-2 ring-primary/30"
                : "border-transparent hover:border-primary/40",
            )}
          >
            <SlideCanvas slide={slide} fileId={fileId} aspect={aspect} theme={theme} />
            {/* Pastille : la diapositive porte des notes du présentateur. */}
            {hasNotes ? (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-attention ring-1 ring-background"
              />
            ) : null}
          </button>
        </div>
      </li>
    );
  });

  if (slides.length === 0) {
    return (
      <div className="flex w-44 shrink-0 flex-col gap-2 border-r border-border bg-muted/30 p-3 print-hide">
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Aucune diapositive.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-44 shrink-0 flex-col border-r border-border bg-muted/30 print-hide">
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Diapositives
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{slides.length}</span>
      </div>

      <ol
        ref={listRef}
        aria-label="Liste des diapositives"
        aria-describedby={hintId}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-1",
          dragging && "select-none",
        )}
      >
        {/* Repère d'insertion : la colonne s'ouvre là où la diapositive atterrira. */}
        {dropSlot === null
          ? cells
          : [
              ...cells.slice(0, dropSlot),
              <li
                key="insertion"
                aria-hidden
                className="ml-6 h-1 shrink-0 rounded-full bg-primary"
              />,
              ...cells.slice(dropSlot),
            ]}
      </ol>

      {canEdit && onAdd ? (
        <div className="px-2 pt-1.5">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            aria-label="Ajouter une diapositive"
            onClick={onAdd}
          >
            ＋ Diapositive
          </Button>
        </div>
      ) : null}

      <p id={hintId} className="px-2 py-2 text-[11px] leading-snug text-muted-foreground">
        {canEdit ? (
          <>
            Glissez une vignette pour la déplacer, ou <Kbd>Alt</Kbd> + <Kbd>↑</Kbd> / <Kbd>↓</Kbd>{" "}
            au clavier.
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
