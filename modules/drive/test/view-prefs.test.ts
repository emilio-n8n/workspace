import { describe, expect, it } from "vitest";
import {
  ariaSortFor,
  compareByKey,
  DENSITIES,
  defaultDirection,
  isDensity,
  isSortDirection,
  isSortKey,
  parseViewPrefs,
  rowPadding,
  SORT_DIRECTIONS,
  SORT_KEYS,
  type SortableEntry,
  serializeViewPrefs,
  sortEntries,
  sortSummary,
  toggleDirection,
  VIEW_PREFS_STORAGE_KEY,
  type ViewPrefs,
} from "../src/ui/view-prefs.ts";

function entry(partial: Partial<SortableEntry> & { name: string }): SortableEntry {
  return {
    kind: "file",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sizeBytes: null,
    ...partial,
  };
}

const NAME_ASC: ViewPrefs = {
  sortKey: "name",
  sortDirection: "asc",
  density: "comfortable",
};

describe("view-prefs — valeurs autorisées", () => {
  it("reconnaît les clés, sens et densités du module", () => {
    expect(SORT_KEYS).toEqual(["name", "date", "size"]);
    expect(SORT_DIRECTIONS).toEqual(["asc", "desc"]);
    expect(DENSITIES).toEqual(["comfortable", "compact"]);

    expect(isSortKey("date")).toBe(true);
    expect(isSortKey("couleur")).toBe(false);
    expect(isSortKey(42)).toBe(false);

    expect(isSortDirection("desc")).toBe(true);
    expect(isSortDirection("up")).toBe(false);

    expect(isDensity("compact")).toBe(true);
    expect(isDensity("dense")).toBe(false);
  });

  it("choisit un sens par défaut adapté à la clé", () => {
    expect(defaultDirection("name")).toBe("asc");
    expect(defaultDirection("date")).toBe("desc");
    expect(defaultDirection("size")).toBe("desc");
  });

  it("inverse le sens du tri", () => {
    expect(toggleDirection("asc")).toBe("desc");
    expect(toggleDirection("desc")).toBe("asc");
  });
});

describe("view-prefs — persistance", () => {
  it("retombe sur les défauts sans donnée enregistrée", () => {
    expect(parseViewPrefs(null)).toEqual(NAME_ASC);
    expect(parseViewPrefs(undefined)).toEqual(NAME_ASC);
    expect(parseViewPrefs("")).toEqual(NAME_ASC);
  });

  it("retombe sur les défauts si le JSON est illisible", () => {
    expect(parseViewPrefs("{pas du json")).toEqual(NAME_ASC);
    expect(parseViewPrefs('"une chaîne"')).toEqual(NAME_ASC);
    expect(parseViewPrefs("[1,2,3]")).toEqual(NAME_ASC);
    expect(parseViewPrefs("null")).toEqual(NAME_ASC);
  });

  it("ignore les champs inconnus ou mal typés", () => {
    expect(parseViewPrefs('{"sortKey":"taille","sortDirection":"haut","density":"géant"}')).toEqual(
      NAME_ASC,
    );
  });

  it("conserve les préférences valides", () => {
    expect(parseViewPrefs('{"sortKey":"size","sortDirection":"asc","density":"compact"}')).toEqual({
      sortKey: "size",
      sortDirection: "asc",
      density: "compact",
    });
  });

  it("complète un sens manquant par le sens naturel de la clé", () => {
    expect(parseViewPrefs('{"sortKey":"date"}')).toEqual({
      ...NAME_ASC,
      sortKey: "date",
      sortDirection: "desc",
    });
  });

  it("fait un aller-retour sans perte", () => {
    const prefs: ViewPrefs = { sortKey: "date", sortDirection: "asc", density: "compact" };
    expect(parseViewPrefs(serializeViewPrefs(prefs))).toEqual(prefs);
  });

  it("utilise une clé de stockage dédiée au Drive", () => {
    expect(VIEW_PREFS_STORAGE_KEY).toBe("workspace.drive.view");
  });
});

