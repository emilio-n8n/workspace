import { describe, expect, it } from "vitest";
import {
  conditionTargets,
  conditionValueOptions,
  isConditionSatisfied,
  MAX_CONDITION_VALUE_CHARS,
  normalizeCondition,
  type QuestionCondition,
  visibleQuestions,
} from "../src/conditions.ts";

// ---------------------------------------------------------------------------
// Comparaison d'une réponse à la valeur attendue
// ---------------------------------------------------------------------------

describe("forms — condition d'affichage : comparaison", () => {
  const condition: QuestionCondition = { questionId: "q1", equals: "Oui" };

  it("compare à l'identique une réponse simple", () => {
    expect(isConditionSatisfied(condition, "Oui")).toBe(true);
    expect(isConditionSatisfied(condition, "Non")).toBe(false);
    expect(isConditionSatisfied(condition, "oui")).toBe(false);
  });

  it("se satisfait dès qu'une case cochée correspond", () => {
    expect(isConditionSatisfied(condition, ["Oui", "Autre"])).toBe(true);
    expect(isConditionSatisfied(condition, ["Autre"])).toBe(false);
    expect(isConditionSatisfied(condition, [])).toBe(false);
  });

  it("refuse une réponse absente", () => {
    expect(isConditionSatisfied(condition, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Questions visibles
// ---------------------------------------------------------------------------

const suite = [
  { id: "a", kind: "yes_no" as const },
  { id: "b", kind: "short_text" as const, condition: { questionId: "a", equals: "Oui" } },
  { id: "c", kind: "short_text" as const, condition: { questionId: "b", equals: "x" } },
];

describe("forms — affichage conditionnel simple", () => {
  it("affiche toutes les questions sans condition", () => {
    const plain = [
      { id: "a", kind: "short_text" as const },
      { id: "b", kind: "choice" as const },
    ];
    expect(visibleQuestions(plain, {})).toEqual(plain);
  });

  it("masque une question tant que la condition n'est pas remplie", () => {
    expect(visibleQuestions(suite, {}).map((q) => q.id)).toEqual(["a"]);
    expect(visibleQuestions(suite, { a: "Non" }).map((q) => q.id)).toEqual(["a"]);
    expect(visibleQuestions(suite, { a: "Oui" }).map((q) => q.id)).toEqual(["a", "b"]);
    expect(visibleQuestions(suite, { a: "Oui", b: "x" }).map((q) => q.id)).toEqual(["a", "b", "c"]);
  });

  it("masque en cascade : une question dont le contrôleur est caché disparaît", () => {
    // b est cachée (a sans réponse) : c, qui dépend de b, est cachée aussi.
    expect(visibleQuestions(suite, {}).map((q) => q.id)).not.toContain("c");
  });

  it("laisse visible une question dont le contrôleur a disparu (jamais de perte)", () => {
    const orpheline = [
      { id: "b", kind: "short_text" as const, condition: { questionId: "absent", equals: "x" } },
    ];
    expect(visibleQuestions(orpheline, {}).map((q) => q.id)).toEqual(["b"]);
  });

  it("ne fait pas disparaître une question visant un contrôleur placé après elle", () => {
    const desordre = [
      { id: "b", kind: "short_text" as const, condition: { questionId: "a", equals: "Oui" } },
      { id: "a", kind: "yes_no" as const },
    ];
    expect(visibleQuestions(desordre, {}).map((q) => q.id)).toEqual(["b", "a"]);
  });

  it("ne modifie pas la liste d'origine", () => {
    const source = structuredClone(suite);
    visibleQuestions(source, { a: "Oui" });
    expect(source).toEqual(suite);
  });
});

// ---------------------------------------------------------------------------
// Réglage dans l'éditeur
// ---------------------------------------------------------------------------

describe("forms — condition : cibles et valeurs", () => {
  it("ne propose que les questions antérieures déjà enregistrées", () => {
    const questions = [
      { id: "a", kind: "short_text" as const },
      { kind: "short_text" as const },
      { id: "c", kind: "short_text" as const },
    ];
    expect(conditionTargets(questions, 2).map((q) => q.id)).toEqual(["a"]);
    expect(conditionTargets(questions, 1)).toEqual([]);
    expect(conditionTargets(questions, 0)).toEqual([]);
  });

  it("propose une liste fermée selon le type, ou la saisie libre", () => {
    expect(conditionValueOptions("choice", ["", " Rou ge ", "Bleu", " "])).toEqual([
      "Rou ge",
      "Bleu",
    ]);
    expect(conditionValueOptions("checkbox", ["A", "B"])).toEqual(["A", "B"]);
    expect(conditionValueOptions("scale", [])).toEqual(["1", "2", "3", "4", "5"]);
    expect(conditionValueOptions("yes_no", [])).toEqual(["Oui", "Non"]);
    expect(conditionValueOptions("short_text", [])).toBeNull();
    expect(conditionValueOptions("long_text", [])).toBeNull();
    expect(conditionValueOptions("date", [])).toBeNull();
  });
});

describe("forms — condition : normalisation", () => {
  it("accepte une condition bien formée et nettoie la valeur", () => {
    expect(normalizeCondition({ questionId: "q", equals: "  Oui  " })).toEqual({
      questionId: "q",
      equals: "Oui",
    });
  });

  it("refuse une forme invalide", () => {
    expect(normalizeCondition(null)).toBeNull();
    expect(normalizeCondition("q")).toBeNull();
    expect(normalizeCondition({})).toBeNull();
    expect(normalizeCondition({ questionId: "  ", equals: "Oui" })).toBeNull();
    expect(normalizeCondition({ questionId: "q", equals: "   " })).toBeNull();
    expect(normalizeCondition({ questionId: "q", equals: 3 })).toBeNull();
    expect(
      normalizeCondition({
        questionId: "q",
        equals: "a".repeat(MAX_CONDITION_VALUE_CHARS + 1),
      }),
    ).toBeNull();
  });
});
