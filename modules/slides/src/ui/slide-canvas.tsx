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
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  type SlideThemeId,
  themeCanvasClass,
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
  /** Format de la diapositive (défaut : écran large). */
  aspect?: SlideAspectId;
  /** Thème construit sur les jetons sémantiques (défaut : papier). */
  theme?: SlideThemeId;
  className?: string;
};

/** Seuil de déplacement (px) avant de considérer qu'un glisser commence. */
const DRAG_THRESHOLD = 3;

/**
 * Rend une diapositive et ses éléments. Positions en pourcentage de la
 * diapositive, corps de texte mis à l'échelle par requête de conteneur : le
 * même composant sert au canevas d'édition, aux vignettes, au mode
 * présentation et à l'impression, sans duplication de règles de mise en page.
 */
export function SlideCanvas({
  slide,
  fileId,
  interactive = false,
  selectedElementKey = null,
  onSelectElement,
  onGeometryChange,
  aspect = DEFAULT_SLIDE_ASPECT,
  theme = DEFAULT_SLIDE_THEME,
  className,
}: SlideCanvasProps) {
  const format = normalizeAspect(aspect);
  const palette = normalizeTheme(theme);
  const canvasRef = useRef<HTMLDivElement>(null);

  function startElementDrag(event: React.PointerEvent<HTMLButtonElement>, element: EditorElement) {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement?.(element.key);
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

  function startElementResize(event: React.PointerEvent<HTMLSpanElement>, element: EditorElement) {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { w: element.w, h: element.h };
    const move = (moveEvent: PointerEvent) => {
      const dw = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dh = ((moveEvent.clientY - startY) / rect.height) * 100;
      onGeometryChange?.(element.key, {
        w: round1(clamp(origin.w + dw, 2, 100 - element.x)),
        h: round1(clamp(origin.h + dh, 2, 100 - element.y)),
      });
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
        "relative w-full overflow-hidden rounded-xl border shadow-soft",
        themeCanvasClass(palette),
        className,
      )}
    >
      {slide.elements.map((element) => {
        const className = cn(
          "absolute select-none whitespace-pre-wrap rounded",
          // Les formes suivent le thème de la diapositive (jetons sémantiques).
          element.kind === "shape" && themeShapeClass(palette),
          element.kind === "image" && "bg-muted",
        );
        const style = {
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.w}%`,
          height: `${element.h}%`,
          fontSize: `calc(${element.fontSize} * 100cqw / var(--slide-design-width))`,
          fontWeight: element.bold ? 700 : 400,
          textAlign: element.align,
          lineHeight: 1.25,
        } as const;
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
          ) : (
            element.text
          );
        if (!interactive) {
          return (
            <div key={element.key} className={className} style={style}>
              {content}
            </div>
          );
        }
        return (
          <button
            key={element.key}
            type="button"
            aria-label={
              element.kind === "image"
                ? "Élément image"
                : element.text
                  ? `Élément ${element.text}`
                  : `Élément ${element.kind === "shape" ? "forme" : "texte"}`
            }
            onPointerDown={(event) => startElementDrag(event, element)}
            onClick={(event) => {
              event.stopPropagation();
              onSelectElement?.(element.key);
            }}
            className={cn(
              className,
              "cursor-move text-left focus-visible:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selectedElementKey === element.key &&
                "outline outline-2 outline-offset-2 outline-ring",
            )}
            style={style}
          >
            {content}
            {selectedElementKey === element.key ? (
              <span
                aria-hidden
                onPointerDown={(event) => startElementResize(event, element)}
                className="absolute -bottom-1 -right-1 size-3 cursor-nwse-resize rounded-sm border border-border bg-background"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
