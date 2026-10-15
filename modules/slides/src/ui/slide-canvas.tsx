// biome-ignore-all lint/a11y/noSvgWithoutTitle: SVG décoratifs de la scène, déjà masqués par aria-hidden.
import { cn } from "@workspace/ui";
import { useRef, useState } from "react";
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
import { type GuideLine, type SnapBox, snapMove, unionBox } from "../slide-guides.ts";
import { placeholderHint, placeholderLabel } from "../slide-layouts.ts";
import { isShapeKind, shapeFillClass, shapeLabel, shapeVariant } from "../slide-shapes.ts";
import { textColorClass } from "../slide-text.ts";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  type SlideThemeId,
  themeCanvasClass,
  themeDecor,
  themeLineClass,
  themeShapeClass,
} from "../slide-theme.ts";

export type SlideCanvasProps = {
  slide: EditorSlide;
  fileId: string;
  /** Mode édition : éléments sélectionnables, déplaçables, redimensionnables. */
  interactive?: boolean;
  /** Clés sélectionnées (sélection multiple possible, comme un vrai outil). */
  selectedElementKeys?: readonly string[];
  /** Clic sur un élément (`null` = fond). `additive` : Shift enfoncé. */
  onSelectElement?: (key: string | null, additive?: boolean) => void;
  /** Rectangle de sélection : remplace la sélection par les clés croisées. */
  onSelectionChange?: (keys: string[]) => void;
  onGeometryChange?: (key: string, patch: Partial<ElementGeometry>) => void;
  /** Début d'un geste (glisser ou redimensionner) : instantané d'historique. */
  onGestureStart?: () => void;
  /** Clé de l'élément dont le texte est en cours d'édition (en place). */
  editingKey?: string | null;
  /** Demande l'entrée en édition d'un élément (double-clic, zone vide). */
  onStartEdit?: (key: string) => void;
  /** Frappe dans l'éditeur en place : le texte est appliqué à chaque touche. */
  onTextChange?: (key: string, text: string) => void;
  /** Sortie du mode édition (Échap ou clic ailleurs). */
  onEndEdit?: () => void;
  /** Zone image : ouvre le choix d'une image pour remplacer la zone. */
  onRequestImage?: (key: string) => void;
  /** Format de la diapositive (défaut : écran large). */
  aspect?: SlideAspectId;
  /** Design construit sur les jetons sémantiques (défaut : papier). */
  theme?: SlideThemeId;
  className?: string;
};

/** Seuil de déplacement (px) avant de considérer qu'un glisser commence. */
const DRAG_THRESHOLD = 3;

/** Seuil (px) avant qu'un rectangle de sélection ne devienne un vrai geste. */
const MARQUEE_THRESHOLD = 4;

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

