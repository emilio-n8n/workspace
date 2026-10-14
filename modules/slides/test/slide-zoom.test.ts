import { describe, expect, it } from "vitest";
import { clampZoom, fitZoomPercent, nextZoom, SLIDE_ZOOM_PRESETS } from "../src/slide-zoom.ts";

describe("slides — zoom d'affichage", () => {
  it("propose des niveaux de 50 à 150 %", () => {
    expect(SLIDE_ZOOM_PRESETS).toEqual([50, 75, 100, 125, 150]);
  });

  it("borne le zoom entre 30 et 200 %, arrondi à l'entier", () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(10)).toBe(30);
    expect(clampZoom(500)).toBe(200);
    expect(clampZoom(112.6)).toBe(113);
    expect(clampZoom(Number.NaN)).toBe(100);
  });

  it("ajuste le canevas à la largeur de la fenêtre, marge comprise", () => {
    // (1200 − 48) / 960 × 100 = 120 %
    expect(fitZoomPercent(1200)).toBe(120);
    // Fenêtre étroite : borné au minimum lisible.
    expect(fitZoomPercent(200)).toBe(30);
    // Fenêtre démesurée : borné au maximum.
    expect(fitZoomPercent(4000)).toBe(200);
    // Largeur inconnue ou nulle : confort par défaut.
    expect(fitZoomPercent(0)).toBe(100);
    expect(fitZoomPercent(Number.NaN)).toBe(100);
  });

  it("avance et recule de preset en preset, puis par pas de 10 %", () => {
    expect(nextZoom(100, 1)).toBe(125);
    expect(nextZoom(100, -1)).toBe(75);
    expect(nextZoom(150, 1)).toBe(160);
    expect(nextZoom(50, -1)).toBe(40);
    expect(nextZoom(200, 1)).toBe(200);
    expect(nextZoom(30, -1)).toBe(30);
    // Valeur hors preset : le preset voisin prime.
    expect(nextZoom(110, 1)).toBe(125);
    expect(nextZoom(110, -1)).toBe(100);
  });
});
