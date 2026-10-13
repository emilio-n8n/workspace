import { describe, expect, it } from "vitest";
import {
  DATE_PATTERN,
  duplicateQuestion,
  FORM_KINDS,
  insertQuestion,
  isCalendarDate,
  KIND_HINTS,
  KIND_LABELS,
  kindHasOptions,
  MAX_ANSWER_CHARS,
  moveQuestion,
  removeQuestion,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_VALUES,
  validateAnswer,
  YES_NO_OPTIONS,
} from "../src/questions.ts";

// ---------------------------------------------------------------------------
// Types de questions
// ---------------------------------------------------------------------------

describe("forms — types de questions", () => {
  it("expose texte, choix, échelle, date et oui/non", () => {
    expect(FORM_KINDS).toEqual([
      "short_text",
      "long_text",
      "choice",
      "checkbox",
      "scale",
      "date",
      "yes_no",
    ]);
  });

  it("nomme chaque type en français, sans libellé vide", () => {
    for (const kind of FORM_KINDS) {
      expect(KIND_LABELS[kind]).toBeTruthy();
      expect(KIND_LABELS[kind]).not.toMatch(/_/);
      expect(KIND_HINTS[kind]).toBeTruthy();
    }
    expect(KIND_LABELS.date).toBe("Date");
    expect(KIND_LABELS.yes_no).toBe("Oui / Non");
  });

  it("ne demande des options qu'aux choix et cases à cocher", () => {
    expect(kindHasOptions("choice")).toBe(true);
    expect(kindHasOptions("checkbox")).toBe(true);
    for (const kind of ["short_text", "long_text", "scale", "date", "yes_no"] as const) {
      expect(kindHasOptions(kind)).toBe(false);
    }
  });

  it("expose une échelle de 1 à 5, croissante", () => {
    expect([SCALE_MIN, SCALE_MAX]).toEqual([1, 5]);
    expect(SCALE_VALUES).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("ferme les réponses possibles d'une question oui/non", () => {
    expect(YES_NO_OPTIONS).toEqual(["Oui", "Non"]);
  });
});

// ---------------------------------------------------------------------------
// Dates du calendrier
// ---------------------------------------------------------------------------

describe("forms — validation des dates", () => {
  it("accepte AAAA-MM-JJ", () => {
    expect(isCalendarDate("2026-10-13")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("0001-01-01")).toBe(true);
  });

  it("refuse ce que `new Date()` accepterait en décalant", () => {
    // 2026 n'est pas bissextile : `new Date("2026-02-29")` donne le 1er mars.
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-06-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-01-00")).toBe(false);
    expect(isCalendarDate("0000-01-01")).toBe(false);
  });

  it("refuse les formats voisins", () => {
    expect(DATE_PATTERN.test("2026-1-1")).toBe(false);
    for (const value of [
      "13/10/2026",
      "2026/10/13",
      "13-10-2026",
      "2026-10-13T00:00:00.000Z",
      " 2026-10-13",
      "2026-10-13 ",
      "hier",
      "",
    ]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Réponses acceptées par type
// ---------------------------------------------------------------------------

function answer(kind: Parameters<typeof validateAnswer>[0]["kind"], raw: unknown) {
  return validateAnswer(
    { kind, label: "Question", required: false, options: ["Rouge", "Bleu"] },
    raw,
  );
}

describe("forms — validation des réponses", () => {
  it("garde la date si elle est valide, avec un message parlable sinon", () => {
    expect(answer("date", "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(answer("date", " 2026-02-28 ")).toEqual({ ok: true, value: "2026-02-28" });
    const refus = answer("date", "2026-02-30");
    expect(refus.ok).toBe(false);
    expect(refus.ok === false && refus.message).toBe(
      "« Question » attend une date valide au format JJ/MM/AAAA.",
    );
  });

  it("n'accepte pour le oui/non que « Oui » ou « Non »", () => {
    expect(answer("yes_no", "Oui")).toEqual({ ok: true, value: "Oui" });
    expect(answer("yes_no", "Non")).toEqual({ ok: true, value: "Non" });
    expect(answer("yes_no", "oui").ok).toBe(false);
    expect(answer("yes_no", "Peut-être").ok).toBe(false);
    const refus = answer("yes_no", "Peut-être");
    expect(refus.ok === false && refus.message).toBe(
      "« Question » attend la réponse « Oui » ou « Non ».",
    );
  });

  it("oblige les champs obligatoires, sans coercition", () => {
    const answerVide = validateAnswer(
      { kind: "date", label: "Naissance", required: true, options: [] },
      "",
    );
    expect(answerVide).toEqual({ ok: false, message: "« Naissance » est obligatoire." });

    const answerAbsente = validateAnswer(
      { kind: "yes_no", label: "Abonnement", required: true, options: [] },
      undefined,
    );
    expect(answerAbsente).toEqual({ ok: false, message: "« Abonnement » est obligatoire." });

    // Facultatif et vide : pas de valeur enregistrée, pas d'erreur.
    expect(answer("date", "")).toEqual({ ok: true, value: undefined });
    expect(answer("yes_no", "")).toEqual({ ok: true, value: undefined });
  });

  it("conserve le comportement des types existants", () => {
    expect(answer("short_text", "  Alice  ")).toEqual({ ok: true, value: "Alice" });
    expect(answer("choice", "Bleu")).toEqual({ ok: true, value: "Bleu" });
    expect(answer("choice", "Vert").ok).toBe(false);
    expect(answer("scale", "3")).toEqual({ ok: true, value: "3" });
    for (const value of ["0x3", "1e0", " 3 ", "3.0", "03"]) {
      expect(answer("scale", value).ok).toBe(false);
    }
    expect(
      validateAnswer(
        { kind: "checkbox", label: "Sports", required: true, options: ["Foot", "Tennis"] },
        ["Tennis", "Tennis", " Foot "],
      ),
    ).toEqual({ ok: true, value: ["Tennis", "Foot"] });
  });

  it("refuse une réponse libre trop longue", () => {
    const longue = "a".repeat(MAX_ANSWER_CHARS + 1);
    const outcome = answer("long_text", longue);
    expect(outcome).toEqual({ ok: false, message: "Réponse trop longue pour « Question »." });
  });
});

// ---------------------------------------------------------------------------
// Réordonnancement
// ---------------------------------------------------------------------------

const ordre = ["A", "B", "C"];

describe("forms — réordonnancement des questions", () => {
  it("monte et descend d'un cran", () => {
    expect(moveQuestion(ordre, 1, -1)).toEqual(["B", "A", "C"]);
    expect(moveQuestion(ordre, 1, 1)).toEqual(["A", "C", "B"]);
    expect(moveQuestion(ordre, 0, -1)).toBeNull();
    expect(moveQuestion(ordre, 2, 1)).toBeNull();
    expect(moveQuestion(ordre, 7, -1)).toBeNull();
  });

  it("ne modifie pas la liste d'origine", () => {
    const source = ["A", "B", "C"];
    moveQuestion(source, 0, 1);
    duplicateQuestion(source, 1, (item) => item);
    removeQuestion(source, 0);
    insertQuestion(source, 1, "Z");
    expect(source).toEqual(["A", "B", "C"]);
  });

  it("refuse les index hors liste, sans décaler la dernière question", () => {
    // Un index négatif ferait remonter la dernière question : c'est refusé.
    expect(moveQuestion(ordre, -1, 1)).toBeNull();
    expect(duplicateQuestion(ordre, -1, (item) => item)).toBeNull();
    expect(removeQuestion(ordre, -1)).toBeNull();
    expect(moveQuestion(ordre, 3, -1)).toBeNull();
    expect(duplicateQuestion(ordre, 3, (item) => item)).toBeNull();
    expect(removeQuestion(ordre, 3)).toBeNull();
    expect(ordre).toEqual(["A", "B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Duplication et suppression annulable
// ---------------------------------------------------------------------------

describe("forms — duplication et suppression", () => {
  it("insère la copie juste après l'originale", () => {
    const next = duplicateQuestion(ordre, 1, (item) => `${item} (copie)`);
    expect(next).toEqual(["A", "B", "B (copie)", "C"]);
    expect(duplicateQuestion(ordre, 2, (item) => item)).toEqual(["A", "B", "C", "C"]);
    expect(duplicateQuestion(ordre, 9, (item) => item)).toBeNull();
  });

  it("retire une question en mémorisant sa place pour l'annulation", () => {
    const removal = removeQuestion(ordre, 1);
    expect(removal).toEqual({ questions: ["A", "C"], removed: "B", index: 1 });
    expect(removeQuestion(ordre, 3)).toBeNull();
  });

  it("annule une suppression à l'identique", () => {
    const removal = removeQuestion(ordre, 1);
    if (!removal) throw new Error("suppression impossible");
    expect(insertQuestion(removal.questions, removal.index, removal.removed)).toEqual(ordre);
  });

  it("recale une annulation qui arrive après d'autres modifications", () => {
    const removal = removeQuestion(ordre, 1);
    if (!removal) throw new Error("suppression impossible");
    // Une question a été ajoutée entre-temps : l'annulation replace la question
    // retirée au plus près de sa place d'origine, sans jamais la perdre.
    const entreDeux = insertQuestion(removal.questions, removal.index, "Z");
    expect(entreDeux).toEqual(["A", "Z", "C"]);
    expect(insertQuestion(entreDeux, removal.index, removal.removed)).toEqual(["A", "B", "Z", "C"]);
  });

  it("borne l'insertion à la taille de la liste", () => {
    expect(insertQuestion(["A", "B"], 9, "Z")).toEqual(["A", "B", "Z"]);
    expect(insertQuestion(["A", "B"], -3, "Z")).toEqual(["Z", "A", "B"]);
  });

  it("replace la question annulée à sa place sans défaire les réordonnancements d'après", () => {
    // « A » (position 0) est supprimée, puis l'utilisateur descend « B ».
    const retiré = removeQuestion(ordre, 0);
    if (!retiré) throw new Error("suppression impossible");
    const déplacé = moveQuestion(retiré.questions, 0, 1);
    if (!déplacé) throw new Error("déplacement impossible");
    expect(déplacé).toEqual(["C", "B"]);
    // L'annulation remet « A » à sa position d'origine, sans toucher au reste.
    expect(insertQuestion(déplacé, retiré.index, retiré.removed)).toEqual(["A", "C", "B"]);
  });
});
