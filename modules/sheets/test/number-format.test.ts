import { describe, expect, it } from "vitest";
import {
  CELL_FORMATS,
  CELL_STORED_FORMAT_IDS,
  formatCellDisplay,
  normalizeStoredFormat,
  parseCellNumber,
} from "../src/number-format.ts";

/** Les espaces fines insécables de l'Intl français ne doivent pas faire échouer un test. */
function plainSpaces(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ");
}

describe("sheets — formats de nombre", () => {
  it("propose cinq formats dont « auto », et quatre formats stockables", () => {
    expect(CELL_FORMATS.map((format) => format.id)).toEqual([
      "auto",
      "number",
      "integer",
      "percent",
      "currency",
    ]);
    expect([...CELL_STORED_FORMAT_IDS]).toEqual(["number", "integer", "percent", "currency"]);
    for (const format of CELL_FORMATS) {
      expect(format.label.length).toBeGreaterThan(0);
      expect(format.glyph.length).toBeGreaterThan(0);
    }
  });

  it("relit un format stocké et refuse le reste", () => {
    expect(normalizeStoredFormat("percent")).toBe("percent");
    expect(normalizeStoredFormat("auto")).toBeNull();
    expect(normalizeStoredFormat("scientifique")).toBeNull();
    expect(normalizeStoredFormat(42)).toBeNull();
  });

  it("analyse les nombres écrits, y compris à la française", () => {
    expect(parseCellNumber("42")).toBe(42);
    expect(parseCellNumber("3.14")).toBe(3.14);
    expect(parseCellNumber("-0,5")).toBe(-0.5);
    // Espaces insécables (fine et normale) tolérées comme séparateurs de milliers.
    expect(parseCellNumber("1\u202f234,5")).toBe(1234.5);
    expect(parseCellNumber("1\u00a0234,5")).toBe(1234.5);
    expect(parseCellNumber("bonjour")).toBeNull();
    expect(parseCellNumber("12abc")).toBeNull();
    expect(parseCellNumber("")).toBeNull();
  });

  it("laisse la valeur intacte en format automatique ou non numérique", () => {
    expect(formatCellDisplay("bonjour", "auto")).toBe("bonjour");
    expect(formatCellDisplay("3.14", "auto")).toBe("3.14");
    expect(formatCellDisplay("bonjour", "number")).toBe("bonjour");
  });

  it("formate nombres, entiers, pourcentages et euros en français", () => {
    expect(plainSpaces(formatCellDisplay("3.14", "number"))).toBe("3,14");
    expect(plainSpaces(formatCellDisplay("1234.5", "number"))).toBe("1 234,50");
    expect(plainSpaces(formatCellDisplay("3.6", "integer"))).toBe("4");
    expect(plainSpaces(formatCellDisplay("0.25", "percent"))).toBe("25,00 %");
    expect(plainSpaces(formatCellDisplay("1234.5", "currency"))).toBe("1 234,50 €");
  });

  it("ne persiste jamais d'arrondi : le format ne touche pas à la valeur brute", () => {
    const raw = "3.14159";
    expect(formatCellDisplay(raw, "number")).not.toBe(raw);
    expect(raw).toBe("3.14159");
  });
});
