import { describe, expect, it } from "vitest";
import { cellKey, evaluateCells, formatValue, parseKey } from "../src/formula.ts";

function value(cells: Record<string, string>, key: string): string {
  const evaluated = evaluateCells(cells);
  const cell = evaluated.get(key);
  return cell ? formatValue(cell) : "";
}

describe("formula — références", () => {
  it("convertit lignes/colonnes et références", () => {
    expect(cellKey(0, 0)).toBe("A1");
    expect(cellKey(9, 25)).toBe("Z10");
    expect(cellKey(0, 26)).toBe("AA1");
    expect(parseKey("B3")).toEqual({ row: 2, col: 1 });
    expect(parseKey("invalide")).toBeNull();
  });

  it("rejette les références hors bornes (anti-DoS)", () => {
    expect(parseKey("A1000001")).toBeNull();
    expect(parseKey("A1000000")).toEqual({ row: 999_999, col: 0 });
    expect(parseKey("AAA1")).toEqual({ row: 0, col: 702 });
    expect(parseKey("AAB1")).toBeNull();
    // 300 lettres : la colonne vaudrait Infinity et cellKey bouclerait sans fin.
    expect(parseKey(`${"A".repeat(300)}1`)).toBeNull();
    expect(parseKey("A99999999999999999999")).toBeNull();
  });
});

