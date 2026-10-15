import { describe, expect, it } from "vitest";
import { SNAP_THRESHOLD, snapMove, unionBox } from "../src/slide-guides.ts";

describe("slides — guides aimantés", () => {
  it("cale le bord gauche d'une boîte sur la marge de la diapositive", () => {
    const result = snapMove({ x: 0.4, y: 20, w: 30, h: 10 }, []);
    expect(result.x).toBe(0);
    expect(result.guides).toContainEqual({ axis: "x", position: 0 });
  });

  it("cale le centre d'une boîte sur le centre de la diapositive", () => {
    const result = snapMove({ x: 35.6, y: 20, w: 30, h: 10 }, []);
    // Centre proposé : 50.6 % → ramené à 50 %.
    expect(result.x).toBe(35);
    expect(result.guides).toContainEqual({ axis: "x", position: 50 });
  });

  it("s'aimante sur le bord d'un autre élément", () => {
    const others = [{ x: 10, y: 30, w: 20, h: 20 }];
    const result = snapMove({ x: 30.6, y: 5, w: 25, h: 8 }, others);
    // Bord gauche proposé 30.6 → bord droit du voisin (30).
    expect(result.x).toBe(30);
    expect(result.guides).toContainEqual({ axis: "x", position: 30 });
  });

  it("ne bouge pas au-delà de la tolérance, et ne trace aucun repère", () => {
    const result = snapMove({ x: 8, y: 12, w: 20, h: 10 }, []);
    expect(result.x).toBe(8);
    expect(result.y).toBe(12);
    expect(result.guides).toEqual([]);
  });

  it("respecte la tolérance limite", () => {
    const justInside = snapMove({ x: SNAP_THRESHOLD - 0.05, y: 0, w: 10, h: 10 }, []);
    expect(justInside.x).toBe(0);
    const justOutside = snapMove({ x: SNAP_THRESHOLD + 0.05, y: 0, w: 10, h: 10 }, []);
    expect(justOutside.x).toBe(SNAP_THRESHOLD + 0.05);
  });

  it("calcule la boîte englobante d'une sélection", () => {
    const union = unionBox([
      { x: 10, y: 10, w: 20, h: 10 },
      { x: 40, y: 30, w: 10, h: 20 },
    ]);
    expect(union).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(unionBox([])).toBeNull();
  });

  it("aimante la sélection multiple par sa boîte englobante", () => {
    const union = unionBox([
      { x: 19.2, y: 18.6, w: 30, h: 20 },
      { x: 55, y: 40, w: 20, h: 10 },
    ]);
    if (!union) throw new Error("union absente");
    const result = snapMove(union, []);
    // Le bord gauche de l'ensemble (19.2) n'est pas dans la tolérance du
    // bord (0) ; rien ne bouge.
    expect(result.x).toBe(19.2);
  });
});
