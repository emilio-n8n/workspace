import { cn } from "@workspace/ui";
import { useRef } from "react";
import {
  clamp,
  type EditorElement,
  type EditorSlide,
  type ElementGeometry,
  round1,
} from "../editor-model.ts";
import {
  aspectRatioCss,
  DEFAULT_SLIDE_ASPECT,
  normalizeAspect,
  type SlideAspectId,
} from "../slide-aspect.ts";
import { placeholderHint, placeholderLabel } from "../slide-layouts.ts";
import { isShapeKind, shapeFillClass, shapeLabel, shapeVariant } from "../slide-shapes.ts";
import { textColorClass } from "../slide-text.ts";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  type SlideThemeId,
  themeCanvasClass,
  themeLineClass,
  themeShapeClass,
} from "../slide-theme.ts";

export type SlideCanvasProps = {
  slide: EditorSlide;
  fileId: string;
  /** Mode édition : éléments sélectionnables, déplaçables, redimensionnables. */
  interactive?: boolean;
  selectedElementKey?: string | null;
  onSelectElement?: (key: string | null) => void;
  onGeometryChange?: (key: string, patch: Partial<ElementGeometry>) => void;
  /** Clé de l'élément dont le texte est en cours d'édition (en place). */
  editingKey?: string | null;
  /** Demande l'entrée en édition d'un élément (double-clic, zone vide). */
  onStartEdit?: (key: string) => void;
  /** Frappe dans l'éditeur en place : le texte est appliqué à chaque touche. */
  onTextChange?: (key: string, text: string) => void;
  /** Sortie du mode édition (Échap ou clic ailleurs). */
  onEndEdit?: () => void;
  /** Format de la diapositive (défaut : écran large). */
  aspect?: SlideAspectId;
  /** Thème construit sur les jetons sémantiques (défaut : papier). */
  theme?: SlideThemeId;
  className?: string;
};

/** Seuil de déplacement (px) avant de considérer qu'un glisser commence. */
const DRAG_THRESHOLD = 3;

/** Taille minimale d'un élément en pourcentage de la diapositive. */
const MIN_ELEMENT_SIZE = 2;

/** Les huit poignées de redimensionnement, comme un éditeur de présentation. */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_CLASSES: Record<ResizeHandle, string> = {
  nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
  n: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
  e: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
  s: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  w: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
};

const RESIZE_HANDLES = Object.keys(HANDLE_CLASSES) as ResizeHandle[];

/** Libellé accessible d'un élément, pour les tests et les annonces. */
export function elementAriaLabel(element: EditorElement): string {
  if (element.kind === "image") return "Élément image";
  if (element.placeholder) {
    return `Élément ${placeholderLabel(element.placeholder)}`;
  }
  if (isShapeKind(element.kind)) return `Élément ${shapeLabel(element.kind).toLowerCase()}`;
  return element.text.trim().length > 0 ? `Élément ${element.text}` : "Élément texte";
}

/** Applique un déplacement de poignée à la géométrie d'origine, en %. */
export function resizeGeometry(
  origin: ElementGeometry,
  dx: number,
  dy: number,
  handle: ResizeHandle,
): ElementGeometry {
  let { x, y, w, h } = origin;
  if (handle.includes("w")) {
    const nextX = round1(clamp(x + dx, 0, x + w - MIN_ELEMENT_SIZE));
    w = round1(w - (nextX - x));
    x = nextX;
  }
  if (handle.includes("e")) {
    w = round1(clamp(w + dx, MIN_ELEMENT_SIZE, 100 - x));
  }
  if (handle.includes("n")) {
    const nextY = round1(clamp(y + dy, 0, y + h - MIN_ELEMENT_SIZE));
    h = round1(h - (nextY - y));
    y = nextY;
  }
  if (handle.includes("s")) {
    h = round1(clamp(h + dy, MIN_ELEMENT_SIZE, 100 - y));
  }
  return { x, y, w, h };
}

