import { describe, expect, it } from "vitest";
import {
  clampMatchIndex,
  collectTextSlices,
  findMatches,
  formatMatchCounter,
  formatNoMatch,
  nextMatchIndex,
  type TextSlice,
  type WalkableNode,
} from "../src/search-text.ts";

// ---------------------------------------------------------------------------
// Doubles de documents ProseMirror : le calcul des positions est le cœur de la
// recherche, il se teste sans navigateur.
// ---------------------------------------------------------------------------

/** Nœud de texte : `nodeSize` = longueur UTF-16, comme dans ProseMirror. */
function texte(value: string): WalkableNode {
  return {
    isText: true,
    text: value,
    nodeSize: value.length,
    descendants: () => undefined,
  };
}

/** Bloc (paragraphe) dont les enfants sont des nœuds de texte. */
function paragraphe(...morceaux: WalkableNode[]): WalkableNode {
  return {
    isText: false,
    nodeSize: 2 + morceaux.reduce((total, morceau) => total + morceau.nodeSize, 0),
    descendants: (visit, offset = 0) => {
      let pos = offset + 1;
      for (const morceau of morceaux) {
        visit(morceau, pos);
        pos += morceau.nodeSize;
      }
    },
  };
}

/** Document complet : les positions démarrent à 1, chaque bloc ajoute 2. */
function document(...blocs: WalkableNode[]): WalkableNode {
  return {
    isText: false,
    nodeSize: 2 + blocs.reduce((total, bloc) => total + bloc.nodeSize, 0),
    descendants: (visit, offset = 0) => {
      let pos = offset + 1;
      for (const bloc of blocs) {
        visit(bloc, pos);
        bloc.descendants(visit, pos);
        pos += bloc.nodeSize;
      }
    },
  };
}

/** Tranches construites à la main, pour tester `findMatches` seul. */
function tranche(text: string, from: number): TextSlice {
  return { text, from, to: from + text.length };
}

describe("recherche — collecte des tranches", () => {
  it("lit une tranche par paragraphe avec ses positions", () => {
    // doc(paragraphe("Bonjour")) : bloc à 1, son texte à 2.
    const slices = collectTextSlices(document(paragraphe(texte("Bonjour"))));
    expect(slices).toEqual([{ text: "Bonjour", from: 2, to: 9 }]);
  });

  it("décale les positions à chaque bloc", () => {
    // Bloc 1 (taille 7) : texte de 2 à 7. Bloc 2 à 8, texte de 9 à 13.
    const slices = collectTextSlices(
      document(paragraphe(texte("Alpha")), paragraphe(texte("Bêta"))),
    );
    expect(slices).toEqual([
      { text: "Alpha", from: 2, to: 7 },
      { text: "Bêta", from: 9, to: 13 },
    ]);
  });

  it("recopie une tranche à travers un changement de style", () => {
    // Deux portions de texte d'un même paragraphe : une seule tranche.
    const slices = collectTextSlices(document(paragraphe(texte("gras "), texte("italique"))));
    expect(slices).toEqual([{ text: "gras italique", from: 2, to: 15 }]);
  });

  it("ferme la dernière tranche du document", () => {
    const slices = collectTextSlices(document(paragraphe(texte("Seul"))));
    expect(slices).toEqual([{ text: "Seul", from: 2, to: 6 }]);
  });

  it("ignore un document sans texte", () => {
    expect(collectTextSlices(document())).toEqual([]);
    expect(collectTextSlices(document(paragraphe()))).toEqual([]);
  });
});

