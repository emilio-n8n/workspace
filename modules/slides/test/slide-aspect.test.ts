import { describe, expect, it } from "vitest";
import {
  aspectFactor,
  aspectLabel,
  aspectRatio,
  aspectRatioCss,
  conversionSummary,
  convertScene,
  DEFAULT_SLIDE_ASPECT,
  normalizeAspect,
  SLIDE_ASPECT_IDS,
  SLIDE_ASPECTS,
} from "../src/slide-aspect.ts";

type Scene = { x: number; y: number; w: number; h: number };

/** Premier élément d'une conversion (les tests ne convertissent jamais du vide). */
function first<T extends Scene>(elements: T[]): T {
  const element = elements[0];
  if (!element) throw new Error("élément manquant");
  return element;
}

describe("slides — formats de diapositive", () => {
  it("expose deux formats, l'écran large par défaut", () => {
    expect(SLIDE_ASPECT_IDS).toEqual(["16:9", "4:3"]);
    expect(DEFAULT_SLIDE_ASPECT).toBe("16:9");
    // Cadres comparables : hauteur commune de 9.
    expect(SLIDE_ASPECTS["16:9"]).toMatchObject({ width: 16, height: 9 });
    expect(SLIDE_ASPECTS["4:3"]).toMatchObject({ width: 12, height: 9 });
  });

  it("relit un format persisté et rejette les valeurs inconnues", () => {
    expect(normalizeAspect("4:3")).toBe("4:3");
    expect(normalizeAspect("16:9")).toBe("16:9");
    expect(normalizeAspect("3:2")).toBe(DEFAULT_SLIDE_ASPECT);
    expect(normalizeAspect(null)).toBe(DEFAULT_SLIDE_ASPECT);
    expect(normalizeAspect(42)).toBe(DEFAULT_SLIDE_ASPECT);
    expect(normalizeAspect(undefined)).toBe(DEFAULT_SLIDE_ASPECT);
  });

  it("rend le rapport de chaque format pour la classe CSS", () => {
    expect(aspectRatio("16:9")).toBeCloseTo(16 / 9, 5);
    expect(aspectRatio("4:3")).toBeCloseTo(4 / 3, 5);
    expect(aspectRatioCss("16:9")).toBe("16/9");
    expect(aspectRatioCss("4:3")).toBe("12/9");
    expect(aspectLabel("4:3")).toBe("4:3 — écran classique");
  });
});

describe("slides — facteur de conversion", () => {
  it("vaut 1 quand le format ne change pas", () => {
    expect(aspectFactor("16:9", "16:9")).toBe(1);
    expect(aspectFactor("4:3", "4:3")).toBe(1);
  });

  it("ne convertit que la hauteur : le canevas garde sa largeur", () => {
    // 16:9 → 4:3 : le cadre devient plus haut, les éléments gardent leur taille.
    expect(aspectFactor("16:9", "4:3")).toBeCloseTo(0.75, 5);
    // 4:3 → 16:9 : le cadre devient plus court.
    expect(aspectFactor("4:3", "16:9")).toBeCloseTo(4 / 3, 5);
  });
});

