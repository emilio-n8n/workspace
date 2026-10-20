import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_FILL,
  fillClass,
  fillLabel,
  lineFillClass,
  normalizeFill,
  normalizeRotation,
  rotateBy,
  rotationTransform,
  SLIDE_FILL_IDS,
} from "../src/slide-fill.ts";

describe("remplissage des éléments", () => {
  it("propose le thème en premier et des libellés français", () => {
    expect(SLIDE_FILL_IDS[0]).toBe("theme");
    expect(DEFAULT_SLIDE_FILL).toBe("theme");
    expect(fillLabel("accent")).toBe("Accent");
    expect(fillLabel("none")).toBe("Aucun");
  });

  it("retombe au thème pour toute valeur inconnue", () => {
    expect(normalizeFill("accent")).toBe("accent");
    expect(normalizeFill("fuchsia")).toBe("theme");
    expect(normalizeFill(undefined)).toBe("theme");
    expect(normalizeFill("toString")).toBe("theme");
  });

  it("« thème » garde la classe du design, les autres utilisent des jetons", () => {
    expect(fillClass("theme", "bg-muted")).toBe("bg-muted");
    expect(fillClass("accent", "bg-muted")).toContain("bg-primary");
    expect(fillClass("none", "bg-muted")).toBe("bg-transparent");
    for (const fill of SLIDE_FILL_IDS) {
      // Aucune couleur codée en dur (#hex, rgb) : uniquement des jetons.
      expect(fillClass(fill, "")).not.toMatch(/#|rgb\(/);
    }
  });

  it("colore le trait d'une ligne, sinon garde celui du design", () => {
    expect(lineFillClass("theme", "bg-border")).toBe("bg-border");
    expect(lineFillClass("none", "bg-border")).toBe("bg-border");
    expect(lineFillClass("danger", "bg-border")).toBe("bg-destructive");
  });
});

describe("rotation des éléments", () => {
  it("ramène la rotation dans [0, 360) en degrés entiers", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(45.4)).toBe(45);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(Object.is(normalizeRotation(-360), 0)).toBe(true);
    expect(normalizeRotation("30")).toBe(30);
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("pivote par pas de 90°", () => {
    expect(rotateBy(0, 90)).toBe(90);
    expect(rotateBy(270, 90)).toBe(0);
    expect(rotateBy(0, -90)).toBe(270);
  });

  it("n'émet une transformation CSS qu'au-delà de 0°", () => {
    expect(rotationTransform(0)).toBeUndefined();
    expect(rotationTransform(360)).toBeUndefined();
    expect(rotationTransform(30)).toBe("rotate(30deg)");
  });
});
