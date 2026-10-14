import { describe, expect, it } from "vitest";
import {
  clipboardError,
  copySummary,
  extendSelection,
  inRange,
  isSingleCell,
  MAX_CLIPBOARD_CELLS,
  MAX_PASTE_COLUMNS,
  MAX_PASTE_ROWS,
  parseTsv,
  pasteSummary,
  pasteTargets,
  rangeAddresses,
  rangeCellCount,
  rangeFrom,
  rangeLabel,
  serializeTsv,
  singleRange,
  tsvCell,
} from "../src/range.ts";

/** Lettre de colonne (A, B, … Z, AA) — même règle que la barre de formule. */
function columnLetter(col: number): string {
  let index = col;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (index % 26)) + letters;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return letters;
}

describe("sheets — géométrie de la sélection", () => {
  it("normalise une plage quel que soit le sens du glisser", () => {
    expect(rangeFrom({ row: 5, col: 7 }, { row: 2, col: 3 })).toEqual({
      startRow: 2,
      startCol: 3,
      endRow: 5,
      endCol: 7,
    });
    expect(rangeFrom({ row: 2, col: 3 }, { row: 5, col: 7 })).toEqual(
      rangeFrom({ row: 5, col: 7 }, { row: 2, col: 3 }),
    );
    expect(singleRange({ row: 4, col: 1 })).toEqual({
      startRow: 4,
      startCol: 1,
      endRow: 4,
      endCol: 1,
    });
    expect(isSingleCell(singleRange({ row: 0, col: 0 }))).toBe(true);
    expect(isSingleCell(rangeFrom({ row: 0, col: 0 }, { row: 1, col: 1 }))).toBe(false);
  });

  it("compte les cellules et teste l'appartenance", () => {
    const range = rangeFrom({ row: 1, col: 1 }, { row: 4, col: 3 });
    expect(rangeCellCount(range)).toBe(12);
    expect(inRange(range, 2, 2)).toBe(true);
    expect(inRange(range, 0, 2)).toBe(false);
    expect(inRange(range, 4, 3)).toBe(true);
    expect(inRange(range, 4, 4)).toBe(false);
  });

  it("énumère les adresses ligne par ligne", () => {
    const range = rangeFrom({ row: 2, col: 1 }, { row: 3, col: 2 });
    expect(rangeAddresses(range)).toEqual([
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 1 },
      { row: 3, col: 2 },
    ]);
  });

  it("étend la sélection avec Maj + flèche sans sortir de la grille", () => {
    const anchor = { row: 2, col: 2 };
    // Vers le bas et la droite.
    expect(extendSelection(anchor, anchor, { dRow: 1, dCol: 1 }, { rows: 10, cols: 10 })).toEqual({
      anchor,
      focus: { row: 3, col: 3 },
    });
    // Bornes : on reste sur la dernière ligne et la première colonne.
    expect(
      extendSelection(anchor, { row: 9, col: 0 }, { dRow: 1, dCol: -1 }, { rows: 10, cols: 10 }),
    ).toEqual({ anchor, focus: { row: 9, col: 0 } });
    expect(
      extendSelection(anchor, { row: 0, col: 0 }, { dRow: -1, dCol: -1 }, { rows: 10, cols: 10 }),
    ).toEqual({ anchor, focus: { row: 0, col: 0 } });
  });

  it("nomme la plage sélectionnée", () => {
    expect(rangeLabel(singleRange({ row: 0, col: 0 }), columnLetter)).toBe("A1");
    expect(rangeLabel(rangeFrom({ row: 0, col: 0 }, { row: 2, col: 1 }), columnLetter)).toBe(
      "A1:B3",
    );
    expect(rangeLabel(rangeFrom({ row: 4, col: 25 }, { row: 4, col: 26 }), columnLetter)).toBe(
      "Z5:AA5",
    );
  });
});

