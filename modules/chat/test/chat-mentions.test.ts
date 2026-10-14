import { describe, expect, it } from "vitest";
import {
  applyMention,
  detectMentionToken,
  extractMentionNames,
  type MentionCandidate,
  mentionRanges,
  rankMentionCandidates,
  splitMentionSegments,
} from "../src/ui/mentions.ts";

const MEMBERS: MentionCandidate[] = [
  { id: "u1", name: "Alice", email: "alice@example.org" },
  { id: "u2", name: "Bruno", email: "bruno@example.org" },
  { id: "u3", name: "Chloé", email: "chloe@example.org" },
  { id: "u4", name: "Étienne", email: "etienne@example.org" },
  { id: "u5", name: "Aline", email: "aline@example.org" },
];

describe("mentions — détection du jeton", () => {
  it("détecte une mention en cours de frappe", () => {
    const token = detectMentionToken("Bonjour @Al", 11);
    expect(token).toEqual({ query: "Al", start: 8, end: 11 });
  });

  it("accepte le @ en tête de message", () => {
    expect(detectMentionToken("@ch", 3)).toEqual({ query: "ch", start: 0, end: 3 });
  });

  it("couvre le mot entier quand le curseur est au milieu", () => {
    // « @Alice » avec le curseur après « Al » : le remplacement doit remplacer
    // tout le nom déjà tapé, pas seulement ce qui précède le curseur.
    const token = detectMentionToken("@Alice suite", 3);
    expect(token).toEqual({ query: "Al", start: 0, end: 6 });
  });

  it("ferme la mention après une espace ou un signe de ponctuation", () => {
    expect(detectMentionToken("@Alice suite", 7)).toBeNull();
    expect(detectMentionToken("(@Alice)", 7)).toEqual({ query: "Alice", start: 1, end: 7 });
    expect(detectMentionToken("fin. @bruno", 11)).toEqual({ query: "bruno", start: 5, end: 11 });
  });

  it("ignore une adresse électronique", () => {
    expect(detectMentionToken("ecrire a alice@example.org", 25)).toBeNull();
    expect(detectMentionToken("contact@bruno", 13)).toBeNull();
  });

  it("accepte les noms composés et accentués", () => {
    expect(detectMentionToken("@Jean-Pierre", 12)?.query).toBe("Jean-Pierre");
    expect(detectMentionToken("@Etienne", 8)?.query).toBe("Etienne");
  });

  it("refuse un curseur hors du texte", () => {
    expect(detectMentionToken("@al", 99)).toBeNull();
    expect(detectMentionToken("@al", -1)).toBeNull();
  });
});

describe("mentions — classement des candidats", () => {
  it("place les préfixes avant les simples contenances", () => {
    expect(rankMentionCandidates(MEMBERS, "al").map((m) => m.name)).toEqual(["Alice", "Aline"]);
    expect(rankMentionCandidates(MEMBERS, "ali").map((m) => m.name)).toEqual(["Alice", "Aline"]);
  });

  it("ignore la casse et les accents", () => {
    expect(rankMentionCandidates(MEMBERS, "chlo").map((m) => m.name)).toEqual(["Chloé"]);
    expect(rankMentionCandidates(MEMBERS, "etienne").map((m) => m.name)).toEqual(["Étienne"]);
    expect(rankMentionCandidates(MEMBERS, "ETIENNE").map((m) => m.name)).toEqual(["Étienne"]);
  });

  it("renvoie tout le monde, par ordre alphabétique, sans requête", () => {
    expect(rankMentionCandidates(MEMBERS, "").map((m) => m.name)).toEqual([
      "Alice",
      "Aline",
      "Bruno",
      "Chloé",
      "Étienne",
    ]);
  });

  it("borne le nombre de suggestions", () => {
    expect(rankMentionCandidates(MEMBERS, "", 3)).toHaveLength(3);
    expect(rankMentionCandidates(MEMBERS, "", 0)).toHaveLength(0);
  });

  it("ne renvoie rien pour une requête sans correspondance", () => {
    expect(rankMentionCandidates(MEMBERS, "zzz")).toHaveLength(0);
  });
});

describe("mentions — insertion", () => {
  it("remplace le jeton et place le curseur juste après", () => {
    const next = applyMention("Salut @Al, on y va ?", { query: "Al", start: 6, end: 9 }, "Alice");
    expect(next.text).toBe("Salut @Alice, on y va ?");
    expect(next.caret).toBe(12);
  });

  it("ne double pas une espace déjà présente", () => {
    const next = applyMention("pour @bruno et moi", { query: "bruno", start: 5, end: 11 }, "Bruno");
    expect(next.text).toBe("pour @Bruno et moi");
    expect(next.caret).toBe(11);
  });

  it("ajoute une espace en fin de message", () => {
    const next = applyMention("pour @bru", { query: "bru", start: 5, end: 9 }, "Bruno");
    expect(next.text).toBe("pour @Bruno ");
    expect(next.caret).toBe(next.text.length);
  });

  it("laisse le curseur prêt à poursuivre la phrase", () => {
    const next = applyMention("@al", { query: "al", start: 0, end: 3 }, "Alice");
    expect(next.text).toBe("@Alice ");
    expect(next.caret).toBe(next.text.length);
  });
});

describe("mentions — rendu et extraction", () => {
  it("découpe un message en texte et mentions", () => {
    expect(splitMentionSegments("Salut @Alice et @Bruno !")).toEqual([
      { text: "Salut ", mention: false },
      { text: "@Alice", mention: true },
      { text: " et ", mention: false },
      { text: "@Bruno", mention: true },
      { text: " !", mention: false },
    ]);
  });

  it("ne découpe rien sans mention", () => {
    expect(splitMentionSegments("Message simple")).toEqual([
      { text: "Message simple", mention: false },
    ]);
  });

  it("ne mentionne pas une adresse électronique", () => {
    expect(mentionRanges("ecrire a alice@example.org merci")).toEqual([]);
    expect(splitMentionSegments("a@b")).toEqual([{ text: "a@b", mention: false }]);
  });

  it("laisse la ponctuation de fin hors de la mention", () => {
    expect(mentionRanges("pour @Alice, puis @Bruno.")).toEqual([
      [5, 11],
      [18, 24],
    ]);
  });

  it("extrait les noms cités, sans doublon et dans l'ordre", () => {
    expect(extractMentionNames("@Alice a dit à @Bruno puis à @Alice encore")).toEqual([
      "Alice",
      "Bruno",
    ]);
  });

  it("conserve les retours à la ligne dans le texte brut", () => {
    const segments = splitMentionSegments("ligne 1\n@Alice\nligne 3");
    expect(segments.map((segment) => segment.text)).toEqual(["ligne 1\n", "@Alice", "\nligne 3"]);
  });
});