/**
 * Rend une diapositive et ses éléments. Positions en pourcentage de la
 * diapositive, corps de texte mis à l'échelle par requête de conteneur : le
 * même composant sert au canevas d'édition, aux vignettes, au mode
 * présentation et à l'impression, sans duplication de règles de mise en page.
 *
 * En mode édition, la sélection reprend les codes d'un éditeur de
 * présentation : contour net, huit poignées de redimensionnement, zone de
 * mise en page vide en pointillés qui s'ouvre au clic, texte modifiable en
 * place avec la typographie exacte du rendu final.
 */
export function SlideCanvas({
  slide,
  fileId,
  interactive = false,
  selectedElementKey = null,
  onSelectElement,
  onGeometryChange,
  editingKey = null,
  onStartEdit,
  onTextChange,
  onEndEdit,
  aspect = DEFAULT_SLIDE_ASPECT,
  theme = DEFAULT_SLIDE_THEME,
  className,
}: SlideCanvasProps) {
  const format = normalizeAspect(aspect);
  const palette = normalizeTheme(theme);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Un glisser passé le seuil annule le clic qui le suit. */
  const dragMovedRef = useRef(false);

  function startElementDrag(event: React.PointerEvent<HTMLButtonElement>, element: EditorElement) {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement?.(element.key);
    dragMovedRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: element.x, y: element.y };
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging) {
        // Un simple clic ne doit pas déplacer l'élément d'un demi-pixel.
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        dragMovedRef.current = true;
      }
      onGeometryChange?.(element.key, {
        x: round1(clamp(origin.x + (dx / rect.width) * 100, 0, 100 - element.w)),
        y: round1(clamp(origin.y + (dy / rect.height) * 100, 0, 100 - element.h)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startElementResize(
    event: React.PointerEvent<HTMLSpanElement>,
    element: EditorElement,
    handle: ResizeHandle,
  ) {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    // Le clic qui suit le relâchement ne doit ni re-sélectionner ni ouvrir
    // l'édition en place : la poignée vient d'agir.
    dragMovedRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin: ElementGeometry = { x: element.x, y: element.y, w: element.w, h: element.h };
    const move = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      onGeometryChange?.(element.key, resizeGeometry(origin, dx, dy, handle));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={() => {
        if (interactive) onSelectElement?.(null);
      }}
      style={
        {
          containerType: "inline-size",
          "--slide-design-width": "960",
          // Le rapport est calculé au runtime : une valeur en ligne est fiable,
          // là où Tailwind (v4, sources littérales) n'émettrait pas de classe
          // arbitraire dynamique.
          aspectRatio: aspectRatioCss(format),
        } as React.CSSProperties
      }
      className={cn(
        // Le format et le thème viennent d'ici : un seul canevas pour l'édition,
        // les vignettes, la présentation et l'impression.
        "relative w-full overflow-hidden rounded-sm border shadow-soft",
        themeCanvasClass(palette),
        className,
      )}
    >
      {slide.elements.map((element) => {
        // Forme concrète (rectangle, ellipse ou ligne) ; « shape » hérité rend
        // un rectangle. Le reste (texte, image) n'est pas une forme.
        const shape = isShapeKind(element.kind) ? shapeVariant(element.kind) : null;
        const selected = selectedElementKey === element.key;
        const className = cn(
          "absolute select-none whitespace-pre-wrap rounded-sm",
          // Les formes suivent le thème de la diapositive (jetons sémantiques),
          // sauf la ligne qui n'a pas de remplissage : elle dessine un trait.
          shape !== null && shape !== "line" && shapeFillClass(shape, themeShapeClass(palette)),
          element.kind === "image" && "bg-muted",
        );
        const style = {
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.w}%`,
          height: `${element.h}%`,
          fontSize: `calc(${element.fontSize} * 100cqw / var(--slide-design-width))`,
          fontWeight: element.bold ? 700 : 400,
          fontStyle: element.italic ? "italic" : "normal",
          textDecorationLine: element.underline ? "underline" : "none",
          textAlign: element.align,
          lineHeight: 1.25,
        } as const;
        const textClass = element.kind === "image" ? "" : textColorClass(element.textColor);
        // Invitation d'une zone de mise en page vide : visible uniquement dans
        // le canevas d'édition (jamais en présentation, impression, vignettes).
        const showsPlaceholder =
          interactive && element.placeholder !== null && element.text.trim().length === 0;
        // Image : le binaire est servi par la route média (clé anti-IDOR) ;
        // la zone garde ses poignées de déplacement/redimensionnement.
        const content =
          element.kind === "image" && element.mediaKey ? (
            <img
              src={`/api/slides/media?fileId=${fileId}&key=${encodeURIComponent(element.mediaKey)}`}
              className="size-full object-contain"
              draggable={false}
              alt=""
            />
          ) : shape === "line" ? (
            // Trait horizontal centré verticalement : la hauteur de la zone
            // règle la marge autour du trait, pas son épaisseur.
            <span
              aria-hidden
              className={cn(
                "absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full",
                themeLineClass(palette),
              )}
            />
          ) : showsPlaceholder && element.placeholder ? (
            <span aria-hidden className="italic opacity-50">
              {placeholderHint(element.placeholder)}
            </span>
          ) : (
            element.text
          );
        if (!interactive) {
          return (
            <div key={element.key} className={cn(className, textClass)} style={style}>
              {content}
            </div>
          );
        }
        // Édition en place : la zone devient un champ de saisie transparent,
        // typographié exactement comme le rendu final (le texte affiché et le
        // texte saisi ne peuvent pas diverger).
        if (editingKey === element.key) {
          return (
            <div
              key={element.key}
              className={cn(className, textClass, "z-10 outline outline-2 outline-primary")}
              style={style}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <textarea
                ref={(node) => {
                  // Focus à l'ouverture de l'édition (pas d'attribut autoFocus :
                  // la règle d'accessibilité préfère un focus explicite).
                  if (node && document.activeElement !== node) node.focus();
                }}
                aria-label="Modifier le texte"
                value={element.text}
                onChange={(event) => onTextChange?.(element.key, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    onEndEdit?.();
                  }
                }}
                onBlur={() => onEndEdit?.()}
                maxLength={2000}
                className="size-full resize-none overflow-hidden border-none bg-transparent p-0 text-inherit outline-none"
                style={{
                  font: "inherit",
                  color: "inherit",
                  textAlign: "inherit",
                  textDecorationLine: "inherit",
                }}
              />
            </div>
          );
        }
        return (
          <button
            key={element.key}
            type="button"
            data-slide-element=""
            aria-label={elementAriaLabel(element)}
            onPointerDown={(event) => startElementDrag(event, element)}
            onClick={(event) => {
              event.stopPropagation();
              if (dragMovedRef.current) {
                dragMovedRef.current = false;
                return;
              }
              onSelectElement?.(element.key);
              // Une zone de mise en page vide s'ouvre au simple clic, comme
              // dans tout outil de présentation.
              if (
                element.kind !== "image" &&
                element.placeholder !== null &&
                element.text.trim().length === 0
              ) {
                onStartEdit?.(element.key);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (element.kind !== "image") onStartEdit?.(element.key);
            }}
            className={cn(
              className,
              textClass,
              "text-left focus-visible:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              showsPlaceholder && "border border-dashed border-border",
              selected
                ? "cursor-move outline outline-2 outline-primary"
                : "cursor-move outline-none hover:outline hover:outline-1 hover:outline-primary/40",
            )}
            style={style}
          >
            {content}
            {selected
              ? RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    aria-hidden
                    data-resize-handle={handle}
                    onPointerDown={(event) => startElementResize(event, element, handle)}
                    className={cn(
                      "absolute z-20 size-2.5 rounded-[2px] border border-primary bg-background shadow-xs",
                      HANDLE_CLASSES[handle],
                    )}
                  />
                ))
              : null}
          </button>
        );
      })}
    </div>
  );
}
