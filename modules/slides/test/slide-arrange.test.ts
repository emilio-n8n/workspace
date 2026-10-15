import { describe, expect, it } from "vitest";
import { alignPatches, distributePatches } from "../src/slide-arrange.ts";

const box = (x: number, y: number, w = 20, h = 10) => ({ x, y, w, h });

describe("slides — disposition d'objets", () => {
  it("aligne un seul élément sur la diapositive", () => {
    const [patch] = alignPatches([{ key: "a", box: box(30, 40) }], "left");
    expect(patch).toEqual({ key: "a", x: 0, y: 40 });
    const [centered] = alignPatches([{ key: "a", box: box(30, 40) }], "hcenter");
    expect(centered).toEqual({ key: "a", x: 40, y: 40 });
    const [right] = alignPatches([{ key: "a", box: box(30, 40) }], "right");
    expect(right).toEqual({ key: "a", x: 80, y: 40 });
  });

  it("aligne plusieurs éléments sur leur boîte englobante", () => {
    const targets = [
      { key: "a", box: box(10, 10, 20, 10) },
      { key: "b", box: box(60, 40, 20, 10) },
    ];
    // Englobante : x 10..80 → aligner à gauche met les deux à 10.
    expect(alignPatches(targets, "left").map((patch) => patch.x)).toEqual([10, 10]);
    // Aligner à droite : x 10..80 → les deux finissent à 60.
    expect(alignPatches(targets, "right").map((patch) => patch.x)).toEqual([60, 60]);
    // Centrer verticalement : boîte englobante y 10..50 (hauteur 40) → y 25.
    expect(alignPatches(targets, "vcenter").map((patch) => patch.y)).toEqual([25, 25]);
  });

  it("borne l'alignement à la diapositive sans changer les tailles", () => {
    const [patch] = alignPatches([{ key: "a", box: box(90, 0, 30, 10) }], "right");
    // Largeur 30 : le bord droit maximal est 100, donc x ≤ 70.
    expect(patch?.x).toBe(70);
  });

  it("répartit les centres des éléments intermédiaires, extrêmes intacts", () => {
    const targets = [
      { key: "a", box: box(0, 0, 10, 10) },
      { key: "b", box: box(20, 0, 10, 10) },
      { key: "c", box: box(60, 0, 10, 10) },
    ];
    const patches = distributePatches(targets, "x");
    // Centres : 5, 25, 65 → le milieu doit venir à 35 → x = 30.
    expect(patches).toEqual([{ key: "b", x: 30, y: 0 }]);
  });

  it("ne répartit pas moins de trois éléments", () => {
    expect(distributePatches([{ key: "a", box: box(0, 0) }], "x")).toEqual([]);
    expect(
      distributePatches(
        [
          { key: "a", box: box(0, 0) },
          { key: "b", box: box(50, 0) },
        ],
        "x",
      ),
    ).toEqual([]);
  });

  it("répartit aussi verticalement", () => {
    const targets = [
      { key: "a", box: box(0, 0, 10, 10) },
      { key: "b", box: box(0, 5, 10, 10) },
      { key: "c", box: box(0, 50, 10, 10) },
    ];
    const [patch] = distributePatches(targets, "y");
    // Centres : 5, 10, 55 → le milieu doit venir à 30 → y = 25.
    expect(patch).toEqual({ key: "b", x: 0, y: 25 });
  });
});