describe("recherche — occurrences", () => {
  it("rend la position d'une occurrence unique", () => {
    expect(findMatches([tranche("Bonjour le monde", 1)], "monde")).toEqual([{ from: 12, to: 17 }]);
  });

  it("rend toutes les occurrences, dans l'ordre", () => {
    // « un deux un trois un » : « un » aux rangs 0, 8 et 17.
    expect(findMatches([tranche("un deux un trois un", 1)], "un")).toEqual([
      { from: 1, to: 3 },
      { from: 9, to: 11 },
      { from: 18, to: 20 },
    ]);
  });

  it("ne rend rien pour une requête vide", () => {
    expect(findMatches([tranche("texte", 1)], "")).toEqual([]);
    expect(findMatches([tranche("texte", 1)], "   ")).toEqual([]);
  });

  it("trouve les occurrences qui se chevauchent", () => {
    // « aa » dans « aaa » : deux occurrences, pas une seule.
    expect(findMatches([tranche("aaa", 1)], "aa")).toEqual([
      { from: 1, to: 3 },
      { from: 2, to: 4 },
    ]);
  });

  it("ignore la casse et les accents", () => {
    expect(findMatches([tranche("Un ÉTÉ à Paris", 1)], "ete")).toEqual([{ from: 4, to: 7 }]);
    expect(findMatches([tranche("Un Été à Paris", 1)], "ÉTÉ")).toEqual([{ from: 4, to: 7 }]);
  });

  it("respecte la casse quand on le demande", () => {
    const options = { caseSensitive: true };
    expect(findMatches([tranche("Un été", 1)], "un", options)).toEqual([]);
    expect(findMatches([tranche("Un été", 1)], "Un", options)).toEqual([{ from: 1, to: 3 }]);
  });

  it("ne joint pas deux paragraphes", () => {
    // « fin » se termine à 4, « début » commence à 7 : aucune occurrence.
    const slices = [tranche("fin", 1), tranche("début", 7)];
    expect(findMatches(slices, "findébut")).toEqual([]);
  });

  it("traverse un changement de style à l'intérieur d'un paragraphe", () => {
    const slices = collectTextSlices(document(paragraphe(texte("Bilan "), texte("annuel"))));
    expect(findMatches(slices, "annuel")).toEqual([{ from: 8, to: 14 }]);
  });

  it("reste aligné sur les accents composés et décomposés", () => {
    // Même mot, deux écritures : les trois unités UTF-16 sont couvertes dans
    // les deux cas, donc l'occurrence a la même étendue.
    expect(findMatches([tranche("Été", 1)], "ete")).toEqual([{ from: 1, to: 4 }]);
    expect(findMatches([tranche("Ete\u0301", 1)], "ete")).toEqual([{ from: 1, to: 4 }]);
  });

  it("place l'occurrence à sa vraie position dans un document réel", () => {
    const slices = collectTextSlices(
      document(paragraphe(texte("Introduction")), paragraphe(texte("Conclusion ici"))),
    );
    // Bloc 1 (taille 14) : texte de 2 à 14. Bloc 2 à 15, texte de 16 à 26.
    expect(findMatches(slices, "Conclusion")).toEqual([{ from: 16, to: 26 }]);
  });
});

describe("recherche — compteur", () => {
  it("compte en base 1 pour les lecteurs d'écran", () => {
    expect(formatMatchCounter(0, 1)).toBe("1 occurrence");
    expect(formatMatchCounter(1, 5)).toBe("Occurrence 2 sur 5");
    expect(formatMatchCounter(4, 5)).toBe("Occurrence 5 sur 5");
  });

  it("annonce l'absence de résultat", () => {
    expect(formatMatchCounter(0, 0)).toBe("Aucune occurrence");
  });

  it("nomme le terme cherché quand rien n'est trouvé", () => {
    expect(formatNoMatch(" bilan ")).toBe("Aucune occurrence pour « bilan »");
    expect(formatNoMatch("   ")).toBe("");
  });

  it("boucle à la fin de la liste", () => {
    expect(nextMatchIndex(4, 5)).toBe(0);
    expect(nextMatchIndex(0, 5, -1)).toBe(4);
    expect(nextMatchIndex(0, 0)).toBe(0);
  });

  it("ramène un index devenu trop grand dans les bornes", () => {
    expect(clampMatchIndex(9, 3)).toBe(2);
    expect(clampMatchIndex(-2, 3)).toBe(0);
    expect(clampMatchIndex(1, 0)).toBe(0);
  });
});
