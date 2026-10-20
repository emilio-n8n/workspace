import { describe, expect, it } from "vitest";
import { editorShortcut, nudgeStep, type ShortcutKeys } from "../src/slide-shortcuts.ts";

const keys = (key: string, mods: Partial<ShortcutKeys> = {}): ShortcutKeys => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("raccourcis de l'éditeur (PowerPoint)", () => {
  it("Ctrl+D duplique la sélection, ou la diapositive sans sélection", () => {
    expect(editorShortcut(keys("d", { ctrlKey: true }), true)).toEqual({
      kind: "duplicate-selection",
    });
    expect(editorShortcut(keys("d", { ctrlKey: true }), false)).toEqual({
      kind: "duplicate-slide",
    });
    expect(editorShortcut(keys("D", { metaKey: true }), false)).toEqual({
      kind: "duplicate-slide",
    });
  });

  it("Ctrl+M insère une nouvelle diapositive", () => {
    expect(editorShortcut(keys("m", { ctrlKey: true }), false)).toEqual({ kind: "new-slide" });
    expect(editorShortcut(keys("m", { ctrlKey: true }), true)).toEqual({ kind: "new-slide" });
    expect(editorShortcut(keys("m", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });

  it("les flèches déplacent la sélection : 1 %, 5 % avec Maj, 0,1 % avec Alt", () => {
    expect(editorShortcut(keys("ArrowRight"), true)).toEqual({ kind: "nudge", dx: 1, dy: 0 });
    expect(editorShortcut(keys("ArrowUp", { shiftKey: true }), true)).toEqual({
      kind: "nudge",
      dx: 0,
      dy: -5,
    });
    expect(editorShortcut(keys("ArrowLeft", { altKey: true }), true)).toEqual({
      kind: "nudge",
      dx: -0.1,
      dy: 0,
    });
    expect(nudgeStep({ shiftKey: true, altKey: true })).toBe(0.1);
  });

  it("sans sélection, ou avec Ctrl (ordre z), les flèches ne déplacent rien", () => {
    expect(editorShortcut(keys("ArrowDown"), false)).toBeNull();
    expect(editorShortcut(keys("ArrowDown", { ctrlKey: true }), true)).toBeNull();
  });

  it("ignore les autres touches", () => {
    expect(editorShortcut(keys("a"), true)).toBeNull();
    expect(editorShortcut(keys("d"), true)).toBeNull();
    expect(editorShortcut(keys("d", { ctrlKey: true, altKey: true }), true)).toBeNull();
  });
});
