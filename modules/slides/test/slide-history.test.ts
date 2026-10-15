import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  HISTORY_LIMIT,
  redo,
  undo,
} from "../src/slide-history.ts";

describe("slides — historique annuler/rétablir", () => {
  it("part d'un état présent sans passé ni futur", () => {
    const history = createHistory("a");
    expect(history).toEqual({ past: [], present: "a", future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("empile les états et revient en arrière", () => {
    let history = createHistory("a");
    history = commit(history, "b");
    history = commit(history, "c");
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.present).toBe("b");
    expect(canRedo(history)).toBe(true);

    history = undo(history);
    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(false);

    // Annuler sans passé ne change rien.
    expect(undo(history)).toBe(history);
  });

  it("rétablit ce qui vient d'être annulé", () => {
    let history = createHistory(1);
    history = commit(history, 2);
    history = undo(history);
    history = redo(history);
    expect(history.present).toBe(2);
    expect(canRedo(history)).toBe(false);
    // Rétablir sans futur ne change rien.
    expect(redo(history)).toBe(history);
  });

  it("une nouvelle action après un annuler vide la branche « rétablir »", () => {
    let history = createHistory("a");
    history = commit(history, "b");
    history = undo(history);
    history = commit(history, "c");
    expect(history.present).toBe("c");
    expect(canRedo(history)).toBe(false);
    expect(undo(history).present).toBe("a");
  });

  it("ignore un commit identique (rien n'a changé, rien à annuler)", () => {
    const history = createHistory("a");
    expect(commit(history, "a")).toBe(history);
  });

  it("borne la pile : les états les plus anciens sont oubliés", () => {
    let history = createHistory(0);
    for (let value = 1; value <= HISTORY_LIMIT + 20; value += 1) {
      history = commit(history, value);
    }
    expect(history.past.length).toBe(HISTORY_LIMIT);
    // Le plus ancien état conservé est celui qui permet encore 80 retours.
    expect(history.past[0]).toBe(20);
  });
});
