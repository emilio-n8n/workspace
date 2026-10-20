import { describe, expect, it } from "vitest";
import { jumpTarget, selectionStats } from "../src/range.ts";

/** Grille « ligne:colonne » → valeur, à partir d'une liste de cellules pleines. */
function grid(cells: Array<[number, number, string]>): Map<string, string> {
  return new Map(cells.map(([row, col, value]) => [`${row}:${col}`, value]));
}

const bounds = { rows: 100, cols: 26 };

describe("jumpTarget (Ctrl + flèche, comme Excel)", () => {
  it("dans un bloc plein, va à la dernière cellule pleine du bloc", () => {
    const values = grid([
      [0, 0, "1"],
      [1, 0, "2"],
      [2, 0, "3"],
      [5, 0, "9"],
    ]);
    expect(jumpTarget(values, { row: 0, col: 0 }, [1, 0], bounds)).toEqual({ row: 2, col: 0 });
  });

  it("depuis le bord d'un bloc, saute à la prochaine cellule pleine", () => {
    const values = grid([
      [2, 0, "3"],
      [5, 0, "9"],
    ]);
    expect(jumpTarget(values, { row: 2, col: 0 }, [1, 0], bounds)).toEqual({ row: 5, col: 0 });
  });

  it("depuis une cellule vide, va à la prochaine cellule pleine", () => {
    const values = grid([[0, 7, "x"]]);
    expect(jumpTarget(values, { row: 0, col: 0 }, [0, 1], bounds)).toEqual({ row: 0, col: 7 });
  });

  it("sans cellule pleine plus loin, s'arrête au bord de la feuille", () => {
    expect(jumpTarget(grid([]), { row: 3, col: 2 }, [1, 0], bounds)).toEqual({
      row: 99,
      col: 2,
    });
    expect(jumpTarget(grid([]), { row: 3, col: 2 }, [0, -1], bounds)).toEqual({
      row: 3,
      col: 0,
    });
  });

  it("déjà au bord, ne bouge pas", () => {
    expect(jumpTarget(grid([]), { row: 0, col: 0 }, [-1, 0], bounds)).toEqual({
      row: 0,
      col: 0,
    });
    expect(jumpTarget(grid([]), { row: 0, col: 25 }, [0, 1], bounds)).toEqual({
      row: 0,
      col: 25,
    });
  });

  it("une chaîne vide compte comme une cellule vide", () => {
    const values = grid([
      [0, 0, "a"],
      [1, 0, ""],
      [4, 0, "b"],
    ]);
    expect(jumpTarget(values, { row: 0, col: 0 }, [1, 0], bounds)).toEqual({ row: 4, col: 0 });
  });

  it("remonte vers le haut jusqu'au début du bloc", () => {
    const values = grid([
      [3, 1, "a"],
      [4, 1, "b"],
      [5, 1, "c"],
    ]);
    expect(jumpTarget(values, { row: 5, col: 1 }, [-1, 0], bounds)).toEqual({ row: 3, col: 1 });
  });
});

describe("selectionStats (barre d'état)", () => {
  it("renvoie null pour moins de deux cellules pleines", () => {
    expect(selectionStats([], 0)).toBeNull();
    expect(selectionStats([5], 1)).toBeNull();
  });

  it("calcule somme, moyenne et nombres", () => {
    expect(selectionStats([10, 20, 30], 3)).toEqual({
      sum: 60,
      average: 20,
      count: 3,
      numeric: 3,
    });
  });

  it("compte le texte dans « nombre » mais pas dans la moyenne", () => {
    expect(selectionStats([10, 30], 4)).toEqual({ sum: 40, average: 20, count: 4, numeric: 2 });
  });

  it("sans valeur numérique, moyenne null et somme nulle", () => {
    expect(selectionStats([], 3)).toEqual({ sum: 0, average: null, count: 3, numeric: 0 });
  });

  it("gère les négatifs et décimaux", () => {
    const stats = selectionStats([-1.5, 2.5], 2);
    expect(stats?.sum).toBe(1);
    expect(stats?.average).toBe(0.5);
  });
});
