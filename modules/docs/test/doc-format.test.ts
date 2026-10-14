import { describe, expect, it } from "vitest";
import {
  DOC_FONT_SIZES,
  DOC_HIGHLIGHTS,
  DOC_TEXT_COLORS,
  normalizeDocFontSize,
  PARAGRAPH_STYLES,
} from "../src/doc-format.ts";

describe("docs — catalogue de mise en forme", () => {
  it("propose les styles de paragraphe dans l'ordre attendu", () => {
    expect(PARAGRAPH_STYLES.map((style) => style.id)).toEqual([
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "blockquote",
      "codeBlock",
    ]);
    for (const style of PARAGRAPH_STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it("n'utilise que des jetons sémantiques, jamais une couleur en dur", () => {
    expect(DOC_TEXT_COLORS[0]?.id).toBe("default");
    expect(DOC_TEXT_COLORS[0]?.css).toBeNull();
    for (const option of [...DOC_TEXT_COLORS, ...DOC_HIGHLIGHTS]) {
      if (option.css === null) continue;
      expect(option.css.startsWith("var(--")).toBe(true);
      expect(option.css.endsWith(")")).toBe(true);
    }
  });

  it("propose des tailles de police de 10 à 48", () => {
    expect(DOC_FONT_SIZES).toContain("12");
    expect(DOC_FONT_SIZES).toContain("48");
    for (const size of DOC_FONT_SIZES) {
      expect(Number(size)).toBeGreaterThanOrEqual(8);
      expect(Number(size)).toBeLessThanOrEqual(72);
    }
  });

  it("normalise une taille relue (« 16 », « 16px », inconnue)", () => {
    expect(normalizeDocFontSize("16")).toBe("16");
    expect(normalizeDocFontSize("18px")).toBe("18");
    expect(normalizeDocFontSize("17px")).toBeNull();
    expect(normalizeDocFontSize("abc")).toBeNull();
    expect(normalizeDocFontSize(undefined)).toBeNull();
  });
});
