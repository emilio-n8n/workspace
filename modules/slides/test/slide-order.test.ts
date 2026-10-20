import { describe, expect, it } from "vitest";
import {
  canMoveSlide,
  dropIndex,
  filmstripKeyAction,
  filmstripOptionLabel,
  insertionIndex,
  moveTarget,
  reorderAnnouncement,
  reorderSlides,
  type StripItem,
  sorterKeyAction,
} from "../src/slide-order.ts";

/** Bande verticale de 4 vignettes de 60 px, espacées de 8 px, dès 0. */
const STRIP: StripItem[] = [
  { start: 0, size: 60 },
  { start: 68, size: 60 },
  { start: 136, size: 60 },
  { start: 204, size: 60 },
];

describe("slides — réordonnancement", () => {
  it("déplace une diapositive sans toucher aux autres", () => {
    const slides = ["a", "b", "c", "d"];
    expect(reorderSlides(slides, 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(reorderSlides(slides, 0, 3)).toEqual(["b", "c", "d", "a"]);
    // La liste d'origine n'est jamais mutée.
    expect(slides).toEqual(["a", "b", "c", "d"]);
  });

  it("refuse les destinations impossibles ou inutiles", () => {
    const slides = ["a", "b", "c"];
    expect(reorderSlides(slides, 1, 1)).toEqual(["a", "b", "c"]);
    expect(reorderSlides(slides, -1, 2)).toEqual(["a", "b", "c"]);
    expect(reorderSlides(slides, 0, 7)).toEqual(["a", "b", "c"]);
    expect(reorderSlides(slides, 1.5, 2)).toEqual(["a", "b", "c"]);
  });

  it("garde une seule diapositive en place", () => {
    expect(reorderSlides(["seule"], 0, 0)).toEqual(["seule"]);
    expect(reorderSlides([], 0, 1)).toEqual([]);
  });

  it("borne les déplacements d'un cran", () => {
    expect(canMoveSlide(0, -1, 3)).toBe(false);
    expect(canMoveSlide(2, 1, 3)).toBe(false);
    expect(canMoveSlide(1, -1, 3)).toBe(true);
    expect(canMoveSlide(1, 1, 3)).toBe(true);
    expect(canMoveSlide(9, -1, 3)).toBe(false);
    expect(moveTarget(0, 1, 3)).toBe(1);
    expect(moveTarget(2, 1, 3)).toBeNull();
  });
});

describe("slides — glisser-déposer dans la bande", () => {
  it("place l'insertion au milieu des vignettes", () => {
    expect(insertionIndex(STRIP, -20)).toBe(0);
    expect(insertionIndex(STRIP, 10)).toBe(0);
    expect(insertionIndex(STRIP, 50)).toBe(1);
    expect(insertionIndex(STRIP, 150)).toBe(2);
    expect(insertionIndex(STRIP, 999)).toBe(4);
  });

  it("convertit l'emplacement en destination dans la liste privée de la diapositive", () => {
    // Depuis la 2e vignette (index 1) : lâchée sur la 3e, elle prend sa place.
    expect(dropIndex({ from: 1, items: STRIP, pointer: 50 })).toBe(1);
    expect(dropIndex({ from: 1, items: STRIP, pointer: 200 })).toBe(2);
    // Déplacement vers le haut : avant la 1re vignette.
    expect(dropIndex({ from: 1, items: STRIP, pointer: 10 })).toBe(0);
    expect(dropIndex({ from: 1, items: STRIP, pointer: -20 })).toBe(0);
    // Lâchée tout en bas : dernière position.
    expect(dropIndex({ from: 1, items: STRIP, pointer: 999 })).toBe(3);
  });

  it("un dépôt sur place ne déplace rien", () => {
    for (const index of [0, 1, 2, 3]) {
      const middle = STRIP[index] ?? { start: 0, size: 0 };
      expect(
        dropIndex({ from: index, items: STRIP, pointer: middle.start + middle.size / 2 }),
      ).toBe(index);
    }
  });

  it("une bande vide ou une seule vignette ne produit aucun déplacement", () => {
    expect(dropIndex({ from: 0, items: [], pointer: 10 })).toBe(0);
    const single = [{ start: 0, size: 60 }];
    expect(dropIndex({ from: 0, items: single, pointer: 999 })).toBe(0);
  });
});

describe("slides — clavier de la bande de vignettes", () => {
  it("les flèches, Page préc./suiv. et Début/Fin déplacent la sélection", () => {
    expect(filmstripKeyAction({ key: "ArrowDown", current: 1, count: 4 })).toEqual({
      kind: "select",
      index: 2,
    });
    expect(filmstripKeyAction({ key: "ArrowUp", current: 1, count: 4 })).toEqual({
      kind: "select",
      index: 0,
    });
    expect(filmstripKeyAction({ key: "ArrowRight", current: 0, count: 4 })).toEqual({
      kind: "select",
      index: 1,
    });
    expect(filmstripKeyAction({ key: "PageDown", current: 1, count: 4 })).toEqual({
      kind: "select",
      index: 2,
    });
    expect(filmstripKeyAction({ key: "PageUp", current: 2, count: 4 })).toEqual({
      kind: "select",
      index: 1,
    });
    expect(filmstripKeyAction({ key: "Home", current: 3, count: 4 })).toEqual({
      kind: "select",
      index: 0,
    });
    expect(filmstripKeyAction({ key: "End", current: 0, count: 4 })).toEqual({
      kind: "select",
      index: 3,
    });
  });

  it("rien à faire aux extrémités", () => {
    expect(filmstripKeyAction({ key: "ArrowUp", current: 0, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "PageUp", current: 0, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "ArrowDown", current: 3, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "PageDown", current: 3, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "Home", current: 0, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "End", current: 3, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "Enter", current: 1, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "ArrowDown", current: 1, count: 0 })).toBeNull();
  });

  it("Alt + flèches réordonnent la diapositive", () => {
    expect(filmstripKeyAction({ key: "ArrowDown", altKey: true, current: 1, count: 4 })).toEqual({
      kind: "move",
      index: 2,
    });
    expect(filmstripKeyAction({ key: "ArrowUp", altKey: true, current: 1, count: 4 })).toEqual({
      kind: "move",
      index: 0,
    });
    expect(filmstripKeyAction({ key: "ArrowRight", altKey: true, current: 2, count: 4 })).toEqual({
      kind: "move",
      index: 3,
    });
    expect(filmstripKeyAction({ key: "ArrowUp", altKey: true, current: 0, count: 4 })).toBeNull();
    expect(filmstripKeyAction({ key: "End", altKey: true, current: 1, count: 4 })).toBeNull();
  });
});

describe("slides — libellés de la bande", () => {
  it("nomme une vignette par sa position, son titre et son contenu", () => {
    expect(
      filmstripOptionLabel({
        index: 2,
        count: 8,
        title: "Chiffres",
        elementCount: 2,
        hasNotes: true,
      }),
    ).toBe("Diapositive 3 sur 8 : Chiffres — 2 éléments, notes du présentateur");
    expect(
      filmstripOptionLabel({ index: 0, count: 2, title: null, elementCount: 0, hasNotes: false }),
    ).toBe("Diapositive 1 sur 2 : Diapositive 1 — 0 élément");
    expect(
      filmstripOptionLabel({ index: 0, count: 2, title: "  ", elementCount: 1, hasNotes: false }),
    ).toBe("Diapositive 1 sur 2 : Diapositive 1 — 1 élément");
  });

  it("annonce un déplacement avec ses deux positions", () => {
    expect(reorderAnnouncement(0, 3)).toBe("Diapositive 1 déplacée en position 4.");
    expect(reorderAnnouncement(3, 0)).toBe("Diapositive 4 déplacée en position 1.");
  });
});

describe("trieuse : navigation au clavier dans la grille", () => {
  const base = { altKey: false, current: 4, count: 10, columns: 4 };
  it("gauche/droite d'une vignette, haut/bas d'une rangée", () => {
    expect(sorterKeyAction({ ...base, key: "ArrowRight" })).toEqual({ kind: "select", index: 5 });
    expect(sorterKeyAction({ ...base, key: "ArrowLeft" })).toEqual({ kind: "select", index: 3 });
    expect(sorterKeyAction({ ...base, key: "ArrowDown" })).toEqual({ kind: "select", index: 8 });
    expect(sorterKeyAction({ ...base, key: "ArrowUp" })).toEqual({ kind: "select", index: 0 });
  });
  it("borne aux extrémités et ignore un déplacement nul", () => {
    expect(sorterKeyAction({ ...base, current: 8, key: "ArrowDown" })).toEqual({
      kind: "select",
      index: 9,
    });
    expect(sorterKeyAction({ ...base, current: 0, key: "ArrowLeft" })).toBeNull();
    expect(sorterKeyAction({ ...base, key: "Home" })).toEqual({ kind: "select", index: 0 });
    expect(sorterKeyAction({ ...base, key: "End" })).toEqual({ kind: "select", index: 9 });
    expect(sorterKeyAction({ ...base, key: "a" })).toBeNull();
    expect(sorterKeyAction({ ...base, count: 0, key: "ArrowRight" })).toBeNull();
  });
  it("Alt + flèche déplace la diapositive", () => {
    expect(sorterKeyAction({ ...base, altKey: true, key: "ArrowRight" })).toEqual({
      kind: "move",
      index: 5,
    });
  });
});