describe("slides — conversion de la scène", () => {
  it("ne touche à rien quand le format ne change pas", () => {
    const elements: Scene[] = [{ x: 10, y: 20, w: 30, h: 40 }];
    const result = convertScene(elements, "16:9", "16:9");
    expect(result.factor).toBe(1);
    expect(result.fit).toBe(1);
    expect(result.changed).toBe(false);
    expect(result.elements).toBe(elements);
  });

  it("met à l'échelle la hauteur et laisse la largeur de côté", () => {
    const result = convertScene<Scene>([{ x: 10, y: 20, w: 30, h: 40 }], "16:9", "4:3");
    expect(result.factor).toBeCloseTo(0.75, 5);
    expect(result.changed).toBe(true);
    // x et w inchangés : la largeur rendue du canevas ne bouge pas.
    expect(first(result.elements)).toEqual({ x: 10, y: 15, w: 30, h: 30 });
  });

  it("garde la taille réelle d'un élément plein cadre", () => {
    // Un élément qui remplit la diapositive conserve sa hauteur absolue :
    // le cadre est 33 % plus haut, il ne remplit donc plus que 75 %.
    const result = convertScene<Scene>([{ x: 0, y: 0, w: 100, h: 100 }], "16:9", "4:3");
    expect(first(result.elements)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
  });

  it("garde tous les éléments dans la diapositive", () => {
    const elements: Scene[] = [
      { x: 80, y: 80, w: 20, h: 20 },
      { x: 0, y: 50, w: 100, h: 50 },
      { x: 99, y: 1, w: 1, h: 99 },
    ];
    const result = convertScene<Scene>(elements, "4:3", "16:9");
    expect(result.fit).toBeLessThan(1);
    for (const element of result.elements) {
      expect(element.x).toBeGreaterThanOrEqual(0);
      expect(element.y).toBeGreaterThanOrEqual(0);
      expect(element.x + element.w).toBeLessThanOrEqual(100);
      expect(element.y + element.h).toBeLessThanOrEqual(100);
      expect(element.w).toBeGreaterThan(0);
      expect(element.h).toBeGreaterThan(0);
    }
  });

  it("réduit en bloc plutôt que de rogner quand le cadre devient plus court", () => {
    const result = convertScene<Scene>(
      [
        { x: 0, y: 0, w: 80, h: 60 },
        { x: 20, y: 70, w: 60, h: 30 },
      ],
      "4:3",
      "16:9",
    );
    // Le second élément débordait après conversion : toute la scène est réduite.
    expect(result.fit).toBeLessThan(1);
    for (const element of result.elements) {
      expect(element.y + element.h).toBeLessThanOrEqual(100);
      expect(element.x + element.w).toBeLessThanOrEqual(100);
    }
  });

  it("ne touche pas au rendu horizontal : la largeur du canevas est constante", () => {
    // Le canevas garde sa largeur rendue, donc x et w n'ont pas besoin d'être
    // convertis : un élément ne se déplace pas latéralement ni ne change de
    // largeur affichée.
    const element = first(
      convertScene<Scene>([{ x: 30, y: 10, w: 50, h: 20 }], "16:9", "4:3").elements,
    );
    expect(element.x).toBe(30);
    expect(element.w).toBe(50);
  });

  it("respecte la borne minimale du service sur les tailles", () => {
    const element = first(
      convertScene<Scene>([{ x: 0, y: 0, w: 1, h: 1 }], "16:9", "4:3").elements,
    );
    expect(element.w).toBe(1);
    expect(element.h).toBe(1);
  });

  it("ne modifie jamais l'objet d'origine (immutabilité)", () => {
    const elements: Scene[] = [{ x: 10, y: 10, w: 20, h: 20 }];
    const frozen = { ...elements[0] };
    convertScene(elements, "16:9", "4:3");
    expect(elements[0]).toEqual(frozen);
  });

  it("ramène une position absurde à l'intérieur de la diapositive", () => {
    const result = convertScene<Scene>([{ x: -5, y: 300, w: 30, h: 40 }], "16:9", "4:3");
    const element = first(result.elements);
    expect(element.x).toBe(0);
    expect(element.y + element.h).toBeLessThanOrEqual(100);
    expect(element.x + element.w).toBeLessThanOrEqual(100);
    expect(result.changed).toBe(true);
  });

  it("laisse une scène vide intacte", () => {
    const result = convertScene<Scene>([], "16:9", "4:3");
    expect(result.elements).toEqual([]);
    expect(result.changed).toBe(false);
  });
});

describe("slides — messages de conversion", () => {
  it("annonce le facteur appliqué, au singulier comme au pluriel", () => {
    expect(conversionSummary("16:9", "4:3", 1)).toBe(
      "Scène convertie de 16:9 vers 4:3 : 1 élément mis à l'échelle (75 % de la hauteur).",
    );
    expect(conversionSummary("16:9", "4:3", 3)).toBe(
      "Scène convertie de 16:9 vers 4:3 : 3 éléments mis à l'échelle (75 % de la hauteur).",
    );
  });
});
