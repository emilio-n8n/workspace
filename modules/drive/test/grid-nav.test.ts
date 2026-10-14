import { describe, expect, it } from "vitest";
import {
  clampCursor,
  cursorAnnouncement,
  GRID_PAGE_SIZE,
  gridActionForKey,
  listAnnouncement,
} from "../src/ui/grid-nav.ts";

const ROWS = 12;

describe("grid-nav — déplacement vertical", () => {
  it("descend et monte d'une ligne", () => {
    expect(gridActionForKey("ArrowDown", 0, ROWS)).toEqual({ kind: "move", index: 1 });
    expect(gridActionForKey("ArrowUp", 1, ROWS)).toEqual({ kind: "move", index: 0 });
  });

  it("borne en haut et en bas de la liste", () => {
    expect(gridActionForKey("ArrowUp", 0, ROWS)).toEqual({ kind: "move", index: 0 });
    expect(gridActionForKey("ArrowDown", ROWS - 1, ROWS)).toEqual({
      kind: "move",
      index: ROWS - 1,
    });
  });

  it("pose le curseur sur la première ligne sans curseur initial", () => {
    expect(gridActionForKey("ArrowDown", null, ROWS)).toEqual({ kind: "move", index: 0 });
    expect(gridActionForKey("ArrowUp", null, ROWS)).toEqual({ kind: "move", index: ROWS - 1 });
  });

  it("saute d'une page entière", () => {
    expect(gridActionForKey("PageDown", 0, ROWS)).toEqual({ kind: "move", index: GRID_PAGE_SIZE });
    expect(gridActionForKey("PageUp", 11, ROWS)).toEqual({ kind: "move", index: 1 });
  });

  it("borne les sauts de page", () => {
    expect(gridActionForKey("PageDown", 8, ROWS)).toEqual({ kind: "move", index: 11 });
    expect(gridActionForKey("PageUp", 3, ROWS)).toEqual({ kind: "move", index: 0 });
  });

  it("va à la première et à la dernière ligne", () => {
    expect(gridActionForKey("Home", 7, ROWS)).toEqual({ kind: "move", index: 0 });
    expect(gridActionForKey("End", 7, ROWS)).toEqual({ kind: "move", index: ROWS - 1 });
  });
});

describe("grid-nav — actions sur la ligne courante", () => {
  it("ouvre avec la flèche droite et avec Entrée", () => {
    expect(gridActionForKey("ArrowRight", 3, ROWS)).toEqual({ kind: "open" });
    expect(gridActionForKey("Enter", 3, ROWS)).toEqual({ kind: "open" });
  });

  it("remonte au dossier parent avec la flèche gauche", () => {
    expect(gridActionForKey("ArrowLeft", 3, ROWS)).toEqual({ kind: "parent" });
  });

  it("bascule la sélection avec Espace", () => {
    expect(gridActionForKey(" ", 3, ROWS)).toEqual({ kind: "toggle" });
    // `Spacebar` est la valeur historique, encore rendue par de vieux navigateurs.
    expect(gridActionForKey("Spacebar", 3, ROWS)).toEqual({ kind: "toggle" });
  });

  it("ne fait rien quand aucune ligne n'est focalisée", () => {
    expect(gridActionForKey("ArrowRight", null, ROWS)).toBeNull();
    expect(gridActionForKey("ArrowLeft", null, ROWS)).toBeNull();
  });

  it("ne bouge pas sur une liste vide", () => {
    expect(gridActionForKey("ArrowDown", null, 0)).toBeNull();
    expect(gridActionForKey("Home", null, 0)).toBeNull();
    expect(gridActionForKey("Enter", null, 0)).toBeNull();
  });

  it("ignore les touches qui ne concernent pas la liste", () => {
    expect(gridActionForKey("a", 3, ROWS)).toBeNull();
    expect(gridActionForKey("Escape", 3, ROWS)).toBeNull();
    expect(gridActionForKey("Tab", 3, ROWS)).toBeNull();
  });
});

describe("grid-nav — bornes du curseur", () => {
  it("laisse un curseur absent absent", () => {
    expect(clampCursor(null, ROWS)).toBeNull();
    expect(clampCursor(3, 0)).toBeNull();
    expect(clampCursor(3, -1)).toBeNull();
  });

  it("rafraîchit un curseur devenu hors bornes", () => {
    expect(clampCursor(20, ROWS)).toBe(ROWS - 1);
    expect(clampCursor(-4, ROWS)).toBe(0);
    expect(clampCursor(5, ROWS)).toBe(5);
  });
});

describe("grid-nav — annonces", () => {
  const target = { name: "notes.txt", kind: "file" as const, selected: false };

  it("annonce la position, le type et le nom", () => {
    expect(cursorAnnouncement(target, 2, ROWS)).toBe("Élément 3 sur 12 : Fichier notes.txt");
  });

  it("annonce le dossier et la sélection", () => {
    expect(cursorAnnouncement({ name: "Projets", kind: "folder", selected: true }, 0, 1)).toBe(
      "Élément 1 sur 1 : Dossier Projets, sélectionné",
    );
  });

  it("reste muet sans cible ou sans lignes", () => {
    expect(cursorAnnouncement(null, 0, ROWS)).toBe("");
    expect(cursorAnnouncement(target, 0, 0)).toBe("");
  });

  it("annonce la liste et son tri", () => {
    expect(listAnnouncement(1, "Nom, croissant")).toBe(
      "1 élément à parcourir, triés par Nom, croissant.",
    );
    expect(listAnnouncement(12, "Taille, décroissant")).toBe(
      "12 éléments à parcourir, triés par Taille, décroissant.",
    );
  });

  it("annonce une liste vide", () => {
    expect(listAnnouncement(0, "Nom, croissant")).toBe("Aucun élément à parcourir.");
  });
});
