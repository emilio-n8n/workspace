import { describe, expect, it } from "vitest";
import {
  deselectId,
  downloadableEntries,
  EMPTY_SELECTION,
  pruneSelection,
  selectAllIds,
  selectionLabel,
  selectRange,
  toggleSelection,
  undownloadableCount,
} from "../src/ui/selection.ts";

const IDS = ["a", "b", "c", "d", "e"];

describe("selection — bascule et retrait", () => {
  it("ajoute puis retire un identifiant", () => {
    const once = toggleSelection(new Set(), "a");
    expect([...once]).toEqual(["a"]);
    expect(toggleSelection(once, "a")).toEqual(new Set());
  });

  it("ne touche pas au reste de la sélection", () => {
    const selected = toggleSelection(toggleSelection(new Set(), "a"), "c");
    expect([...toggleSelection(selected, "a")]).toEqual(["c"]);
  });

  it("retire un seul élément sans casser le lot", () => {
    const selected = new Set(["a", "b", "c"]);
    expect(deselectId(selected, "b")).toEqual(new Set(["a", "c"]));
  });

  it("ne modifie pas la sélection reçue", () => {
    const selected = new Set(["a"]);
    deselectId(selected, "a");
    expect([...selected]).toEqual(["a"]);
  });

  it("part d'une sélection vide", () => {
    expect(EMPTY_SELECTION.ids.size).toBe(0);
    expect(EMPTY_SELECTION.anchorId).toBeNull();
  });
});

describe("selection — plage au clavier", () => {
  it("sélectionne de l'ancrage à la ligne visée, inclus", () => {
    expect([...selectRange("b", "d", IDS)]).toEqual(["b", "c", "d"]);
  });

  it("fonctionne aussi en remontant", () => {
    expect([...selectRange("d", "b", IDS)]).toEqual(["b", "c", "d"]);
  });

  it("ne retient que la ligne visée sans ancrage valide", () => {
    expect([...selectRange(null, "c", IDS)]).toEqual(["c"]);
    expect([...selectRange("zz", "c", IDS)]).toEqual(["c"]);
    expect([...selectRange("b", "zz", IDS)]).toEqual(["zz"]);
  });

  it("borne la plage aux lignes visibles", () => {
    expect([...selectRange("b", "e", IDS)]).toEqual(["b", "c", "d", "e"]);
    expect([...selectRange("a", "a", IDS)]).toEqual(["a"]);
  });
});

describe("selection — tout sélectionner et purge", () => {
  it("sélectionne toutes les lignes visibles", () => {
    expect(selectAllIds(IDS)).toEqual(new Set(IDS));
    expect(selectAllIds([])).toEqual(new Set());
  });

  it("écarte les identifiants qui ne sont plus affichés", () => {
    const surviving = pruneSelection(new Set(["a", "c", "zz"]), IDS);
    expect([...surviving].sort()).toEqual(["a", "c"]);
  });

  it("ne garde rien quand plus aucune ligne n'est visible", () => {
    expect(pruneSelection(new Set(["a", "b"]), [])).toEqual(new Set());
  });

  it("ne modifie pas la sélection reçue", () => {
    const selected = new Set(["a"]);
    pruneSelection(selected, ["b"]);
    expect([...selected]).toEqual(["a"]);
  });
});

describe("selection — libellé accordé", () => {
  it("compte en français", () => {
    expect(selectionLabel(0)).toBe("Aucun élément sélectionné");
    expect(selectionLabel(1)).toBe("1 élément sélectionné");
    expect(selectionLabel(2)).toBe("2 éléments sélectionnés");
    expect(selectionLabel(150)).toBe("150 éléments sélectionnés");
  });
});

describe("selection — fichiers téléchargeables", () => {
  const files = [
    { id: "1", kind: "file" as const, mimeType: "image/png" },
    { id: "2", kind: "folder" as const, mimeType: null },
    { id: "3", kind: "file" as const, mimeType: "application/vnd.workspace.docs+json" },
    { id: "4", kind: "file" as const, mimeType: "application/pdf" },
    { id: "5", kind: "file" as const, mimeType: null },
  ];

  it("ne garde que les fichiers réels", () => {
    expect(downloadableEntries(files).map((file) => file.id)).toEqual(["1", "4", "5"]);
  });

  it("écarte les fichiers ouverts par une autre application", () => {
    const ids = downloadableEntries(files).map((file) => file.id);
    expect(ids).not.toContain("3");
  });

  it("compte les éléments non téléchargeables", () => {
    expect(undownloadableCount(files)).toBe(2);
    expect(undownloadableCount([])).toBe(0);
  });

  it("ne modifie pas la sélection reçue", () => {
    const input = [...files];
    downloadableEntries(input);
    expect(input).toHaveLength(files.length);
  });
});