describe("view-prefs — tri des entrées", () => {
  const rows = [
    entry({ name: "zèbre", kind: "file", updatedAt: "2026-03-01T00:00:00.000Z", sizeBytes: 300 }),
    entry({ name: "Arbre", kind: "file", updatedAt: "2026-01-01T00:00:00.000Z", sizeBytes: 100 }),
    entry({ name: "Éléphant", kind: "folder", updatedAt: "2026-02-01T00:00:00.000Z" }),
    entry({ name: "banane", kind: "file", updatedAt: "2026-02-01T00:00:00.000Z", sizeBytes: 200 }),
  ];

  it("place toujours les dossiers avant les fichiers", () => {
    for (const key of SORT_KEYS) {
      for (const sortDirection of SORT_DIRECTIONS) {
        const sorted = sortEntries(rows, { sortKey: key, sortDirection });
        expect(sorted[0]?.name).toBe("Éléphant");
      }
    }
  });

  it("trie par nom sans tenir compte des accents ni de la casse", () => {
    expect(sortEntries(rows, NAME_ASC).map((row) => row.name)).toEqual([
      "Éléphant",
      "Arbre",
      "banane",
      "zèbre",
    ]);
  });

  it("inverse l'ordre alphabétique", () => {
    const sorted = sortEntries(rows, { ...NAME_ASC, sortDirection: "desc" });
    expect(sorted.slice(1).map((row) => row.name)).toEqual(["zèbre", "banane", "Arbre"]);
  });

  it("trie par date, du plus récent au plus ancien par défaut", () => {
    const sorted = sortEntries(rows, { sortKey: "date", sortDirection: "desc" });
    expect(sorted.slice(1).map((row) => row.name)).toEqual(["zèbre", "banane", "Arbre"]);
  });

  it("trie par taille, la plus grande d'abord par défaut", () => {
    const sorted = sortEntries(rows, { sortKey: "size", sortDirection: "desc" });
    expect(sorted.slice(1).map((row) => row.sizeBytes)).toEqual([300, 200, 100]);
  });

  it("tranche les égalités dans le sens du tri, pour un ordre stable", () => {
    const tied = [
      entry({ name: "bureau", updatedAt: "2026-05-05T00:00:00.000Z", sizeBytes: 10 }),
      entry({ name: "agenda", updatedAt: "2026-05-05T00:00:00.000Z", sizeBytes: 10 }),
      entry({ name: "cahier", updatedAt: "2026-05-05T00:00:00.000Z", sizeBytes: 10 }),
    ];
    // Date et taille étant égales, le nom tranche — dans le sens demandé.
    expect(
      sortEntries(tied, { sortKey: "date", sortDirection: "desc" }).map((r) => r.name),
    ).toEqual(["cahier", "bureau", "agenda"]);
    expect(sortEntries(tied, { sortKey: "date", sortDirection: "asc" }).map((r) => r.name)).toEqual(
      ["agenda", "bureau", "cahier"],
    );
  });

  it("classe les fichiers sans taille avant les fichiers dimensionnés", () => {
    const withHole = [entry({ name: "a", sizeBytes: 5 }), entry({ name: "b", sizeBytes: null })];
    expect(
      sortEntries(withHole, { sortKey: "size", sortDirection: "asc" }).map((r) => r.name),
    ).toEqual(["b", "a"]);
  });

  it("compare deux entrées selon la clé demandée", () => {
    const old = entry({ name: "a", updatedAt: "2026-01-01T00:00:00.000Z" });
    const recent = entry({ name: "b", updatedAt: "2026-06-01T00:00:00.000Z" });
    expect(compareByKey(old, recent, "date")).toBeLessThan(0);
    expect(compareByKey(recent, old, "date")).toBeGreaterThan(0);
  });

  it("ne modifie pas la liste reçue", () => {
    const input = [entry({ name: "b" }), entry({ name: "a" })];
    const sorted = sortEntries(input, NAME_ASC);
    expect(input.map((row) => row.name)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(input);
  });
});

describe("view-prefs — présentation", () => {
  it("varie le remplissage vertical selon la densité", () => {
    expect(rowPadding("comfortable")).not.toBe(rowPadding("compact"));
  });

  it("décrit le tri en français", () => {
    expect(sortSummary(NAME_ASC)).toBe("Nom, croissant");
    expect(sortSummary({ sortKey: "date", sortDirection: "desc" })).toBe(
      "Date de modification, décroissant",
    );
  });

  it("expose aria-sort seulement sur la colonne qui trie", () => {
    expect(ariaSortFor("name", NAME_ASC)).toBe("ascending");
    expect(ariaSortFor("date", NAME_ASC)).toBe("none");
    expect(ariaSortFor("name", { ...NAME_ASC, sortDirection: "desc" })).toBe("descending");
  });
});
