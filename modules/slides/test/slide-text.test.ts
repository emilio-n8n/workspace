import { describe, expect, it } from "vitest";
import {
  bumpFontSize,
  isBulletList,
  isNumberedList,
  normalizeTextColor,
  SLIDE_TEXT_COLOR_IDS,
  textColorClass,
  textColorLabel,
  textColorSwatch,
  toggleBulletList,
  toggleNumberedList,
} from "../src/slide-text.ts";

describe("slides — mise en forme du texte", () => {
  it("propose cinq couleurs, dont le défaut hérité du thème", () => {
    expect(SLIDE_TEXT_COLOR_IDS).toEqual(["default", "muted", "accent", "attention", "danger"]);
    expect(textColorClass("default")).toBe("");
    for (const color of SLIDE_TEXT_COLOR_IDS) {
      expect(textColorLabel(color).length).toBeGreaterThan(0);
      expect(textColorSwatch(color).length).toBeGreaterThan(0);
    }
    // Chaque couleur non-défaut porte une classe de texte réelle.
    for (const color of SLIDE_TEXT_COLOR_IDS.filter((id) => id !== "default")) {
      expect(textColorClass(color).startsWith("text-")).toBe(true);
    }
  });

  it("relit une couleur inconnue vers le défaut", () => {
    expect(normalizeTextColor("accent")).toBe("accent");
    expect(normalizeTextColor("rose")).toBe("default");
    expect(normalizeTextColor(undefined)).toBe("default");
  });

  it("parcourt les paliers de taille dans les deux sens", () => {
    expect(bumpFontSize(24, 1)).toBe(28);
    expect(bumpFontSize(24, -1)).toBe(20);
    expect(bumpFontSize(8, -1)).toBe(8);
    expect(bumpFontSize(200, 1)).toBe(200);
    expect(bumpFontSize(7, 1)).toBe(10);
    expect(bumpFontSize(999, -1)).toBe(160);
  });

  it("gère les tailles hors rampe avec un pas de quatre", () => {
    expect(bumpFontSize(25, 1)).toBe(28);
    expect(bumpFontSize(25, -1)).toBe(24);
    expect(bumpFontSize(199, 1)).toBe(200);
  });

  it("bascule les puces ligne par ligne, lignes vides comprises", () => {
    expect(toggleBulletList("Un\nDeux")).toBe("• Un\n• Deux");
    expect(toggleBulletList("• Un\n• Deux")).toBe("Un\nDeux");
    expect(toggleBulletList("Un\n\nDeux")).toBe("• Un\n\n• Deux");
    // Un tiret est une puce : la bascule le retire aussi.
    expect(toggleBulletList("- Un\n- Deux")).toBe("Un\nDeux");
    expect(isBulletList("Un")).toBe(false);
    expect(isBulletList("• Un")).toBe(true);
    expect(isBulletList("")).toBe(false);
    expect(toggleBulletList("")).toBe("");
  });

  it("bascule la numérotation avec les rangs et remplace les puces", () => {
    expect(toggleNumberedList("Un\nDeux")).toBe("1. Un\n2. Deux");
    expect(toggleNumberedList("Un\n\nDeux")).toBe("1. Un\n\n2. Deux");
    expect(toggleNumberedList("1. Un\n2. Deux")).toBe("Un\nDeux");
    expect(toggleNumberedList("• Un\n• Deux")).toBe("1. Un\n2. Deux");
    expect(toggleBulletList("1. Un\n2. Deux")).toBe("• Un\n• Deux");
    expect(isNumberedList("2. Un")).toBe(true);
    expect(isNumberedList("Un")).toBe(false);
    expect(toggleNumberedList("")).toBe("");
  });
});
