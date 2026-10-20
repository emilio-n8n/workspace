import { describe, expect, it } from "vitest";
import { extendSeries, fillDirection, fillRange, fillTarget, shiftPasted } from "../src/fill.ts";

const down = { row: 1, col: 0 };

describe("sheets — poignée de recopie", () => {
  it("prolonge une série numérique (pas constant ou tendance)", () => {
    expect(extendSeries(["1", "2"], 3, down)).toEqual(["3", "4", "5"]);
    expect(extendSeries(["10", "8"], 2, down)).toEqual(["6", "4"]);
    expect(extendSeries(["0,1", "0,2"], 2, down)).toEqual(["0.3", "0.4"]);
    expect(extendSeries(["1", "2", "4"], 1, down)).toEqual(["5.33333333333333"]);
  });

  it("recopie un nombre seul, incrémente un texte numéroté", () => {
    expect(extendSeries(["7"], 2, down)).toEqual(["7", "7"]);
    expect(extendSeries(["Lot 1"], 2, down)).toEqual(["Lot 2", "Lot 3"]);
    expect(extendSeries(["T09"], 2, down)).toEqual(["T10", "T11"]);
  });

  it("suit jours et mois en gardant la casse", () => {
    expect(extendSeries(["Lundi"], 3, down)).toEqual(["Mardi", "Mercredi", "Jeudi"]);
    expect(extendSeries(["décembre"], 2, down)).toEqual(["janvier", "février"]);
    expect(extendSeries(["JAN"], 1, down)).toEqual(["JAN"]);
  });

  it("recopie les textes en boucle et décale les formules", () => {
    expect(extendSeries(["a", "b"], 3, down)).toEqual(["a", "b", "a"]);
    expect(extendSeries(["=A1*2"], 2, down)).toEqual(["=A2*2", "=A3*2"]);
    expect(extendSeries(["=$A$1+B1"], 1, { row: 0, col: 1 })).toEqual(["=$A$1+C1"]);
  });

  it("calcule direction et cible du glisser", () => {
    const source = { startRow: 0, endRow: 1, startCol: 0, endCol: 0 };
    expect(fillTarget(source, 4, 0)).toEqual({ ...source, endRow: 4 });
    expect(fillTarget(source, 1, 3)).toEqual({ ...source, endCol: 3 });
    expect(fillTarget(source, 0, 0)).toEqual(source);
    expect(fillDirection(source, { ...source, endRow: 4 })).toBe("down");
    expect(fillDirection(source, { ...source, startCol: 0, endCol: 2 })).toBe("right");
    expect(fillDirection(source, source)).toBeNull();
  });

  it("produit les mises à jour vers le bas, la droite et le haut", () => {
    const values = new Map([
      ["0:0", "1"],
      ["1:0", "2"],
      ["0:1", "=A1+1"],
      ["1:1", "=A2+1"],
    ]);
    const source = { startRow: 0, endRow: 1, startCol: 0, endCol: 1 };
    expect(fillRange(source, { ...source, endRow: 3 }, values)).toEqual([
      { row: 2, col: 0, value: "3" },
      { row: 3, col: 0, value: "4" },
      { row: 2, col: 1, value: "=A3+1" },
      { row: 3, col: 1, value: "=A4+1" },
    ]);
    const up = fillRange(
      { startRow: 2, endRow: 3, startCol: 0, endCol: 0 },
      { startRow: 0, endRow: 3, startCol: 0, endCol: 0 },
      new Map([
        ["2:0", "3"],
        ["3:0", "4"],
      ]),
    );
    expect(up).toEqual([
      { row: 1, col: 0, value: "2" },
      { row: 0, col: 0, value: "1" },
    ]);
  });

  it("décale les formules collées", () => {
    expect(shiftPasted([["=A1", "texte"]], 2, 1)).toEqual([["=B3", "texte"]]);
  });
});
