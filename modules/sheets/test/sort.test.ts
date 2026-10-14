import { describe, expect, it } from "vitest";
import {
  compareCells,
  SORT_DIRECTIONS,
  type SortRange,
  sortRange,
  sortScopeLabel,
  sortSummary,
} from "../src/sort.ts";

/** Carte de valeurs d'un onglet : clé « ligne:colonne ». */
function mapOf(values: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(values));
}

const BOUNDS = { rows: 100, cols: 20 };

describe("sheets — comparaison de cellules", () => {
  it("compare les nombres comme des nombres", () => {
    expect(compareCells("2", "10")).toBeLessThan(0);
    expect(compareCells("10", "2")).toBeGreaterThan(0);
    expect(compareCells("2", "2")).toBe(0);
    expect(compareCells("-3", "2.5")).toBeLessThan(0);
  });

  it("compare le texte avec la collation française", () => {
    expect(compareCells("a", "b")).toBeLessThan(0);
    expect(compareCells("École", "ecole")).toBe(0);
    expect(compareCells("pomme", "pommes")).toBeLessThan(0);
  });

  it("garde les cellules vides en dernier, dans les deux sens", () => {
    expect(compareCells("", "1")).toBeGreaterThan(0);
    expect(compareCells("1", "")).toBeLessThan(0);
    expect(compareCells("", "")).toBe(0);
    expect(compareCells("  ", "1")).toBeGreaterThan(0);
  });

  it("mélange nombres et texte sans planter", () => {
    expect(compareCells("abc", "12")).toBeGreaterThan(0);
    expect(compareCells("12", "abc")).toBeLessThan(0);
  });
});

describe("sheets — tri d'une plage", () => {
  const range: SortRange = { startRow: 0, startCol: 0, endRow: 3, endCol: 1 };

  it("trie une colonne et déplace les lignes entières", () => {
    const values = mapOf({
      "0:0": "3",
      "0:1": "c",
      "1:0": "1",
      "1:1": "a",
      "2:0": "2",
      "2:1": "b",
    });
    const result = sortRange({ range, column: 0, direction: "asc", values, bounds: BOUNDS });
    expect(result.changed).toBe(true);
    expect(result.moved).toBe(3);
    expect(result.updates).toEqual(
      expect.arrayContaining([
        { row: 0, col: 0, value: "1" },
        { row: 0, col: 1, value: "a" },
        { row: 1, col: 0, value: "2" },
        { row: 1, col: 1, value: "b" },
        { row: 2, col: 0, value: "3" },
        { row: 2, col: 1, value: "c" },
      ]),
    );
    // Ligne 3, vide : elle ne produit aucune écriture.
    expect(result.updates.some((u) => u.row === 3)).toBe(false);
  });

  it("trie dans l'autre sens à la demande", () => {
    const values = mapOf({
      "0:0": "1",
      "1:0": "3",
      "2:0": "2",
    });
    const result = sortRange({ range, column: 0, direction: "desc", values, bounds: BOUNDS });
    expect(result.updates).toEqual([
      { row: 0, col: 0, value: "3" },
      { row: 1, col: 0, value: "2" },
      { row: 2, col: 0, value: "1" },
    ]);
  });

  it("trie sur la deuxième colonne sans toucher à la première", () => {
    const values = mapOf({
      "0:0": "x",
      "0:1": "2",
      "1:0": "y",
      "1:1": "1",
    });
    const result = sortRange({
      range,
      column: 1,
      direction: "asc",
      values,
      bounds: BOUNDS,
    });
    // Les lignes suivent la colonne 1 : « x » se retrouve en deuxième position.
    expect(result.updates).toEqual([
      { row: 0, col: 0, value: "y" },
      { row: 0, col: 1, value: "1" },
      { row: 1, col: 0, value: "x" },
      { row: 1, col: 1, value: "2" },
    ]);
  });

  it("refuse une colonne hors de la plage", () => {
    const values = mapOf({ "0:0": "2", "1:0": "1" });
    const result = sortRange({ range, column: 5, direction: "asc", values, bounds: BOUNDS });
    expect(result).toEqual({ updates: [], moved: 0, changed: false });
  });

  it("borne la plage aux dimensions de la grille", () => {
    const values = mapOf({ "0:0": "2", "1:0": "1" });
    const result = sortRange({
      range: { startRow: 0, startCol: 0, endRow: 500, endCol: 0 },
      column: 0,
      direction: "asc",
      values,
      bounds: { rows: 100, cols: 20 },
    });
    expect(result.updates).toEqual([
      { row: 0, col: 0, value: "1" },
      { row: 1, col: 0, value: "2" },
    ]);
  });

  it("est stable : des valeurs égales gardent leur ordre", () => {
    const values = mapOf({
      "0:0": "b",
      "1:0": "a",
      "2:0": "a",
    });
    const result = sortRange({ range, column: 0, direction: "asc", values, bounds: BOUNDS });
    // « a » (ligne 1) reste devant « a » (ligne 2) : l'égalité ne réordonne rien.
    expect(result.updates).toEqual([
      { row: 0, col: 0, value: "a" },
      { row: 2, col: 0, value: "b" },
    ]);
  });

  it("ne renvoie rien quand l'ordre est déjà bon", () => {
    const values = mapOf({ "0:0": "1", "1:0": "2", "2:0": "3" });
    const result = sortRange({ range, column: 0, direction: "asc", values, bounds: BOUNDS });
    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
    expect(result.moved).toBe(0);
  });

  it("pousse les cellules vides en dernier", () => {
    const values = mapOf({
      "0:0": "",
      "1:0": "2",
      "2:0": "",
      "3:0": "1",
    });
    const result = sortRange({ range, column: 0, direction: "asc", values, bounds: BOUNDS });
    // Les deux valeurs remontent (lignes 0 et 1) et la ligne 3, vidée, est effacée.
    expect(result.updates).toEqual([
      { row: 0, col: 0, value: "1" },
      { row: 3, col: 0, value: "" },
    ]);
  });
});

describe("sheets — messages du tri", () => {
  it("annonce les lignes déplacées", () => {
    expect(sortSummary(1, "asc")).toBe("Tri croissant : 1 ligne déplacée.");
    expect(sortSummary(3, "asc")).toBe("Tri croissant : 3 lignes déplacées.");
    expect(sortSummary(0, "desc")).toBe("Tri décroissant : 0 ligne déplacée.");
    expect(SORT_DIRECTIONS.asc).toBe("Tri croissant");
  });

  it("résume la plage triée", () => {
    const letter = (col: number) => String.fromCharCode(65 + col);
    expect(sortScopeLabel({ startRow: 0, startCol: 0, endRow: 3, endCol: 1 }, letter)).toBe(
      "A1:B4 — 4 lignes",
    );
    expect(sortScopeLabel({ startRow: 2, startCol: 2, endRow: 4, endCol: 2 }, letter)).toBe(
      "C3:C5 — 3 lignes",
    );
  });
});
