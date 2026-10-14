import { describe, expect, it } from "vitest";
import {
  canDragReorder,
  describeMove,
  edgeFromOffset,
  edgeIds,
  handleHint,
  moveIds,
  nudgeIds,
  targetIndexFromHover,
} from "../src/dnd.ts";

/** Réordonnancement au glisser — mêmes règles pour la souris et le clavier. */

const IDS = ["a", "b", "c", "d"];

describe("tasks — glisser : déplacements", () => {
  it("déplace un identifiant et refuse les indices hors bornes", () => {
    expect(moveIds(IDS, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveIds(IDS, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveIds(IDS, 1, 2)).toEqual(["a", "c", "b", "d"]);
    expect(moveIds(IDS, 2, 2)).toEqual(IDS);

    expect(moveIds(IDS, 0, 4)).toBeNull();
    expect(moveIds(IDS, -1, 0)).toBeNull();
    expect(moveIds(IDS, 0.5, 2)).toBeNull();
    expect(moveIds([], 0, 0)).toBeNull();
  });

  it("décale d'un cran (clavier) et va aux extrémités", () => {
    expect(nudgeIds(IDS, 0, 1)).toEqual(["b", "a", "c", "d"]);
    expect(nudgeIds(IDS, 3, -1)).toEqual(["a", "b", "d", "c"]);
    expect(nudgeIds(IDS, 0, -1)).toBeNull();
    expect(nudgeIds(IDS, 3, 1)).toBeNull();

    expect(edgeIds(IDS, 2, "first")).toEqual(["c", "a", "b", "d"]);
    expect(edgeIds(IDS, 1, "last")).toEqual(["a", "c", "d", "b"]);
  });

  it("ne mute pas le tableau d'origine", () => {
    const source = [...IDS];
    moveIds(source, 0, 3);
    nudgeIds(source, 0, 1);
    edgeIds(source, 0, "last");
    expect(source).toEqual(IDS);
  });
});

describe("tasks — glisser : indicateur d'insertion", () => {
  it("place le bord selon la moitié de la ligne", () => {
    expect(edgeFromOffset(10, 40)).toBe("top");
    expect(edgeFromOffset(30, 40)).toBe("bottom");
    // Ligne non mesurée : on retombe sur le bas plutôt que de deviner.
    expect(edgeFromOffset(0, 0)).toBe("bottom");
    expect(edgeFromOffset(0, -1)).toBe("bottom");
  });

  it("traduit le bord en index cible, jamais au-delà de la dernière ligne", () => {
    expect(targetIndexFromHover(1, "top", 4)).toBe(1);
    expect(targetIndexFromHover(1, "bottom", 4)).toBe(2);
    expect(targetIndexFromHover(3, "bottom", 4)).toBe(3);
    expect(targetIndexFromHover(0, "top", 4)).toBe(0);
    expect(targetIndexFromHover(-1, "top", 4)).toBe(-1);
    expect(targetIndexFromHover(9, "top", 4)).toBe(-1);
  });
});

describe("tasks — glisser : disponibilité et annonces", () => {
  it("n'autorise le glisser qu'en ordre manuel et sans regroupement", () => {
    expect(canDragReorder("manual", "none")).toBe(true);
    expect(canDragReorder("due", "none")).toBe(false);
    expect(canDragReorder("manual", "priority")).toBe(false);
    expect(canDragReorder("priority", "due")).toBe(false);
  });

  it("annonce le déplacement en français, pluriel et singulier accordés", () => {
    expect(describeMove({ title: "Relire le dossier", index: 1, total: 4 })).toBe(
      "« Relire le dossier » déplacée en position 2 sur 4.",
    );
    expect(describeMove({ title: "Seule", index: 0, total: 1 })).toBe(
      "« Seule » déplacée en seule ligne.",
    );
    expect(handleHint()).toContain("flèches");
  });
});
