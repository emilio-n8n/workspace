import { describe, expect, it } from "vitest";
import {
  isShapeKind,
  SHAPE_ELEMENT_KINDS,
  SLIDE_SHAPE_KINDS,
  shapeFillClass,
  shapeGeometry,
  shapeLabel,
  shapeVariant,
} from "../src/slide-shapes.ts";

describe("slides — formes de base", () => {
  it("propose rectangle, ellipse et ligne, dans cet ordre", () => {
    expect(SLIDE_SHAPE_KINDS).toEqual(["rectangle", "ellipse", "line"]);
    expect(SHAPE_ELEMENT_KINDS).toEqual(["shape", "rectangle", "ellipse", "line"]);
  });

  it("reconnaît les kinds de forme, héritage compris", () => {
    for (const kind of SHAPE_ELEMENT_KINDS) expect(isShapeKind(kind)).toBe(true);
    expect(isShapeKind("text")).toBe(false);
    expect(isShapeKind("image")).toBe(false);
    expect(isShapeKind(null)).toBe(false);
    expect(isShapeKind(7)).toBe(false);
  });

  it("rend la forme générique héritée comme un rectangle", () => {
    expect(shapeVariant("shape")).toBe("rectangle");
    expect(shapeVariant("ellipse")).toBe("ellipse");
    expect(shapeLabel("shape")).toBe("Rectangle");
    expect(shapeLabel("rectangle")).toBe("Rectangle");
    expect(shapeLabel("ellipse")).toBe("Ellipse");
    expect(shapeLabel("line")).toBe("Ligne");
  });

  it("donne une géométrie par défaut distincte à la ligne", () => {
    const rectangle = shapeGeometry("rectangle");
    expect(rectangle).toEqual({ x: 10, y: 10, w: 24, h: 24 });
    const line = shapeGeometry("line");
    expect(line.w).toBe(40);
    // La ligne se dessine au centre vertical de sa zone : hauteur modeste.
    expect(line.h).toBeLessThan(rectangle.h);
    // Chaque appel renvoie une copie : l'appelant ne peut pas muter la table.
    const again = shapeGeometry("rectangle");
    again.x = 99;
    expect(shapeGeometry("rectangle").x).toBe(10);
  });

  it("arrondit complètement l'ellipse, et seulement elle", () => {
    const fill = "border-border bg-muted";
    expect(shapeFillClass("ellipse", fill)).toBe("border-border bg-muted rounded-full");
    expect(shapeFillClass("rectangle", fill)).toBe(fill);
    expect(shapeFillClass("shape", fill)).toBe(fill);
    expect(shapeFillClass("line", fill)).toBe(fill);
  });
});
