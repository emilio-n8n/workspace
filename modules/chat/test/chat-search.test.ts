import { describe, expect, it } from "vitest";
import type { MessageView } from "../src/server.ts";
import {
  EMPTY_FILTERS,
  formatResultAnnouncement,
  hasActiveFilters,
  highlightSegments,
  matchesFilters,
  matchRanges,
  resultCounter,
  searchMessages,
  stepIndex,
} from "../src/ui/search.ts";

function message(id: string, body: string, authorId: string): MessageView {
  return {
    id,
    body,
    createdAt: "2026-01-01T10:00:00.000Z",
    authorId,
    authorName: authorId === "u1" ? "Alice" : "Bruno",
    mine: false,
    attachments: [],
  };
}

const BONJOUR = message("m1", "Bonjour à tous", "u1");
const REUNION = message("m2", "réunion déplacée à 15 h", "u2");
const DEPLOIEMENT = message("m3", "Pensez au déploiement de la réunion", "u1");
const OK = message("m4", "ok pour moi", "u2");

const MESSAGES = [BONJOUR, REUNION, DEPLOIEMENT, OK];

describe("recherche — filtres", () => {
  it("ne retient que ce qui correspond", () => {
    expect(matchesFilters(BONJOUR, { query: "bonjour", authorId: null })).toBe(true);
    expect(matchesFilters(BONJOUR, { query: "reunion", authorId: null })).toBe(false);
    expect(matchesFilters(REUNION, { query: "", authorId: "u2" })).toBe(true);
    expect(matchesFilters(REUNION, { query: "", authorId: "u1" })).toBe(false);
  });

  it("ignore la casse et les accents", () => {
    expect(matchesFilters(REUNION, { query: "REUNION", authorId: null })).toBe(true);
    expect(matchesFilters(REUNION, { query: "deplacee", authorId: null })).toBe(true);
    expect(matchesFilters(DEPLOIEMENT, { query: "DEPLOIEMENT", authorId: null })).toBe(true);
  });

  it("cumule le texte et l'auteur", () => {
    const found = searchMessages(MESSAGES, { query: "réunion", authorId: "u2" });
    expect(found.map((m) => m.id)).toEqual(["m2"]);
    expect(searchMessages(MESSAGES, { query: "réunion", authorId: "u1" }).map((m) => m.id)).toEqual(
      ["m3"],
    );
  });

  it("laisse tout passer sans filtre", () => {
    expect(searchMessages(MESSAGES, EMPTY_FILTERS)).toHaveLength(4);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: " " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, authorId: "u1" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "a" })).toBe(true);
  });

  it("renvoie une liste vide quand rien ne correspond", () => {
    expect(searchMessages(MESSAGES, { query: "zzz", authorId: null })).toHaveLength(0);
  });
});

describe("recherche — surlignage", () => {
  it("trouve toutes les occurrences", () => {
    expect(matchRanges("réunion Réunion réunion", "reunion")).toEqual([
      [0, 7],
      [8, 15],
      [16, 23],
    ]);
  });

  it("reporte une correspondance sur le texte accentué d'origine", () => {
    // « reunion » doit surligner « réunion » en entier, accents compris.
    expect(matchRanges("la réunion", "reunion")).toEqual([[3, 10]]);
    expect(matchRanges("Étienne est là", "etienne")).toEqual([[0, 7]]);
  });

  it("consomme chaque correspondance sans chevauchement", () => {
    expect(matchRanges("ab ab ab", "ab")).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
    // Ce qui reste après une occurrence ne suffit plus : rien n'est doublé.
    expect(matchRanges("aaa", "aa")).toEqual([[0, 2]]);
  });

  it("ne renvoie rien sans requête exploitable", () => {
    expect(matchRanges("texte", "")).toEqual([]);
    expect(matchRanges("texte", "   ")).toEqual([]);
  });

  it("découpe le message en texte et correspondances", () => {
    expect(
      highlightSegments("la réunion approche", matchRanges("la réunion approche", "reunion")),
    ).toEqual([
      { text: "la ", match: false },
      { text: "réunion", match: true },
      { text: " approche", match: false },
    ]);
  });

  it("laisse le message intact sans correspondance", () => {
    expect(highlightSegments("rien à signaler", [])).toEqual([
      { text: "rien à signaler", match: false },
    ]);
  });
});

describe("recherche — navigation", () => {
  it("avance et recule en bouclant sur les extrémités", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, -1)).toBe(1);
  });

  it("part du premier résultat quand aucun n'est actif", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it("reste sans cible sans résultat", () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
    expect(stepIndex(0, 0, -1)).toBe(-1);
  });

  it("affiche un compteur 1-indexé, rien sans résultat", () => {
    expect(resultCounter(0, 3)).toBe("1 / 3");
    expect(resultCounter(2, 3)).toBe("3 / 3");
    expect(resultCounter(0, 0)).toBeNull();
  });
});

describe("recherche — annonce", () => {
  it("compte les résultats au singulier et au pluriel", () => {
    expect(formatResultAnnouncement(1, "réunion", null)).toBe("1 message trouvé pour « réunion ».");
    expect(formatResultAnnouncement(4, "réunion", null)).toBe(
      "4 messages trouvés pour « réunion ».",
    );
  });

  it("nomme l'auteur retenu", () => {
    expect(formatResultAnnouncement(2, "réunion", "Bruno")).toBe(
      "2 messages de Bruno trouvés pour « réunion ».",
    );
  });

  it("dit clairement l'absence de résultat", () => {
    expect(formatResultAnnouncement(0, "réunion", null)).toBe(
      "Aucun message ne correspond à « réunion ».",
    );
    expect(formatResultAnnouncement(0, "réunion", "Bruno")).toBe(
      "Aucun message de Bruno ne correspond à « réunion ».",
    );
  });
});
