/**
 * Formes de base d'une diapositive : rectangle, ellipse et ligne.
 *
 * La variante est portée par le `kind` de l'élément (« rectangle », « ellipse »
 * ou « ligne »). L'ancien kind générique « shape », écrit par les versions
 * précédentes, reste accepté et se rend comme un rectangle : aucune
 * présentation enregistrée ne devient illisible.
 *
 * Logique pure (aucune dépendance) : la barre d'outils, le canevas et les tests
 * partagent la même table, donc les mêmes libellés et la même géométrie.
 */

export type SlideShapeKind = "rectangle" | "ellipse" | "line";

/** Formes insérables, dans l'ordre de la barre d'outils. */
export const SLIDE_SHAPE_KINDS = ["rectangle", "ellipse", "line"] as const;

/** Kinds d'éléments qui se rendent comme une forme (l'héritage compris). */
export type ShapeElementKind = SlideShapeKind | "shape";

/** Tous les kinds de forme, forme générique héritée comprise. */
export const SHAPE_ELEMENT_KINDS = ["shape", ...SLIDE_SHAPE_KINDS] as const;

/** Géométrie par défaut d'une forme, en pourcentages de la diapositive. */
export type ShapeGeometry = { x: number; y: number; w: number; h: number };

const SHAPE_GEOMETRIES: Record<SlideShapeKind, ShapeGeometry> = {
  rectangle: { x: 10, y: 10, w: 24, h: 24 },
  ellipse: { x: 10, y: 10, w: 24, h: 24 },
  // La ligne se dessine au centre vertical de sa zone : petite hauteur.
  line: { x: 10, y: 48, w: 40, h: 6 },
};

const SHAPE_LABELS: Record<SlideShapeKind, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  line: "Ligne",
};

/** Vrai si le kind est une forme (variante concrète ou héritage). */
export function isShapeKind(value: unknown): value is ShapeElementKind {
  return typeof value === "string" && (SHAPE_ELEMENT_KINDS as readonly string[]).includes(value);
}

/** Variante concrète d'un élément forme ; « shape » (héritage) → rectangle. */
export function shapeVariant(kind: ShapeElementKind): SlideShapeKind {
  return kind === "shape" ? "rectangle" : kind;
}

/** Libellé français d'une forme (« Rectangle », « Ellipse », « Ligne »). */
export function shapeLabel(kind: ShapeElementKind): string {
  return SHAPE_LABELS[shapeVariant(kind)];
}

/** Géométrie par défaut d'une forme, copiée pour ne jamais être partagée. */
export function shapeGeometry(kind: SlideShapeKind): ShapeGeometry {
  return { ...SHAPE_GEOMETRIES[kind] };
}

/**
 * Classes de remplissage d'une forme : l'ellipse reprend le jeton de forme et
 * l'arrondit complètement. La ligne n'a pas de remplissage (trait dédié).
 */
export function shapeFillClass(kind: ShapeElementKind, fillClass: string): string {
  return shapeVariant(kind) === "ellipse" ? `${fillClass} rounded-full` : fillClass;
}