/** Deux boîtes se croisent-elles ? (rectangle de sélection) */
function boxesIntersect(a: SnapBox, b: SnapBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Rend une diapositive et ses éléments. Positions en pourcentage de la
 * diapositive, corps de texte mis à l'échelle par requête de conteneur : le
 * même composant sert au canevas d'édition, aux vignettes, au mode
 * présentation et à l'impression, sans duplication de règles de mise en page.
 *
 * En mode édition, on retrouve les gestes d'un vrai outil : sélection multiple
 * (Shift + clic, rectangle de sélection), déplacement de groupe, guides
 * aimantés sur les bords et les centres, huit poignées de redimensionnement,
 * zone image qui s'ouvre au clic, texte modifiable en place avec la
 * typographie exacte du rendu final.
 */
export function SlideCanvas({
  slide,
  fileId,
  interactive = false,
  selectedElementKeys = [],
  onSelectElement,
  onSelectionChange,
  onGeometryChange,
  onGestureStart,
  editingKey = null,
  onStartEdit,
  onTextChange,
  onEndEdit,
  onRequestImage,
  aspect = DEFAULT_SLIDE_ASPECT,
  theme = DEFAULT_SLIDE_THEME,
  className,
}: SlideCanvasProps) {
  const format = normalizeAspect(aspect);
  const palette = normalizeTheme(theme);
  const decor = themeDecor(palette);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Un glisser passé le seuil annule le clic qui le suit. */
  const dragMovedRef = useRef(false);
  /** Guides affichés pendant un glisser (bords et centres atteints). */
  const [guides, setGuides] = useState<GuideLine[]>([]);
  /** Rectangle de sélection en cours (coordonnées en %). */
  const [marquee, setMarquee] = useState<SnapBox | null>(null);

  /** Position en % d'un point de l'écran, dans le repère de la diapositive. */
  function pointOf(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function startElementDrag(event: React.PointerEvent<HTMLButtonElement>, element: EditorElement) {
    if (!interactive) return;
    event.preventDefault();
    event.stopPropagation();
    const additive = event.shiftKey;
    const alreadySelected = selectedElementKeys.includes(element.key);
    // Déplacer un élément sélectionné déplace toute la sélection ; sinon la
    // sélection se met d'abord à jour (le Shift ajoute au lieu de remplacer).
    if (!alreadySelected) onSelectElement?.(element.key, additive);
    const movingKeys = alreadySelected
      ? [...selectedElementKeys]
      : additive
        ? [...selectedElementKeys, element.key]
        : [element.key];
    onGestureStart?.();
    dragMovedRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const moving = slide.elements.filter((item) => movingKeys.includes(item.key));
    const others: SnapBox[] = slide.elements
      .filter((item) => !movingKeys.includes(item.key))
      .map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h }));
    const union = unionBox(moving.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h })));
    if (!union) return;
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      if (!dragging) {
        // Un simple clic ne doit pas déplacer l'élément d'un demi-pixel.
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        dragMovedRef.current = true;
      }
      // Aimantation : la boîte englobante se cale sur les repères proches.
      const snap = snapMove({ x: union.x + dx, y: union.y + dy, w: union.w, h: union.h }, others);
      const snapDx = snap.x - (union.x + dx);
      const snapDy = snap.y - (union.y + dy);
      setGuides(snap.guides);
      for (const item of moving) {
        onGeometryChange?.(item.key, {
          x: round1(clamp(item.x + dx + snapDx, 0, 100 - item.w)),
          y: round1(clamp(item.y + dy + snapDy, 0, 100 - item.h)),
        });
      }
    };
    const up = () => {
      setGuides([]);
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
    onGestureStart?.();
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

  /** Fond du canevas : rectangle de sélection, ou désélection d'un clic sec. */
  function startMarquee(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const start = pointOf(event.clientX, event.clientY, rect);
    let moved = false;
    const move = (moveEvent: PointerEvent) => {
      if (!moved) {
        const travel =
          Math.abs(moveEvent.clientX - event.clientX) + Math.abs(moveEvent.clientY - event.clientY);
        if (travel < MARQUEE_THRESHOLD) return;
        moved = true;
      }
      const current = pointOf(moveEvent.clientX, moveEvent.clientY, rect);
      setMarquee({
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y),
      });
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        const current = pointOf(upEvent.clientX, upEvent.clientY, rect);
        const box: SnapBox = {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          w: Math.abs(current.x - start.x),
          h: Math.abs(current.y - start.y),
        };
        const keys = slide.elements
          .filter((element) =>
            boxesIntersect(box, { x: element.x, y: element.y, w: element.w, h: element.h }),
          )
          .map((element) => element.key);
        onSelectionChange?.(keys);
      } else if (!event.shiftKey) {
        onSelectElement?.(null);
      }
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={startMarquee}
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
        // Le format et le design viennent d'ici : un seul canevas pour
        // l'édition, les vignettes, la présentation et l'impression.
        "relative w-full overflow-hidden rounded-sm border shadow-soft",
        themeCanvasClass(palette),
        className,
      )}
    >
      {/* Ornement du design (bandeau en haut, filet à gauche) : décoratif. */}
      {decor ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute",
            decor.position === "top" ? "inset-x-0 top-0 h-[5%]" : "inset-y-0 left-0 w-[2.5%]",
            decor.className,
          )}
        />
      ) : null}

      {slide.elements.map((element) => {
        // Forme concrète (rectangle, ellipse ou ligne) ; « shape » hérité rend
        // un rectangle. Le reste (texte, image) n'est pas une forme.
        const shape = isShapeKind(element.kind) ? shapeVariant(element.kind) : null;
        const selected = selectedElementKeys.includes(element.key);
        const className = cn(
          "absolute select-none whitespace-pre-wrap rounded-sm",
          // Les formes suivent le design de la diapositive (jetons sémantiques),
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
        const wantsImage = element.placeholder === "image" && element.kind !== "image";
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
            element.placeholder === "image" ? (
              <span
                aria-hidden
                className="flex size-full flex-col items-center justify-center gap-[0.4em] text-center italic opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[1.6em]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
                  <path d="m6.5 16 4-4.5 3 3 2.5-2.5 2.5 2.5" />
                  <circle cx="9" cy="9.5" r="1.4" />
                </svg>
                {placeholderHint(element.placeholder)}
              </span>
            ) : (
              <span aria-hidden className="italic opacity-50">
                {placeholderHint(element.placeholder)}
              </span>
            )
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
                  if (!node) return;
                  // Focus à l'ouverture de l'édition (pas d'attribut autoFocus :
                  // la règle d'accessibilité préfère un focus explicite), puis
                  // curseur en fin de texte : la frappe directe et le
                  // double-clic continuent le mot, jamais au milieu.
                  if (document.activeElement !== node) {
                    node.focus();
                    const end = node.value.length;
                    node.setSelectionRange(end, end);
                  }
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
              onSelectElement?.(element.key, event.shiftKey);
              // Une zone vide s'ouvre au simple clic : le texte en édition, la
              // zone image sur le choix d'une image.
              if (element.kind === "image" || element.text.trim().length > 0) return;
              if (wantsImage) onRequestImage?.(element.key);
              else if (element.placeholder !== null) onStartEdit?.(element.key);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (element.kind === "image") return;
              if (wantsImage) onRequestImage?.(element.key);
              else onStartEdit?.(element.key);
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
            {selected && selectedElementKeys.length === 1
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

      {/* Guides aimantés : bords et centres atteints pendant un glisser. */}
      {guides.map((guide) => (
        <span
          key={`${guide.axis}-${guide.position}`}
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-30 bg-primary/60",
            guide.axis === "x" ? "inset-y-0 w-px" : "inset-x-0 h-px",
          )}
          style={
            guide.axis === "x" ? { left: `${guide.position}%` } : { top: `${guide.position}%` }
          }
        />
      ))}

      {/* Rectangle de sélection : croise les éléments et les sélectionne. */}
      {marquee ? (
        <span
          aria-hidden
          className="pointer-events-none absolute z-30 border border-dashed border-primary bg-primary/10"
          style={{
            left: `${marquee.x}%`,
            top: `${marquee.y}%`,
            width: `${marquee.w}%`,
            height: `${marquee.h}%`,
          }}
        />
      ) : null}
    </div>
  );
}
