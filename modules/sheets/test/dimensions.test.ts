import { describe, expect, it } from "vitest";
import type { DimensionSize } from "../src/dimensions.ts";
import {
  applyResize,
  clampSize,
  DIMENSION_INDEX_MAX,
  DIMENSION_KEY_STEP,
  DIMENSION_KEY_STEP_LARGE,
  DIMENSION_LIMITS,
  isCustomSize,
  MAX_DIMENSION_SIZES,
  parseSizes,
  sizeKey,
  sizeOf,
  stepSize,
  validateSize,
} from "../src/dimensions.ts";

describe("dimensions — bornes des tailles", () => {
  it("clampSize ramène dans les bornes et arrondit", () => {
    expect(clampSize("col", 500)).toBe(500);
    expect(clampSize("col", 5)).toBe(DIMENSION_LIMITS.col.min);
    expect(clampSize("col", 9_000)).toBe(DIMENSION_LIMITS.col.max);
    expect(clampSize("col", 96.4)).toBe(96);
    expect(clampSize("row", 1_000)).toBe(DIMENSION_LIMITS.row.max);
    expect(clampSize("row", Number.NaN)).toBe(DIMENSION_LIMITS.row.fallback);
    expect(clampSize("row", Number.POSITIVE_INFINITY)).toBe(DIMENSION_LIMITS.row.fallback);
    expect(clampSize("row", -Number.POSITIVE_INFINITY)).toBe(DIMENSION_LIMITS.row.fallback);
  });

  it("validateSize accepte puis refuse hors bornes, en français", () => {
    expect(validateSize("col", 0, 96)).toBeNull();
    expect(validateSize("col", DIMENSION_INDEX_MAX.col - 1, DIMENSION_LIMITS.col.max)).toBeNull();

    expect(validateSize("col", -1, 96)).toMatch(/hors limites/);
    expect(validateSize("col", DIMENSION_INDEX_MAX.col, 96)).toMatch(
      new RegExp(`${DIMENSION_INDEX_MAX.col} maximum`),
    );
    expect(validateSize("col", 0, DIMENSION_LIMITS.col.max + 1)).toBe(
      `Taille de colonne entre ${DIMENSION_LIMITS.col.min} et ${DIMENSION_LIMITS.col.max} pixels.`,
    );
    expect(validateSize("row", 0, 12.5)).toMatch(/Taille de ligne entre/);
    expect(validateSize("row", 0, Number.NaN)).toMatch(/Taille de ligne entre/);
    // Un axe inconnu est refusé en français au lieu de provoquer une erreur.
    expect(validateSize("depth" as DimensionSize["axis"], 0, 100)).toMatch(
      /Axe de redimensionnement invalide/,
    );
  });
});

describe("dimensions — lecture et écriture des cartes", () => {
  it("sizeOf retombe sur le défaut de l'axe", () => {
    const sizes = new Map([[3, 240]]);
    expect(sizeOf(sizes, 3, "col")).toBe(240);
    expect(sizeOf(sizes, 4, "col")).toBe(DIMENSION_LIMITS.col.fallback);
    expect(sizeOf(sizes, 0, "row")).toBe(DIMENSION_LIMITS.row.fallback);
  });

  it("applyResize est immuable et retire une taille revenue au défaut", () => {
    const base = new Map([[1, 120]]);
    const grown = applyResize(base, "col", 1, 200);
    expect(grown).not.toBe(base);
    expect(grown.get(1)).toBe(200);
    expect(base.get(1)).toBe(120);

    const reset = applyResize(grown, "col", 1, DIMENSION_LIMITS.col.fallback);
    expect(reset.has(1)).toBe(false);
    // Hors bornes : la valeur est bornée, jamais ignorée.
    expect(applyResize(base, "col", 1, 9_999).get(1)).toBe(DIMENSION_LIMITS.col.max);
  });

  it("stepSize décale une taille existante ou par défaut", () => {
    const empty = new Map<number, number>();
    const first = stepSize(empty, "col", 0, DIMENSION_KEY_STEP);
    expect(first.get(0)).toBe(DIMENSION_LIMITS.col.fallback + DIMENSION_KEY_STEP);

    expect(stepSize(empty, "col", 0, -DIMENSION_KEY_STEP).get(0)).toBe(
      DIMENSION_LIMITS.col.fallback - DIMENSION_KEY_STEP,
    );
    expect(stepSize(empty, "col", 0, -10_000).get(0)).toBe(DIMENSION_LIMITS.col.min);
    expect(stepSize(empty, "col", 0, 10_000).get(0)).toBe(DIMENSION_LIMITS.col.max);
    expect(DIMENSION_KEY_STEP_LARGE).toBeGreaterThan(DIMENSION_KEY_STEP);
  });

  it("isCustomSize distingue le défaut d'un vrai écart", () => {
    expect(isCustomSize("col", DIMENSION_LIMITS.col.fallback)).toBe(false);
    expect(isCustomSize("col", DIMENSION_LIMITS.col.fallback + 1)).toBe(true);
  });

  it("sizeKey sépare les axes", () => {
    expect(sizeKey("col", 2)).toBe("col:2");
    expect(sizeKey("row", 2)).toBe("row:2");
  });

  it("MAX_DIMENSION_SIZES borne le lot envoyé au serveur", () => {
    expect(MAX_DIMENSION_SIZES).toBeGreaterThan(0);
  });
});

describe("dimensions — relecture des tailles persistées", () => {
  it("regroupe par onglet et par axe", () => {
    const parsed = parseSizes([
      { tabId: "a", axis: "col", index: 1, size: 140 },
      { tabId: "a", axis: "row", index: 2, size: 40 },
      { tabId: "b", axis: "col", index: 0, size: 120 },
    ]);
    expect(parsed.get("a")?.col.get(1)).toBe(140);
    expect(parsed.get("a")?.row.get(2)).toBe(40);
    expect(parsed.get("b")?.col.get(0)).toBe(120);
  });

  it("ignore les entrées invalides sans casser l'affichage", () => {
    const records: (DimensionSize & { tabId: string })[] = [
      { tabId: "a", axis: "col", index: 1, size: 140 },
      // axe inconnu, taille hors bornes, position négative, défaut (non stocké)
      { tabId: "a", axis: "depth" as DimensionSize["axis"], index: 1, size: 100 },
      { tabId: "a", axis: "col", index: 0, size: 9_999 },
      { tabId: "a", axis: "row", index: -1, size: 40 },
      { tabId: "a", axis: "col", index: 2, size: DIMENSION_LIMITS.col.fallback },
      { tabId: "a", axis: "row", index: 0, size: Number.NaN } as DimensionSize & { tabId: string },
    ];
    const parsed = parseSizes(records);
    expect([...(parsed.get("a")?.col.entries() ?? [])]).toEqual([[1, 140]]);
    expect(parsed.get("a")?.row.size).toBe(0);
  });

  it("ne partage pas les cartes entre onglets", () => {
    const parsed = parseSizes([
      { tabId: "a", axis: "col", index: 1, size: 140 },
      { tabId: "b", axis: "col", index: 1, size: 200 },
    ]);
    expect(parsed.get("a")?.col).not.toBe(parsed.get("b")?.col);
  });
});
