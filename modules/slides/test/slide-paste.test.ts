import { describe, expect, it } from "vitest";
import {
  appendPastedText,
  cleanPastedText,
  MAX_ELEMENT_TEXT,
  pastedTextBox,
} from "../src/slide-paste.ts";

describe("collage de texte externe", () => {
  it("normalise fins de ligne, tabulations et caractères de contrôle", () => {
    expect(cleanPastedText("Ligne 1\r\nLigne 2\rLigne 3")).toBe("Ligne 1\nLigne 2\nLigne 3");
    expect(cleanPastedText("a\tb")).toBe("a  b");
    expect(cleanPastedText("x\u0000y\u0007z")).toBe("xyz");
    expect(cleanPastedText("\n\nTitre  \n\n")).toBe("Titre");
  });

  it("borne la longueur à la limite d'un élément", () => {
    expect(cleanPastedText("a".repeat(5000))).toHaveLength(MAX_ELEMENT_TEXT);
    expect(appendPastedText("b".repeat(1990), "c".repeat(50))).toHaveLength(MAX_ELEMENT_TEXT);
  });

  it("remplit une zone vide, complète une zone pleine", () => {
    expect(appendPastedText("", "Bonjour")).toBe("Bonjour");
    expect(appendPastedText("   ", "Bonjour")).toBe("Bonjour");
    expect(appendPastedText("Bonjour ", "le monde")).toBe("Bonjour le monde");
  });

  it("dimensionne la zone créée selon le texte, dans la diapositive", () => {
    const short = pastedTextBox("Titre");
    expect(short.fontSize).toBe(24);
    expect(short.x + short.w).toBeLessThanOrEqual(100);
    expect(short.y + short.h).toBeLessThanOrEqual(100);
    const long = pastedTextBox(Array.from({ length: 30 }, (_, i) => `Ligne ${i}`).join("\n"));
    expect(long.fontSize).toBe(16);
    expect(long.h).toBeGreaterThan(short.h);
    expect(long.h).toBeLessThanOrEqual(80);
    expect(long.y + long.h).toBeLessThanOrEqual(100);
  });
});
