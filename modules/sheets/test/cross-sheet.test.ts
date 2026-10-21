import { describe, expect, it } from "vitest";
import { evaluateCells, formatValue, quoteSheetName, shiftFormula } from "../src/formula.ts";

const show = (
  cells: Record<string, string>,
  sheets: Record<string, Record<string, string>>,
  key: string,
  sheetName = "Feuille 1",
) => {
  const value = evaluateCells(cells, { sheets, sheetName }).get(key);
  return value ? formatValue(value) : "";
};

describe("références entre onglets", () => {
  const sheets = {
    Feuil2: { A1: "10", A2: "32", B1: "=A1*2" },
    "Mes données": { A1: "5", C3: "=Feuil2!B1+1" },
  };

  it("lit une cellule et une plage d'un autre onglet", () => {
    expect(show({ A1: "=Feuil2!A1" }, sheets, "A1")).toBe("10");
    expect(show({ A1: "=SOMME(Feuil2!A1:A2)" }, sheets, "A1")).toBe("42");
    expect(show({ A1: "=feuil2!b1" }, sheets, "A1")).toBe("20");
    expect(show({ A1: "=SUM(Feuil2!A:A)" }, sheets, "A1")).toBe("42");
  });

  it("nom entre guillemets simples et références en chaîne", () => {
    expect(show({ A1: "='Mes données'!A1*3" }, sheets, "A1")).toBe("15");
    expect(show({ A1: "='Mes données'!C3" }, sheets, "A1")).toBe("21");
  });

  it("l'onglet courant nommé explicitement et l'onglet inconnu", () => {
    expect(show({ A1: "4", B1: "='Feuille 1'!A1+1" }, sheets, "B1")).toBe("5");
    expect(show({ A1: "=Inconnu!A1" }, sheets, "A1")).toBe("#REF!");
  });

  it("détecte les cycles entre onglets", () => {
    const book = { Feuil2: { A1: "='Feuille 1'!A1" } };
    expect(show({ A1: "=Feuil2!A1" }, book, "A1")).toBe("#CYCLE");
  });

  it("décale les références mais jamais le nom d'onglet", () => {
    expect(shiftFormula("=Feuil2!A1+'Q1 2025'!B2", 1, 1)).toBe("=Feuil2!B2+'Q1 2025'!C3");
    expect(quoteSheetName("Feuil2")).toBe("Feuil2");
    expect(quoteSheetName("Mes données")).toBe("'Mes données'");
    expect(quoteSheetName("A1")).toBe("'A1'");
    expect(quoteSheetName("l'été")).toBe("'l''été'");
  });
});
