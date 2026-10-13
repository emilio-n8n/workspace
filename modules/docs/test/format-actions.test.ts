import { describe, expect, it } from "vitest";
import {
  ariaKeyshortcuts,
  ariaModifier,
  FORMAT_ACTIONS,
  MODIFIER_LABELS,
  matchFormatAction,
  shortcutHint,
} from "../src/ui/format-actions.ts";

describe("mise en forme — catalogue", () => {
  it("expose trois actions aux libellés et raccourcis uniques", () => {
    expect(FORMAT_ACTIONS.map((action) => action.id)).toEqual(["bold", "italic", "underline"]);

    const labels = FORMAT_ACTIONS.map((action) => action.label);
    const keys = FORMAT_ACTIONS.map((action) => action.shortcutKey);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("n'accepte que des touches uniques et minuscules (écoute `Mod-<lettre>`)", () => {
    for (const action of FORMAT_ACTIONS) {
      expect(action.shortcutKey).toMatch(/^[a-z]$/);
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.glyph.length).toBeGreaterThan(0);
    }
  });

  it("cohérence barre d'outils ↔ raccourcis : les trois lettres attendues", () => {
    // Ctrl+B gras, Ctrl+I italique, Ctrl+U souligné — barre et clavier d'accord.
    expect(FORMAT_ACTIONS.map((action) => action.shortcutKey).join("")).toBe("biu");
    expect(FORMAT_ACTIONS.map((action) => action.label)).toEqual(["Gras", "Italique", "Souligné"]);
  });
});

describe("mise en forme — raccourcis clavier", () => {
  it("reconnaît Ctrl (Windows/Linux) comme ⌘ (macOS)", () => {
    expect(matchFormatAction({ key: "b", ctrl: true })?.id).toBe("bold");
    expect(matchFormatAction({ key: "i", meta: true })?.id).toBe("italic");
    expect(matchFormatAction({ key: "u", ctrl: true })?.id).toBe("underline");
  });

  it("accepte Maj, comme le fait le raccourci clavier de l'éditeur", () => {
    expect(matchFormatAction({ key: "B", ctrl: true, shift: true })?.id).toBe("bold");
  });

  it("ignore tout ce qui n'est pas Ctrl/⌘ + lettre de mise en forme", () => {
    expect(matchFormatAction({ key: "b" })).toBeNull();
    expect(matchFormatAction({ key: "b", shift: true })).toBeNull();
    expect(matchFormatAction({ key: "z", ctrl: true })).toBeNull();
    expect(matchFormatAction({ key: "b", alt: true, ctrl: true })).toBeNull();
    expect(matchFormatAction({ key: "Enter", ctrl: true })).toBeNull();
    expect(matchFormatAction({ key: "Control", ctrl: true })).toBeNull();
    expect(matchFormatAction({ key: "Dead", ctrl: true })).toBeNull();
    expect(matchFormatAction({ key: " ", ctrl: true })).toBeNull();
  });
});

describe("mise en forme — libellés de raccourcis", () => {
  it("affiche le modificateur de la plateforme", () => {
    expect(shortcutHint("b", MODIFIER_LABELS.default)).toBe("Ctrl+B");
    expect(shortcutHint("u", MODIFIER_LABELS.mac)).toBe("⌘U");
  });

  it("traduit le libellé en préfixe `aria-keyshortcuts`", () => {
    expect(ariaModifier(MODIFIER_LABELS.default)).toBe("Control");
    expect(ariaModifier(MODIFIER_LABELS.mac)).toBe("Meta");
    expect(ariaKeyshortcuts("i", MODIFIER_LABELS.default)).toBe("Control+I");
    expect(ariaKeyshortcuts("i", MODIFIER_LABELS.mac)).toBe("Meta+I");
  });
});
