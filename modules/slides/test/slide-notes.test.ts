import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatElapsed,
  MAX_NOTES_CHARS,
  NOTES_EMPTY_HINT,
  notesCounterLabel,
  notesForSave,
  notesRemaining,
  presenterNote,
} from "../src/slide-notes.ts";

/** Espace fine insécable utilisée comme séparateur de milliers. */
const THIN_NBSP = "\u202f";

describe("slides — notes du présentateur", () => {
  it("formate les nombres à la française", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12)).toBe("12");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe(`1${THIN_NBSP}000`);
    expect(formatCount(5000)).toBe(`5${THIN_NBSP}000`);
    expect(formatCount(1_234_567)).toBe(`1${THIN_NBSP}234${THIN_NBSP}567`);
    // Les entrées absurdes ne produisent jamais de NaN dans l'interface.
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(-7)).toBe("0");
    expect(formatCount(12.9)).toBe("12");
  });

  it("affiche un compteur lisible", () => {
    expect(notesCounterLabel("")).toBe(`0 / 5${THIN_NBSP}000 caractères`);
    expect(notesCounterLabel("Parler des prix")).toBe(`15 / 5${THIN_NBSP}000 caractères`);
    expect(notesRemaining("")).toBe(MAX_NOTES_CHARS);
    expect(notesRemaining("a".repeat(4999))).toBe(1);
    expect(notesRemaining("a".repeat(6000))).toBe(0);
  });

  it("normalise les notes à enregistrer", () => {
    expect(notesForSave("  Parler des prix  ")).toBe("Parler des prix");
    expect(notesForSave("   ")).toBeNull();
    expect(notesForSave("")).toBeNull();
    expect(notesForSave(null)).toBeNull();
    expect(notesForSave(undefined)).toBeNull();
    // Une note utile est préservée telle quelle, sauts de ligne compris.
    expect(notesForSave("Ligne 1\nLigne 2")).toBe("Ligne 1\nLigne 2");
  });

  it("distingue une note vide d'une note rédigée", () => {
    expect(presenterNote("  Parler des prix \n")).toEqual({
      text: "Parler des prix",
      empty: false,
    });
    expect(presenterNote("")).toEqual({ text: NOTES_EMPTY_HINT, empty: true });
    expect(presenterNote("  \n ")).toEqual({ text: NOTES_EMPTY_HINT, empty: true });
    expect(presenterNote(null)).toEqual({ text: NOTES_EMPTY_HINT, empty: true });
  });

  it("chronomètre de présentation : mm:ss puis h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(75)).toBe("01:15");
    expect(formatElapsed(600)).toBe("10:00");
    expect(formatElapsed(3599)).toBe("59:59");
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(7385)).toBe("2:03:05");
    expect(formatElapsed(-12)).toBe("00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00");
  });
});
