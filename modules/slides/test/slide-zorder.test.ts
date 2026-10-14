import { describe, expect, it } from "vitest";
import {
  canMoveZ,
  Z_MOVE_ORDER,
  type ZMove,
  zMoveForKey,
  zMoveLabel,
  zOrderAnnouncement,
  zOrderMove,
} from "../src/slide-zorder.ts";

const ITEMS = ["a", "b", "c", "d"];

describe("slides — ordre z", () => {
  it("expose les opérations du fond vers l'avant", () => {
    expect(Z_MOVE_ORDER).toEqual(["back", "backward", "forward", "front"]);
    expect(zMoveLabel("back")).toBe("Arrière-plan");
    expect(zMoveLabel("backward")).toBe("Reculer");
    expect(zMoveLabel("forward")).toBe("Avancer");
    expect(zMoveLabel("front")).toBe("Avant-plan");
  });

  it("signale quelles opérations changent réellement la place", () => {
    expect(canMoveZ(0, "front", 4)).toBe(true);
    expect(canMoveZ(3, "front", 4)).toBe(false);
    expect(canMoveZ(0, "forward", 4)).toBe(true);
    expect(canMoveZ(3, "forward", 4)).toBe(false);
    expect(canMoveZ(0, "back", 4)).toBe(false);
    expect(canMoveZ(3, "back", 4)).toBe(true);
    expect(canMoveZ(0, "backward", 4)).toBe(false);
    expect(canMoveZ(3, "backward", 4)).toBe(true);
    expect(canMoveZ(-1, "front", 4)).toBe(false);
    expect(canMoveZ(9, "front", 4)).toBe(false);
    expect(canMoveZ(0, "forward", 1)).toBe(false);
    expect(canMoveZ(0, "front", 1)).toBe(false);
  });

  it("déplace un élément sans toucher aux autres", () => {
    expect(zOrderMove(ITEMS, 0, "front")).toEqual(["b", "c", "d", "a"]);
    expect(zOrderMove(ITEMS, 3, "back")).toEqual(["d", "a", "b", "c"]);
    expect(zOrderMove(ITEMS, 1, "forward")).toEqual(["a", "c", "b", "d"]);
    expect(zOrderMove(ITEMS, 2, "backward")).toEqual(["a", "c", "b", "d"]);
    // L'original n'est jamais muté.
    expect(ITEMS).toEqual(["a", "b", "c", "d"]);
  });

  it("renvoie une copie inchangée pour un déplacement impossible", () => {
    const copy = zOrderMove(ITEMS, -1, "front");
    expect(copy).toEqual(ITEMS);
    expect(copy).not.toBe(ITEMS);
    expect(zOrderMove(ITEMS, 9, "back")).toEqual(ITEMS);
    expect(zOrderMove(ITEMS, 0, "back")).toEqual(ITEMS);
    expect(zOrderMove(ITEMS, 3, "front")).toEqual(ITEMS);
    expect(zOrderMove(ITEMS, 1.5, "front")).toEqual(ITEMS);
    expect(zOrderMove([], 0, "front")).toEqual([]);
  });

  it("associe les raccourcis clavier aux opérations", () => {
    expect(zMoveForKey({ key: "ArrowUp", ctrlKey: true })).toBe("forward");
    expect(zMoveForKey({ key: "ArrowUp", metaKey: true })).toBe("forward");
    expect(zMoveForKey({ key: "ArrowUp", ctrlKey: true, shiftKey: true })).toBe("front");
    expect(zMoveForKey({ key: "ArrowDown", ctrlKey: true })).toBe("backward");
    expect(zMoveForKey({ key: "ArrowDown", metaKey: true, shiftKey: true })).toBe("back");
    // Sans modificateur, ou avec Alt : la navigation garde la main.
    expect(zMoveForKey({ key: "ArrowUp" })).toBeNull();
    expect(zMoveForKey({ key: "ArrowUp", ctrlKey: true, altKey: true })).toBeNull();
    expect(zMoveForKey({ key: "Enter", ctrlKey: true })).toBeNull();
  });

  it("annonce le changement en français, quel que soit le genre du libellé", () => {
    const cases: Record<ZMove, string> = {
      front: "Élément « Ellipse » placé au premier plan.",
      forward: "Élément « Ellipse » avancé d'un plan.",
      backward: "Élément « Ellipse » reculé d'un plan.",
      back: "Élément « Ellipse » placé à l'arrière-plan.",
    };
    for (const move of Z_MOVE_ORDER) {
      expect(zOrderAnnouncement(move, "Ellipse")).toBe(cases[move]);
    }
  });
});
