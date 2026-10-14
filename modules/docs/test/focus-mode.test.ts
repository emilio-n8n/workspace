import { describe, expect, it } from "vitest";
import {
  FOCUS_MODE_CLASS,
  FOCUS_MODE_KEY,
  type FocusModeStorage,
  loadFocusMode,
  storeFocusMode,
} from "../src/focus-mode.ts";

/** Stockage en mémoire, fidèle à l'interface de `localStorage`. */
function fakeStorage(): FocusModeStorage & { values: Record<string, string> } {
  const values: Record<string, string> = {};
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

/** Stockage qui refuse toute écriture (quota, navigation privée). */
const brokenStorage: FocusModeStorage = {
  getItem: () => {
    throw new Error("accès refusé");
  },
  setItem: () => {
    throw new Error("quota dépassé");
  },
};

describe("mode focus — persistance", () => {
  it("mémorise puis relit l'activation", () => {
    const storage = fakeStorage();
    storeFocusMode(storage, true);
    expect(storage.values[FOCUS_MODE_KEY]).toBe("1");
    expect(loadFocusMode(storage)).toBe(true);
  });

  it("relit l'extinction sans la confondre avec l'activation", () => {
    const storage = fakeStorage();
    storeFocusMode(storage, true);
    storeFocusMode(storage, false);
    expect(storage.values[FOCUS_MODE_KEY]).toBe("0");
    expect(loadFocusMode(storage)).toBe(false);
  });

  it("reste inactif sans préférence enregistrée", () => {
    expect(loadFocusMode(fakeStorage())).toBe(false);
  });

  it("reste inactif face à une valeur corrompue", () => {
    const storage = fakeStorage();
    storage.values[FOCUS_MODE_KEY] = "oui";
    expect(loadFocusMode(storage)).toBe(false);
    storage.values[FOCUS_MODE_KEY] = "";
    expect(loadFocusMode(storage)).toBe(false);
  });

  it("ne s'active jamais sans stockage disponible", () => {
    expect(loadFocusMode(null)).toBe(false);
    expect(loadFocusMode(undefined)).toBe(false);
  });

  it("survit à un stockage qui refuse l'écriture", () => {
    expect(() => storeFocusMode(brokenStorage, true)).not.toThrow();
    expect(loadFocusMode(brokenStorage)).toBe(false);
  });

  it("expose une classe de corps dédiée", () => {
    expect(FOCUS_MODE_CLASS).toBe("workspace-docs-focus");
  });
});
