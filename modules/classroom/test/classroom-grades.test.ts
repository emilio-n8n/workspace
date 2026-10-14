import { describe, expect, it } from "vitest";
import {
  averageOnTwenty,
  averageTone,
  formatAverage,
  formatGradedCount,
  gradeMention,
  summarizeClassGrades,
  summarizeGrades,
  summarizeGradesByStudent,
} from "../src/grades.ts";

describe("classroom — calcul des moyennes", () => {
  it("calcule une moyenne sur 20 en pondérant par le barème", () => {
    // 8/10 (poids 10) + 40/100 (poids 100) = 48 sur 110 → 8,73 sur 20.
    expect(
      summarizeGrades([
        { grade: 8, points: 10 },
        { grade: 40, points: 100 },
      ]),
    ).toMatchObject({ average: 8.73, earned: 48, possible: 110, graded: 2, total: 2 });
  });

  it("ignore les devoirs non notés et les compte dans le total, pas dans la moyenne", () => {
    const summary = summarizeGrades([
      { grade: 15, points: 20 },
      { grade: null, points: 20 },
      { grade: null, points: 100 },
    ]);
    expect(summary).toMatchObject({ average: 15, earned: 15, possible: 20, graded: 1, total: 3 });
  });

  it("ne rend aucune moyenne quand rien n'est corrigé ou que rien ne pèse", () => {
    expect(summarizeGrades([])).toMatchObject({ average: null, graded: 0, total: 0 });
    expect(summarizeGrades([{ grade: null, points: 20 }]).average).toBeNull();
    // Un devoir sur 0 est noté mais ne pèse rien : pas de division par zéro.
    const zero = summarizeGrades([{ grade: 0, points: 0 }]);
    expect(zero).toMatchObject({ average: null, earned: 0, possible: 0, graded: 1, total: 1 });
    // Un barème négatif est traité comme non pondérable, jamais comme un crédit.
    expect(summarizeGrades([{ grade: 5, points: -10 }]).average).toBeNull();
  });

  it("arrondit la moyenne au centième, sans plus", () => {
    expect(averageOnTwenty(1, 3)).toBe(6.67);
    expect(averageOnTwenty(2, 3)).toBe(13.33);
    expect(averageOnTwenty(0, 0)).toBeNull();
    expect(averageOnTwenty(1, -2)).toBeNull();
    expect(averageOnTwenty(20, 20)).toBe(20);
  });

  it("produit une moyenne par élève, triée par nom", () => {
    const names = new Map([
      ["zoe", "Zoé"],
      ["alice", "Alice"],
      ["bruno", "Bruno"],
    ]);
    const rows = summarizeGradesByStudent(
      [
        { studentId: "zoe", grade: 10, points: 20 },
        { studentId: "alice", grade: 20, points: 20 },
        { studentId: "bruno", grade: 0, points: 20 },
        { studentId: "bruno", grade: 10, points: 20 },
      ],
      names,
    );
    expect(rows.map((row) => row.studentId)).toEqual(["alice", "bruno", "zoe"]);
    expect(rows.map((row) => row.average)).toEqual([20, 5, 10]);
  });

  it("agrège toute la classe avec les mêmes règles", () => {
    expect(
      summarizeClassGrades([
        { studentId: "a", grade: 10, points: 20 },
        { studentId: "b", grade: null, points: 20 },
        { studentId: "c", grade: 20, points: 20 },
      ]),
    ).toMatchObject({ average: 15, earned: 30, possible: 40, graded: 2, total: 3 });
  });
});

describe("classroom — lecture d'une moyenne", () => {
  it("rend la mention française usuelle, sans moyenne pour un bilan vide", () => {
    expect(gradeMention(18)).toBe("Très bien");
    expect(gradeMention(15)).toBe("Bien");
    expect(gradeMention(13)).toBe("Assez bien");
    expect(gradeMention(10)).toBe("Passable");
    expect(gradeMention(9.99)).toBe("Insuffisant");
    expect(gradeMention(null)).toBeNull();
  });

  it("choisit la teinte au seuil de dix puis de huit", () => {
    expect(averageTone(12)).toBe("accent");
    expect(averageTone(10)).toBe("accent");
    expect(averageTone(9)).toBe("attention");
    expect(averageTone(8)).toBe("attention");
    expect(averageTone(7.9)).toBe("danger");
    expect(averageTone(null)).toBe("neutral");
  });

  it("écrit la moyenne à la française, avec une virgule", () => {
    expect(formatAverage(12)).toBe("12,00/20");
    expect(formatAverage(8.73)).toBe("8,73/20");
    expect(formatAverage(null)).toBe("—");
  });

  it("résume le nombre de devoirs corrigés en bon français", () => {
    expect(formatGradedCount({ average: null, earned: 0, possible: 0, graded: 0, total: 0 })).toBe(
      "aucun devoir",
    );
    expect(formatGradedCount({ average: null, earned: 0, possible: 0, graded: 0, total: 4 })).toBe(
      "0 devoir noté sur 4",
    );
    expect(formatGradedCount({ average: null, earned: 0, possible: 0, graded: 1, total: 4 })).toBe(
      "1 devoir noté sur 4",
    );
    expect(formatGradedCount({ average: null, earned: 0, possible: 0, graded: 3, total: 5 })).toBe(
      "3 devoirs notés sur 5",
    );
  });
});
