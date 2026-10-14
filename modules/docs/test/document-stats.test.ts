import { describe, expect, it } from "vitest";
import {
  countCharacters,
  countCharactersWithoutSpaces,
  countWords,
  documentStats,
  formatReadingTime,
  formatStats,
  readingMinutes,
} from "../src/document-stats.ts";

describe("statistiques — mots", () => {
  it("compte les mots d'un texte simple", () => {
    expect(countWords("Un texte gras et italique")).toBe(5);
  });

  it("aplatit les espaces multiples et les retours à la ligne", () => {
    expect(countWords("  Bilan\n\n  annuel   corrigé  ")).toBe(3);
  });

  it("ne compte rien pour un texte vide ou blanc", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("garde la ponctuation collée dans un seul mot", () => {
    // Convention des traitements de texte : « l'été » et « 42. » sont un mot.
    expect(countWords("l'été 42. oui")).toBe(3);
  });
});

describe("statistiques — caractères", () => {
  it("compte tout, espaces comprises", () => {
    // « Paul & fils » : P-a-u-l-espace-&-espace-f-i-l-s
    expect(countCharacters("Paul & fils")).toBe(11);
  });

  it("compte hors espaces, tabulations et retours à la ligne écartés", () => {
    // « Paul & fils\n\tsuite » : 18 caractères dont 4 blancs → 14.
    expect(countCharactersWithoutSpaces("Paul & fils\n\tsuite")).toBe(14);
    expect(countCharactersWithoutSpaces("  ")).toBe(0);
  });
});

describe("statistiques — temps de lecture", () => {
  it("reste à zéro pour un document vide", () => {
    expect(readingMinutes(0)).toBe(0);
  });

  it("annonce au moins une minute dès le premier mot", () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(199)).toBe(1);
  });

  it("arrondit à la minute supérieure", () => {
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(900)).toBe(5);
  });

  it("ignore un compteur de mots négatif (données corrompues)", () => {
    expect(readingMinutes(-12)).toBe(0);
  });
});

describe("statistiques — document complet", () => {
  it("croise les trois compteurs", () => {
    // « Un texte gras et italique » : 25 caractères, dont 4 espaces.
    const stats = documentStats("Un texte gras et italique");
    expect(stats.words).toBe(5);
    expect(stats.characters).toBe(25);
    expect(stats.charactersWithoutSpaces).toBe(21);
    expect(stats.readingMinutes).toBe(1);
  });

  it("reste cohérent sur un document vide", () => {
    expect(documentStats("")).toEqual({
      words: 0,
      characters: 0,
      charactersWithoutSpaces: 0,
      readingMinutes: 0,
    });
  });
});

describe("statistiques — libellés français", () => {
  it("accorde le temps de lecture", () => {
    expect(formatReadingTime(0)).toBe("aucune lecture");
    expect(formatReadingTime(1)).toBe("1 min de lecture");
    expect(formatReadingTime(4)).toBe("4 min de lecture");
  });

  it("accorde mots et caractères au singulier", () => {
    expect(formatStats(documentStats("Bonjour"))).toBe("1 mot · 7 caractères · 1 min de lecture");
  });

  it("accorde mots et caractères au pluriel", () => {
    // 40 mots de 3 lettres + 39 espaces = 159 caractères.
    const texte = Array.from({ length: 40 }, () => "mot").join(" ");
    expect(formatStats(documentStats(texte))).toBe("40 mots · 159 caractères · 1 min de lecture");
  });
});
