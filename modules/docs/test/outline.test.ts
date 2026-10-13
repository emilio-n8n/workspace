import { describe, expect, it } from "vitest";
import {
  activeHeadingIndex,
  headingLevel,
  outlineIndentClass,
  outlineLabel,
  outlineTitle,
  stepHeadingIndex,
} from "../src/outline.ts";

const headings = [
  { level: 1, text: "Introduction", pos: 0 },
  { level: 2, text: "Contexte", pos: 42 },
  { level: 3, text: "Détail", pos: 128 },
  { level: 2, text: "Bilan", pos: 260 },
];

describe("plan — niveaux de titres", () => {
  it("borne un niveau StarterKit à 1…6", () => {
    expect(headingLevel(3)).toBe(3);
    expect(headingLevel(0)).toBe(1);
    expect(headingLevel(-2)).toBe(1);
    expect(headingLevel(9)).toBe(6);
  });

  it("retombe sur le niveau 1 pour tout niveau exploitable", () => {
    expect(headingLevel(undefined)).toBe(1);
    expect(headingLevel("2")).toBe(1);
    expect(headingLevel(Number.NaN)).toBe(1);
  });
});

describe("plan — libellés", () => {
  it("normalise les espaces d'un titre", () => {
    expect(outlineTitle("  Bilan   annuel \n")).toBe("Bilan annuel");
  });

  it("reste lisible quand un titre est vide", () => {
    expect(outlineLabel("   ")).toBe("Titre vide");
    expect(outlineLabel("Bilan")).toBe("Bilan");
  });

  it("indente chaque niveau, sans classe Tailwind assemblée", () => {
    expect(outlineIndentClass(1)).toBe("pl-0");
    expect(outlineIndentClass(2)).toBe("pl-3");
    expect(outlineIndentClass(4)).toBe("pl-9");
    expect(outlineIndentClass(9)).toBe("pl-15");
  });
});

describe("plan — position courante", () => {
  it("désigne le dernier titre situé à ou avant la position", () => {
    expect(activeHeadingIndex(headings, 0)).toBe(0);
    expect(activeHeadingIndex(headings, 42)).toBe(1);
    expect(activeHeadingIndex(headings, 300)).toBe(3);
  });

  it("place le curseur dans la section du titre qui le précède", () => {
    expect(activeHeadingIndex(headings, 41)).toBe(0); // encore dans l'introduction
    expect(activeHeadingIndex(headings, 43)).toBe(1); // entré dans le contexte
    expect(activeHeadingIndex(headings, 127)).toBe(1);
    expect(activeHeadingIndex(headings, 129)).toBe(2);
  });

  it("ne désigne rien avant le premier titre", () => {
    expect(activeHeadingIndex([], 12)).toBe(-1);
    expect(activeHeadingIndex(headings, -1)).toBe(-1);
  });
});

describe("plan — navigation clavier", () => {
  it("descend et monte dans la liste sans en sortir", () => {
    expect(stepHeadingIndex(0, 1, 4)).toBe(1);
    expect(stepHeadingIndex(3, 1, 4)).toBe(3);
    expect(stepHeadingIndex(0, -1, 4)).toBe(0);
    expect(stepHeadingIndex(2, -1, 4)).toBe(1);
  });

  it("entre dans la liste sans sélection par le bon bout", () => {
    expect(stepHeadingIndex(-1, 1, 4)).toBe(0);
    expect(stepHeadingIndex(-1, -1, 4)).toBe(3);
  });

  it("reste inerte sur un document sans titre", () => {
    expect(stepHeadingIndex(-1, 1, 0)).toBe(-1);
  });

  it("saute directement à un index cible (Début / Fin)", () => {
    expect(stepHeadingIndex(1, -10, 4)).toBe(0);
    expect(stepHeadingIndex(1, 10, 4)).toBe(3);
  });
});