describe("formula — évaluation", () => {
  it("littéraux numériques et textuels", () => {
    expect(value({ A1: "42" }, "A1")).toBe("42");
    expect(value({ A1: "3.5" }, "A1")).toBe("3.5");
    expect(value({ A1: "bonjour" }, "A1")).toBe("bonjour");
  });

  it("arithmétique et parenthèses", () => {
    expect(value({ A1: "=1+2" }, "A1")).toBe("3");
    expect(value({ A1: "=2*3+1" }, "A1")).toBe("7");
    expect(value({ A1: "=(2+3)*4" }, "A1")).toBe("20");
    expect(value({ A1: "=10/4" }, "A1")).toBe("2.5");
    expect(value({ A1: "=1+2e3" }, "A1")).toBe("2001");
  });

  it("références de cellules", () => {
    expect(value({ A1: "2", B1: "3", C1: "=A1+B1" }, "C1")).toBe("5");
    expect(value({ A1: "=B1*2", B1: "=C1+1", C1: "4" }, "A1")).toBe("10");
  });

  it("traite une cellule vide comme 0 en arithmétique", () => {
    expect(value({ B1: "=A1+1" }, "B1")).toBe("1");
    expect(value({ A1: "", B1: "=A1*3" }, "B1")).toBe("0");
    expect(value({ B1: "=-A1" }, "B1")).toBe("0");
  });

  it("agrégats SUM, AVG, MIN, MAX, COUNT", () => {
    const base = { A1: "1", A2: "2", A3: "3" };
    expect(value({ ...base, B1: "=SUM(A1:A3)" }, "B1")).toBe("6");
    expect(value({ ...base, B1: "=AVG(A1:A3)" }, "B1")).toBe("2");
    expect(value({ ...base, B1: "=MIN(A1:A3)" }, "B1")).toBe("1");
    expect(value({ ...base, B1: "=MAX(A1:A3)" }, "B1")).toBe("3");
    expect(value({ ...base, B1: "=COUNT(A1:A3)" }, "B1")).toBe("3");
    expect(value({ ...base, B1: "=SUM(A1:A3, 10)" }, "B1")).toBe("16");
  });

  it("accepte littéraux, références nues et appels imbriqués comme arguments", () => {
    const base = { A1: "1", A2: "2", A3: "3" };
    expect(value({ ...base, B1: "=SUM(10)" }, "B1")).toBe("10");
    expect(value({ ...base, B1: "=SUM(A1, 10)" }, "B1")).toBe("11");
    expect(value({ ...base, B1: "=SUM(MAX(A1:A3))" }, "B1")).toBe("3");
    expect(value({ ...base, B1: "=SUM(A1:A2*2)" }, "B1")).toBe("#ERREUR");
    expect(value({ ...base, B1: "=SUM(A1:A3+x)" }, "B1")).toBe("#ERREUR");
    expect(value({ ...base, B1: "=COUNT(10, 20)" }, "B1")).toBe("2");
    expect(value({ ...base, B1: "=COUNT(A1, 10)" }, "B1")).toBe("2");
    expect(value({ ...base, B1: "=COUNT(A1:A2, 10, A3)" }, "B1")).toBe("4");
  });

  it("ignore le texte dans les agrégats", () => {
    expect(value({ A1: "1", A2: "texte", A3: "3", B1: "=SUM(A1:A3)" }, "B1")).toBe("4");
    expect(value({ A1: "1", A2: "texte", B1: "=COUNT(A1:A2)" }, "B1")).toBe("1");
  });

  it("AVG sans valeur numérique → #DIV/0, MIN/MAX vides → 0", () => {
    expect(value({ B1: "=AVG(A1:A3)" }, "B1")).toBe("#DIV/0");
    expect(value({ A1: "texte", B1: "=AVG(A1:A2)" }, "B1")).toBe("#DIV/0");
    expect(value({ B1: "=MIN(A1:A3)" }, "B1")).toBe("0");
    expect(value({ B1: "=MAX(A1:A3)" }, "B1")).toBe("0");
    expect(value({ B1: "=COUNT(A1:A3)" }, "B1")).toBe("0");
  });

  it("détecte la division par zéro", () => {
    expect(value({ A1: "=1/0" }, "A1")).toBe("#DIV/0");
    expect(value({ A1: "2", B1: "=A1/0" }, "B1")).toBe("#DIV/0");
  });

  it("signale un débordement avec #NUM!", () => {
    expect(value({ A1: `=${"9".repeat(400)}` }, "A1")).toBe("#NUM!");
    expect(value({ A1: "=1e308*10" }, "A1")).toBe("#NUM!");
    // Une division par zéro reste #DIV/0, jamais #NUM!.
    expect(value({ A1: "=1/0*1e308" }, "A1")).toBe("#DIV/0");
  });

  it("formate avec 15 chiffres significatifs", () => {
    expect(value({ A1: "=1/10000000" }, "A1")).toBe("1e-7");
    expect(value({ A1: "=1/3" }, "A1")).toBe("0.333333333333333");
    expect(value({ A1: "=0.1+0.2" }, "A1")).toBe("0.3");
  });

  it("détecte les cycles", () => {
    const evaluated = evaluateCells({ A1: "=B1", B1: "=A1" });
    expect(evaluated.get("A1")?.kind).toBe("error");
    expect(evaluated.get("B1")).toEqual({ kind: "error", code: "#CYCLE" });
  });

  it("signale les erreurs de syntaxe et le texte en arithmétique", () => {
    expect(value({ A1: "=1+" }, "A1")).toBe("#ERREUR");
    expect(value({ A1: "abc", B1: "=A1+1" }, "B1")).toBe("#ERREUR");
    expect(value({ A1: "=INCONNUE(A1)" }, "A1")).toBe("#ERREUR");
    expect(value({ A1: '=1+"texte"' }, "A1")).toBe("#ERREUR");
  });

  it("gère l'opérateur unaire devant un appel imbriqué", () => {
    const base = { A1: "4", A2: "6" };
    expect(value({ ...base, B1: "=-SUM(A1:A2)" }, "B1")).toBe("-10");
    expect(value({ ...base, B1: "=2*SUM(A1:A2)" }, "B1")).toBe("20");
    expect(value({ A1: "=-(2*3)" }, "A1")).toBe("-6");
  });

  it("refuse les plages trop grandes (anti-DoS)", () => {
    expect(value({ A1: "=SUM(A1:A10001)" }, "A1")).toBe("#ERREUR");
    expect(value({ A1: "=SUM(A1:A99999999999999999999)" }, "A1")).toBe("#ERREUR");
    expect(value({ A1: `=SUM(A1:${"A".repeat(300)}1)` }, "A1")).toBe("#ERREUR");
    expect(value({ B1: "=SUM(A1:A10000)" }, "B1")).toBe("0");
  });

  it("borne la profondeur d'évaluation croisée", () => {
    const chain: Record<string, string> = {};
    const length = 5_000;
    for (let index = 0; index < length - 1; index += 1) {
      chain[cellKey(index, 0)] = `=${cellKey(index + 1, 0)}`;
    }
    chain[cellKey(length - 1, 0)] = "1";

    const evaluated = evaluateCells(chain);
    expect(evaluated.get("A1")).toEqual({ kind: "error", code: "#ERREUR" });
  });

  it("calcule à travers les onglets d'une plage", () => {
    const cells: Record<string, string> = {};
    for (let index = 1; index <= 10; index += 1) {
      cells[`B${index}`] = String(index);
    }
    cells.C1 = "=SUM(B1:B10)";
    expect(value(cells, "C1")).toBe("55");
  });
});
