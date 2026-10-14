import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_NAME_CHARS,
  isForbiddenNameChar,
  NAME_MAX_LENGTH,
  remainingNameChars,
  validateEntryName,
} from "../src/ui/entry-name.ts";

describe("entry-name — validation", () => {
  it("accepte un nom ordinaire", () => {
    expect(validateEntryName("Projets 2026")).toBeNull();
    expect(validateEntryName("Compte rendu — v2")).toBeNull();
  });

  it("refuse un nom vide ou fait d'espaces", () => {
    expect(validateEntryName("")).toBe("Le nom est obligatoire.");
    expect(validateEntryName("   ")).toBe("Le nom est obligatoire.");
    expect(validateEntryName("\t\n")).toBe("Le nom est obligatoire.");
  });

  it("refuse au-delà de la limite, et l'annonce dans le message", () => {
    const message = validateEntryName("a".repeat(NAME_MAX_LENGTH + 1));
    expect(message).toBe(`Le nom ne peut pas dépasser ${NAME_MAX_LENGTH} caractères.`);
    expect(validateEntryName("a".repeat(NAME_MAX_LENGTH))).toBeNull();
  });

  it("refuse les séparateurs de chemin", () => {
    expect(validateEntryName("a/b")).toContain("/");
    expect(validateEntryName("a\\b")).toContain("\\");
    expect(validateEntryName("dossier/")).not.toBeNull();
  });

  it("refuse les caractères de contrôle", () => {
    expect(validateEntryName("ligne\nautre")).not.toBeNull();
    expect(validateEntryName("avec\ttabulation")).not.toBeNull();
    expect(validateEntryName("zéro\u0000")).not.toBeNull();
  });

  it("accepte les espaces à l'intérieur du nom", () => {
    expect(validateEntryName("  Budget 2026  ")).toBeNull();
  });

  it("laisse passer les accents et signes courants", () => {
    expect(validateEntryName("Éléphant — ça suffit !")).toBeNull();
  });
});

describe("entry-name — caractères interdits", () => {
  it("repère les séparateurs et les contrôles, pas les lettres accentuées", () => {
    expect(FORBIDDEN_NAME_CHARS).toBe("/\\");
    expect(isForbiddenNameChar("/")).toBe(true);
    expect(isForbiddenNameChar("\\")).toBe(true);
    expect(isForbiddenNameChar("\n")).toBe(true);
    expect(isForbiddenNameChar("\u0001")).toBe(true);

    expect(isForbiddenNameChar("a")).toBe(false);
    expect(isForbiddenNameChar("É")).toBe(false);
    expect(isForbiddenNameChar("–")).toBe(false);
    expect(isForbiddenNameChar(" ")).toBe(false);
  });
});

describe("entry-name — compteur de caractères", () => {
  it("décompte ce qui reste avant la limite", () => {
    expect(remainingNameChars("")).toBe(NAME_MAX_LENGTH);
    expect(remainingNameChars("abc")).toBe(NAME_MAX_LENGTH - 3);
  });

  it("ne descend jamais sous zéro", () => {
    expect(remainingNameChars("a".repeat(NAME_MAX_LENGTH + 5))).toBe(0);
  });
});
