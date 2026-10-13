import { describe, expect, it } from "vitest";
import {
  type Crumb,
  MAX_TRAIL_SEGMENTS,
  overflowLabel,
  ROOT_TRAIL_LABEL,
  SUBFOLDER_MENU_LABEL,
  splitTrail,
  trailLabel,
  trailParts,
} from "../src/ui/breadcrumb.ts";

function crumb(name: string): Crumb {
  return { id: `id-${name.toLowerCase()}`, name };
}

describe("breadcrumb — découpage du fil", () => {
  it("laisse un chemin court entièrement visible", () => {
    const items = ["Racine", "Un", "Deux"];
    expect(splitTrail(items, MAX_TRAIL_SEGMENTS)).toEqual({
      leading: items,
      overflow: [],
      trailing: [],
    });
  });

  it("replie les segments intermédiaires d'un chemin long", () => {
    const items = ["Racine", "Un", "Deux", "Trois", "Quatre"];
    const parts = splitTrail(items, MAX_TRAIL_SEGMENTS);
    expect(parts.leading).toEqual(["Racine"]);
    expect(parts.overflow).toEqual(["Un", "Deux"]);
    expect(parts.trailing).toEqual(["Trois", "Quatre"]);
  });

  it("garde toujours la racine et le dossier courant", () => {
    for (let length = 1; length <= 12; length += 1) {
      const items = Array.from({ length }, (_, index) => `N${index}`);
      const parts = splitTrail(items, MAX_TRAIL_SEGMENTS);
      expect(parts.leading[0]).toBe(items[0]);
      const visible = [...parts.leading, ...parts.trailing];
      expect(visible).toContain(items[items.length - 1]);
      expect(visible.length).toBeLessThanOrEqual(MAX_TRAIL_SEGMENTS);
    }
  });

  it("ne masque rien quand la limite est plus grande que le chemin", () => {
    const items = ["a", "b"];
    expect(splitTrail(items, 10).overflow).toEqual([]);
  });

  it("garde au moins un segment en fin de fil", () => {
    const parts = splitTrail(["a", "b", "c", "d"], 3);
    expect(parts.trailing.length).toBeGreaterThanOrEqual(1);
  });

  it("respecte une limite de deux segments", () => {
    const parts = splitTrail(["a", "b", "c", "d", "e"], 2);
    expect(parts.leading).toEqual(["a"]);
    expect(parts.overflow).toEqual(["b", "c", "d"]);
    expect(parts.trailing).toEqual(["e"]);
  });
});

describe("breadcrumb — fil d'Ariane d'un dossier", () => {
  it("ne rend qu'un dossier courant quand le chemin est vide", () => {
    expect(trailParts([])).toEqual({ leading: [], overflow: [], trailing: [] });
  });

  it("affiche tous les segments quand ils tiennent dans la limite", () => {
    const crumbs = [crumb("Projets"), crumb("2026")];
    const parts = trailParts(crumbs);
    expect(parts.leading).toEqual([crumbs[0]]);
    expect(parts.overflow).toEqual([]);
    expect(parts.trailing).toEqual([crumbs[1]]);
  });

  it("laisse le dossier courant en dernier segment, jamais en lien", () => {
    const crumbs = [crumb("A"), crumb("B"), crumb("C"), crumb("D")];
    const parts = trailParts(crumbs);
    expect(parts.trailing.at(-1)?.name).toBe("D");
    expect(parts.leading).toHaveLength(1);
    expect(parts.overflow.length).toBeGreaterThan(0);
    // Le dossier courant n'apparaît qu'une fois dans le fil.
    const shown = [...parts.leading, ...parts.overflow, ...parts.trailing].map((c) => c.name);
    expect(shown).toEqual(["A", "B", "C", "D"]);
  });

  it("conserve l'ordre du plus haut au plus proche", () => {
    const crumbs = [crumb("Un"), crumb("Deux"), crumb("Trois"), crumb("Quatre")];
    const parts = trailParts(crumbs);
    const shown = [...parts.leading, ...parts.overflow, ...parts.trailing];
    expect(shown.map((c) => c.name)).toEqual(["Un", "Deux", "Trois", "Quatre"]);
  });
});

describe("breadcrumb — libellés", () => {
  it("nomme le chemin complet, racine comprise", () => {
    expect(trailLabel([crumb("Projets"), crumb("2026")])).toBe("Mon Drive / Projets / 2026");
  });

  it("accepte un libellé de racine personnalisé", () => {
    expect(trailLabel([crumb("Projets")], "Mon espace")).toBe("Mon espace / Projets");
  });

  it("révèle une racine seule quand aucun dossier n'est ouvert", () => {
    expect(trailLabel([])).toBe(ROOT_TRAIL_LABEL);
  });

  it("accorde le bouton de débordement au nombre de dossiers masqués", () => {
    expect(overflowLabel(1)).toBe("Afficher 1 dossier masqué");
    expect(overflowLabel(3)).toBe("Afficher 3 dossiers masqués");
    expect(overflowLabel(0)).toBe("Afficher 1 dossier masqué");
  });

  it("nomme le menu des sous-dossiers", () => {
    expect(SUBFOLDER_MENU_LABEL).toBe("Aller à un sous-dossier");
  });
});