describe("sheets — copie TSV", () => {
  it("neutralise l'injection de formule comme l'export CSV", () => {
    expect(tsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(tsvCell("+cmd")).toBe("'+cmd");
    expect(tsvCell("-5")).toBe("'-5");
    expect(tsvCell("@import")).toBe("'@import");
    expect(tsvCell("12")).toBe("12");
  });

  it("aplatit les tabulations et retours à la ligne pour ne pas casser la grille", () => {
    expect(tsvCell("a\tb")).toBe("a b");
    expect(tsvCell("a\nb")).toBe("a b");
    expect(tsvCell("a\r\nb")).toBe("a b");
  });

  it("sérialise une matrice en TSV sans retour final", () => {
    const text = serializeTsv([
      ["Nom", "Quantité"],
      ["Pommes", "3"],
    ]);
    expect(text).toBe("Nom\tQuantité\nPommes\t3");
  });

  it("s'arrête au plafond de cellules pour ne pas saturer la mémoire", () => {
    const rows = [Array.from({ length: 10 }, () => "x"), Array.from({ length: 10 }, () => "y")];
    expect(serializeTsv(rows)).toBe("x\tx\tx\tx\tx\tx\tx\tx\tx\tx\ny\ty\ty\ty\ty\ty\ty\ty\ty\ty");
    expect(serializeTsv(rows, { maxCells: 0 })).toBe("x\tx\tx\tx\tx\tx\tx\tx\tx\tx");
    expect(MAX_CLIPBOARD_CELLS).toBeGreaterThan(0);
  });
});

describe("sheets — collage TSV", () => {
  it("relit lignes et colonnes", () => {
    expect(parseTsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("ignore la ligne vide finale des copieurs de tableur", () => {
    expect(parseTsv("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseTsv("a\tb\n\nc")).toEqual([["a", "b"], ["c"]]);
    expect(parseTsv("")).toEqual([]);
  });

  it("accepte les CRLF et rogne les espaces autour des valeurs", () => {
    expect(parseTsv("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTsv("a \t b ")).toEqual([["a", "b"]]);
  });

  it("borne les lignes et les colonnes collées", () => {
    const tall = Array.from({ length: MAX_PASTE_ROWS + 5 }, () => "x").join("\n");
    expect(parseTsv(tall)).toHaveLength(MAX_PASTE_ROWS);
    const wide = Array.from({ length: MAX_PASTE_COLUMNS + 5 }, () => "y").join("\t");
    expect(parseTsv(wide)[0]).toHaveLength(MAX_PASTE_COLUMNS);
  });

  it("place le collage à la cellule active", () => {
    const targets = pasteTargets(
      [
        ["1", "2"],
        ["3", "4"],
      ],
      { row: 5, col: 5 },
      { rows: 100, cols: 20 },
    );
    expect(targets).toEqual([
      { row: 5, col: 5, value: "1" },
      { row: 5, col: 6, value: "2" },
      { row: 6, col: 5, value: "3" },
      { row: 6, col: 6, value: "4" },
    ]);
  });

  it("ignore les cellules qui dépasseraient la grille", () => {
    const targets = pasteTargets(
      [
        ["1", "2", "3"],
        ["4", "5", "6"],
      ],
      { row: 99, col: 19 },
      { rows: 100, cols: 20 },
    );
    // Seule la première cellule tient ; le reste est ignoré, jamais débordé.
    expect(targets).toEqual([{ row: 99, col: 19, value: "1" }]);
  });

  it("écrit une valeur vide sans la transformer (effacement)", () => {
    expect(pasteTargets([[""]], { row: 0, col: 0 }, { rows: 10, cols: 10 })).toEqual([
      { row: 0, col: 0, value: "" },
    ]);
  });
});

describe("sheets — messages du presse-papiers", () => {
  it("explique un refus du navigateur en français", () => {
    expect(clipboardError("copy", null)).toBe(
      "Copie impossible : le navigateur a refusé l'accès au presse-papiers.",
    );
    expect(clipboardError("paste", new Error("NotAllowedError"))).toContain("NotAllowedError");
    expect(clipboardError("paste", new Error("NotAllowedError"))).toContain("Collage impossible");
  });

  it("accorde au pluriel", () => {
    expect(copySummary(1)).toBe("1 cellule copiée.");
    expect(copySummary(3)).toBe("3 cellules copiées.");
    expect(pasteSummary(1)).toBe("1 cellule collée.");
    expect(pasteSummary(4)).toBe("4 cellules collées.");
  });
});
