import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_VIEWPORT,
  PREVIEW_VIEWPORTS,
  previewFrameHeight,
  previewFrameWidth,
  previewViewport,
  previewViewportLabel,
} from "../src/preview.ts";

describe("sites — gabarits d'aperçu (TASK-004)", () => {
  it("propose trois gabarits réalistes, du plus large au plus étroit", () => {
    expect(PREVIEW_VIEWPORTS.map((viewport) => viewport.id)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    const widths = PREVIEW_VIEWPORTS.map((viewport) => viewport.width);
    expect(widths).toEqual([1280, 834, 390]);
    // Ordre décroissant strict : la liste se lit du grand écran au téléphone.
    for (let index = 1; index < widths.length; index += 1) {
      expect(widths[index]!).toBeLessThan(widths[index - 1]!);
    }
  });

  it("nomme chaque gabarit pour les libellés d'accessibilité", () => {
    expect(PREVIEW_VIEWPORTS.map((viewport) => viewport.label)).toEqual([
      "Ordinateur",
      "Tablette",
      "Mobile",
    ]);
    expect(previewViewportLabel("mobile")).toBe("Mobile");
    const heights = PREVIEW_VIEWPORTS.map((viewport) => viewport.height);
    // Chaque gabarit porte une hauteur de référence réaliste (> 700 px), et
    // deux gabarits n'ont jamais la même hauteur.
    for (const height of heights) expect(height).toBeGreaterThan(700);
    expect(new Set(heights).size).toBe(heights.length);
  });

  it("retombe sur le gabarit par défaut pour un identifiant inconnu", () => {
    expect(previewViewport("televiseur")).toBe(previewViewport(DEFAULT_PREVIEW_VIEWPORT));
    expect(previewViewport("desktop").width).toBe(1280);
    expect(DEFAULT_PREVIEW_VIEWPORT).toBe("desktop");
  });

  it("rend une largeur et une hauteur de cadre en pixels CSS", () => {
    expect(previewFrameWidth("desktop")).toBe("1280px");
    expect(previewFrameWidth("tablet")).toBe("834px");
    expect(previewFrameWidth("mobile")).toBe("390px");
    expect(previewFrameWidth("inconnu")).toBe("1280px");
    expect(previewFrameHeight("mobile")).toBe("844px");
    // Les valeurs restent exploitables dans un `style` inline.
    expect(previewFrameWidth("mobile").endsWith("px")).toBe(true);
  });
});
