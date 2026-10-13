import { describe, expect, it } from "vitest";
import { MAX_ROWS } from "../src/csv.ts";
import {
  checkStructure,
  STRUCTURE_MAX,
  STRUCTURE_MAX_COUNT,
  selectionAfter,
  structureMessage,
} from "../src/structure.ts";

describe("structure — validation des opérations", () => {
  it("accepte une insertion à l'intérieur et à la fin de la grille", () => {
    expect(checkStructure("row", "insert", 0, 1)).toBeNull();
    expect(checkStructure("row", "insert", MAX_ROWS, 1)).toBeNull();
    expect(checkStructure("col", "insert", 0, 1)).toBeNull();
    expect(checkStructure("col", "insert", STRUCTURE_MAX.col, 1)).toBeNull();
  });

  it("refuse un nombre d'éléments absurde", () => {
    expect(checkStructure("row", "insert", 3, 0)).toMatch(/Nombre de lignes à insérer entre 1 et/);
    expect(checkStructure("row", "delete", 3, -2)).toMatch(/Nombre de lignes à supprimer/);
    expect(checkStructure("col", "insert", 3, STRUCTURE_MAX_COUNT + 1)).toMatch(
      /Nombre de colonnes à insérer/,
    );
  });

  it("refuse une position négative ou hors grille", () => {
    expect(checkStructure("row", "insert", -1, 1)).toMatch(/Position de la ligne hors limites/);
    expect(checkStructure("row", "insert", MAX_ROWS + 1, 1)).toMatch(/hors limites/);
    expect(checkStructure("row", "insert", 1.5, 1)).toMatch(/hors limites/);
  });

  it("interdit une suppression qui dépasserait la grille", () => {
    expect(checkStructure("row", "delete", MAX_ROWS - 1, 1)).toBeNull();
    expect(checkStructure("row", "delete", MAX_ROWS - 1, 2)).toMatch(/Suppression impossible/);
    expect(checkStructure("col", "delete", STRUCTURE_MAX.col - 1, 1)).toBeNull();
  });
});

describe("structure — sélection après opération", () => {
  it("décale la sélection lors d'une insertion avant elle", () => {
    expect(selectionAfter("row", "insert", 1, 1, { row: 4, col: 2 })).toEqual({ row: 5, col: 2 });
    expect(selectionAfter("col", "insert", 0, 1, { row: 7, col: 3 })).toEqual({ row: 7, col: 4 });
  });

  it("laisse la sélection en place quand l'insertion est après elle", () => {
    expect(selectionAfter("row", "insert", 9, 1, { row: 2, col: 0 })).toEqual({ row: 2, col: 0 });
  });

  it("laisse la sélection en place quand la suppression est après elle", () => {
    expect(selectionAfter("row", "delete", 8, 1, { row: 2, col: 1 })).toEqual({ row: 2, col: 1 });
    expect(selectionAfter("col", "delete", 8, 3, { row: 0, col: 1 })).toEqual({ row: 0, col: 1 });
  });

  it("remonte la sélection d'un cran quand le bloc supprimé la contient", () => {
    // Ligne 3 supprimée, sélection en ligne 4 → ligne 3.
    expect(selectionAfter("row", "delete", 3, 1, { row: 4, col: 5 })).toEqual({ row: 3, col: 5 });
    // Trois colonnes supprimées à partir de 2, sélection en colonne 4 → colonne 1.
    expect(selectionAfter("col", "delete", 2, 3, { row: 6, col: 4 })).toEqual({ row: 6, col: 1 });
  });

  it("reporte la sélection en dessous quand le bloc commence la feuille", () => {
    // Ligne 0 supprimée : impossible de remonter, on descend d'un cran.
    expect(selectionAfter("row", "delete", 0, 1, { row: 0, col: 0 })).toEqual({ row: 1, col: 0 });
    expect(selectionAfter("row", "delete", 0, 2, { row: 0, col: 4 })).toEqual({ row: 2, col: 4 });
    // Dernière ligne : on ne peut pas descendre, la borne de la grille protège.
    expect(selectionAfter("row", "delete", MAX_ROWS - 1, 1, { row: MAX_ROWS - 1, col: 0 })).toEqual(
      {
        row: MAX_ROWS - 2,
        col: 0,
      },
    );
  });

  it("ne déplace rien sans sélection", () => {
    expect(selectionAfter("row", "insert", 3, 1, null)).toBeNull();
    expect(selectionAfter("col", "delete", 3, 1, null)).toBeNull();
  });
});

describe("structure — messages", () => {
  it("accorde au pluriel", () => {
    expect(structureMessage("row", "insert", 1)).toBe("1 ligne insérée.");
    expect(structureMessage("row", "insert", 2)).toBe("2 lignes insérées.");
    expect(structureMessage("col", "delete", 1)).toBe("1 colonne supprimée.");
    expect(structureMessage("col", "delete", 3)).toBe("3 colonnes supprimées.");
  });
});
