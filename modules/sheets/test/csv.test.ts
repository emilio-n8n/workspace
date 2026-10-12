import { describe, expect, it } from "vitest";
import { MAX_CELL_CHARS, parseCsv } from "../src/csv.ts";

describe("csv — analyse RFC 4180", () => {
  it("découpe des lignes simples et tolère le saut de ligne final", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    // Une ligne vide compte pour une ligne (cellule vide) — le service les
    // filtre ensuite comme « aucune donnée ».
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("gère les champs cités (virgules et guillemets internes)", () => {
    expect(parseCsv('"Nom, prénom",âge\n"Dupont, Jean",42')).toEqual([
      ["Nom, prénom", "âge"],
      ["Dupont, Jean", "42"],
    ]);
    expect(parseCsv('"a","b"')).toEqual([["a", "b"]]);
  });

  it("échappe les guillemets doublés", () => {
    expect(parseCsv('"Il a dit ""bonjour""",ok')).toEqual([['Il a dit "bonjour"', "ok"]]);
    expect(parseCsv('""""')).toEqual([['"']]);
    expect(parseCsv('a"b,c')).toEqual([['a"b', "c"]]);
  });

  it("conserve les sauts de ligne cités dans une cellule", () => {
    expect(parseCsv('"ligne 1\nligne 2",x')).toEqual([["ligne 1\nligne 2", "x"]]);
    expect(parseCsv('"a\r\nb",c')).toEqual([["a\r\nb", "c"]]);
  });

  it("accepte les fins de ligne CRLF", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("retire le BOM UTF-8 en tête", () => {
    expect(parseCsv("\uFEFFa,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("\uFEFF")).toEqual([]);
  });

  it("ignore les lignes au-delà de maxRows", () => {
    const text = Array.from({ length: 1500 }, (_, index) => `v${index}`).join("\n");
    const parsed = parseCsv(text, { maxRows: 1000 });
    expect(parsed).toHaveLength(1000);
    expect(parsed[0]).toEqual(["v0"]);
    expect(parsed[999]).toEqual(["v999"]);

    // Valeur par défaut : MAX_ROWS (1000).
    expect(parseCsv(text)).toHaveLength(1000);
    expect(parseCsv("a\nb", { maxRows: 1 })).toEqual([["a"]]);
  });

  it("ignore les colonnes au-delà de maxCols", () => {
    const text = Array.from({ length: 150 }, (_, index) => `c${index}`).join(",");
    const parsed = parseCsv(text, { maxCols: 100 });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toHaveLength(100);
    expect(parsed[0]?.[99]).toBe("c99");

    expect(parseCsv(text)).toEqual([text.split(",").slice(0, 100)]);
    expect(parseCsv("a,b,c", { maxCols: 2 })).toEqual([["a", "b"]]);
  });

  it("rejette une cellule de plus de 1000 caractères", () => {
    const long = "x".repeat(MAX_CELL_CHARS + 1);
    expect(() => parseCsv(long)).toThrow("Cellule trop longue (1000 caractères maximum).");
    // Une cellule à la limite exacte passe.
    expect(parseCsv("x".repeat(MAX_CELL_CHARS))).toEqual([["x".repeat(MAX_CELL_CHARS)]]);
  });

  it("conserve une dernière ligne partielle non vide", () => {
    expect(parseCsv("a,b\nc")).toEqual([["a", "b"], ["c"]]);
    // Un champ cité non fermé est quand même restitué en fin de fichier.
    expect(parseCsv('a,"b')).toEqual([["a", "b"]]);
  });
});
