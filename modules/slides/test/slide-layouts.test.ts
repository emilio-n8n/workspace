import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEW_LAYOUT,
  layoutElements,
  layoutHint,
  layoutLabel,
  normalizeLayout,
  normalizePlaceholder,
  placeholderHint,
  placeholderLabel,
  SLIDE_LAYOUT_IDS,
  SLIDE_LAYOUTS,
} from "../src/slide-layouts.ts";

describe("slides — mises en page", () => {
  it("décrit les trois mises en page avec libellé et aide", () => {
    expect(SLIDE_LAYOUT_IDS).toEqual(["title", "title-content", "blank"]);
    for (const id of SLIDE_LAYOUT_IDS) {
      expect(layoutLabel(id).length).toBeGreaterThan(0);
      expect(layoutHint(id).length).toBeGreaterThan(0);
    }
  });

  it("place les zones dans les bornes de la diapositive", () => {
    for (const id of SLIDE_LAYOUT_IDS) {
      for (const zone of layoutElements(id)) {
        expect(zone.x).toBeGreaterThanOrEqual(0);
        expect(zone.y).toBeGreaterThanOrEqual(0);
        expect(zone.x + zone.w).toBeLessThanOrEqual(100);
        expect(zone.y + zone.h).toBeLessThanOrEqual(100);
        expect(zone.fontSize).toBeGreaterThanOrEqual(8);
        expect(zone.fontSize).toBeLessThanOrEqual(200);
      }
    }
  });

  it("compose la mise en page « Titre » d'un titre et d'un sous-titre", () => {
    const zones = layoutElements("title");
    expect(zones.map((zone) => zone.placeholder)).toEqual(["title", "subtitle"]);
    expect(zones[0]?.bold).toBe(true);
    expect(zones[0]?.align).toBe("center");
  });

  it("compose la mise en page « Titre et contenu » d'un titre et d'un corps", () => {
    expect(layoutElements("title-content").map((zone) => zone.placeholder)).toEqual([
      "title",
      "body",
    ]);
  });

  it("rend une copie des zones : la table n'est jamais mutée", () => {
    const zones = layoutElements("title");
    const zone = zones[0];
    if (!zone) throw new Error("zone absente");
    zone.x = 99;
    expect(SLIDE_LAYOUTS.title.elements[0]?.x).not.toBe(99);
  });

  it("relit une mise en page inconnue vers la mise en page par défaut", () => {
    expect(normalizeLayout("title")).toBe("title");
    expect(normalizeLayout("inconnue")).toBe(DEFAULT_NEW_LAYOUT);
    expect(normalizeLayout(42)).toBe(DEFAULT_NEW_LAYOUT);
  });

  it("relit un rôle de zone : valeur inconnue ou absente → aucune zone", () => {
    expect(normalizePlaceholder("body")).toBe("body");
    expect(normalizePlaceholder("autre")).toBeNull();
    expect(normalizePlaceholder(null)).toBeNull();
  });

  it("fournit des invitations et des noms courts en français", () => {
    expect(placeholderHint("title")).toBe("Cliquez pour ajouter un titre");
    expect(placeholderHint("subtitle")).toBe("Cliquez pour ajouter un sous-titre");
    expect(placeholderHint("body")).toBe("Cliquez pour ajouter du texte");
    expect(placeholderLabel("subtitle")).toBe("sous-titre");
    expect(placeholderLabel("body")).toBe("texte");
  });
});
