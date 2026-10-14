import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  emptyRule,
  expandOccurrences,
  formatRecurrenceRule,
  INTERVAL_MAX,
  INTERVAL_MIN,
  isActive,
  normalizeInterval,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  validateRule,
} from "../src/ui/recurrence.ts";

/** Point de départ de toutes les séries de test : mardi 10 mars 2026, 09:00 UTC. */
const BASE = { startsAt: "2026-03-10T09:00:00.000Z", endsAt: "2026-03-10T10:00:00.000Z" };
/** Plage large couvrant les séries courtes. */
const FROM = new Date("2026-03-01T00:00:00.000Z");
const TO = new Date("2026-06-30T00:00:00.000Z");

function days(list: { startsAt: Date }[]): string[] {
  return list.map((occurrence) => occurrence.startsAt.toISOString().slice(0, 10));
}

describe("récurrence — règle par défaut", () => {
  it("ne répète rien, intervalle inutilisé", () => {
    const rule = emptyRule();
    expect(rule).toEqual({
      recurrence: "none",
      recurrenceInterval: INTERVAL_MIN,
      recurrenceUntil: "",
    });
    expect(isActive(rule)).toBe(false);
    expect(INTERVAL_MIN).toBe(1);
    expect(INTERVAL_MAX).toBe(52);
  });

  it("expose les trois fréquences simples et leurs libellés français", () => {
    expect(RECURRENCE_FREQUENCIES).toEqual(["none", "daily", "weekly", "monthly"]);
    expect(RECURRENCE_FREQUENCY_LABELS).toEqual({
      none: "Ne pas répéter",
      daily: "Quotidienne",
      weekly: "Hebdomadaire",
      monthly: "Mensuelle",
    });
  });

  it("normalise un intervalle hors bornes", () => {
    expect(normalizeInterval(undefined)).toBe(1);
    expect(normalizeInterval(3)).toBe(3);
    expect(normalizeInterval(0)).toBe(1);
    expect(normalizeInterval(-5)).toBe(1);
    expect(normalizeInterval(2.5)).toBe(1); // non entier
    expect(normalizeInterval(999)).toBe(52);
  });

  it("n'exige une date de fin que si une fréquence est choisie", () => {
    expect(
      validateRule({ recurrence: "none" as const, recurrenceInterval: 1, recurrenceUntil: "" }),
    ).toBeNull();
    expect(
      validateRule({ recurrence: "daily" as const, recurrenceInterval: 1, recurrenceUntil: "" }),
    ).toBe("Choisissez une date de fin de répétition.");
    expect(
      validateRule({
        recurrence: "weekly" as const,
        recurrenceInterval: 2,
        recurrenceUntil: "2026-04-30",
      }),
    ).toBeNull();
  });
});

describe("récurrence — expansion dans une plage", () => {
  it("ne développe qu'une occurrence sans répétition", () => {
    const list = expandOccurrences(
      BASE,
      { recurrence: "none" as const, recurrenceInterval: 1, recurrenceUntil: "" },
      FROM,
      TO,
    );
    expect(days(list)).toEqual(["2026-03-10"]);
  });

  it("développe tous les jours jusqu'à la date de fin incluse", () => {
    const list = expandOccurrences(
      BASE,
      { recurrence: "daily" as const, recurrenceInterval: 1, recurrenceUntil: "2026-03-13" },
      FROM,
      TO,
    );
    expect(days(list)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"]);
  });

  it("respecte l'intervalle : toutes les deux ou trois semaines", () => {
    const fortnightly = expandOccurrences(
      BASE,
      { recurrence: "weekly" as const, recurrenceInterval: 2, recurrenceUntil: "2026-04-14" },
      FROM,
      TO,
    );
    expect(days(fortnightly)).toEqual([
      "2026-03-10",
      "2026-03-24",
      "2026-04-07", // le 21 avril dépasse la fin
    ]);

    const everyThree = expandOccurrences(
      BASE,
      { recurrence: "weekly" as const, recurrenceInterval: 3, recurrenceUntil: "2026-05-01" },
      FROM,
      TO,
    );
    expect(days(everyThree)).toEqual(["2026-03-10", "2026-03-31", "2026-04-21"]);
  });

  it("borne le jour au dernier jour du mois, puis reprend le jour d'origine", () => {
    const list = expandOccurrences(
      { startsAt: "2026-01-31T10:00:00.000Z", endsAt: "2026-01-31T11:00:00.000Z" },
      { recurrence: "monthly" as const, recurrenceInterval: 1, recurrenceUntil: "2026-05-31" },
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-06-30T00:00:00.000Z"),
    );
    expect(days(list)).toEqual([
      "2026-01-31",
      "2026-02-28", // février borné
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("saute des mois entiers avec un intervalle mensuel", () => {
    const list = expandOccurrences(
      BASE,
      { recurrence: "monthly" as const, recurrenceInterval: 2, recurrenceUntil: "2026-07-10" },
      FROM,
      new Date("2026-08-01T00:00:00.000Z"),
    );
    expect(days(list)).toEqual(["2026-03-10", "2026-05-10", "2026-07-10"]);
  });

  it("ne renvoie que les occurrences qui recouvrent la plage", () => {
    const rule = {
      recurrence: "daily",
      recurrenceInterval: 1,
      recurrenceUntil: "2026-03-20",
    } as const;
    // Plage en milieu de série : le 12 et le 13 seulement.
    const middle = expandOccurrences(
      BASE,
      rule,
      new Date("2026-03-12T00:00:00.000Z"),
      new Date("2026-03-14T00:00:00.000Z"),
    );
    expect(days(middle)).toEqual(["2026-03-12", "2026-03-13"]);

    // Plage avant la série : rien.
    expect(
      days(
        expandOccurrences(
          BASE,
          rule,
          new Date("2026-03-01T00:00:00.000Z"),
          new Date("2026-03-09T00:00:00.000Z"),
        ),
      ),
    ).toEqual([]);
  });

  it("conserve la durée de chaque occurrence", () => {
    const list = expandOccurrences(
      { startsAt: "2026-03-10T09:00:00.000Z", endsAt: "2026-03-10T12:30:00.000Z" },
      { recurrence: "daily" as const, recurrenceInterval: 2, recurrenceUntil: "2026-03-14" },
      FROM,
      TO,
    );
    expect(list).toHaveLength(3);
    for (const occurrence of list) {
      expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(
        3.5 * 60 * 60 * 1000,
      );
    }
  });

  it("plafonne le développement à 100 occurrences", () => {
    const list = expandOccurrences(
      BASE,
      { recurrence: "daily" as const, recurrenceInterval: 1, recurrenceUntil: "2026-12-31" },
      FROM,
      new Date("2027-01-02T00:00:00.000Z"),
    );
    expect(list).toHaveLength(100);
    expect(list[0]?.startsAt.toISOString()).toBe("2026-03-10T09:00:00.000Z");
  });
});

describe("récurrence — décompte et résumé", () => {
  it("compte les occurrences d'une série", () => {
    expect(
      countOccurrences(BASE, {
        recurrence: "daily",
        recurrenceInterval: 1,
        recurrenceUntil: "2026-03-14",
      }),
    ).toBe(5);
    expect(
      countOccurrences(BASE, {
        recurrence: "weekly",
        recurrenceInterval: 2,
        recurrenceUntil: "2026-04-14",
      }),
    ).toBe(3);
    expect(
      countOccurrences(BASE, {
        recurrence: "monthly",
        recurrenceInterval: 3,
        recurrenceUntil: "2026-12-10",
      }),
    ).toBe(4);
  });

  it("compte une seule occurrence sans répétition, zéro sans date de fin", () => {
    expect(countOccurrences(BASE, emptyRule())).toBe(1);
    expect(
      countOccurrences(BASE, {
        recurrence: "daily" as const,
        recurrenceInterval: 1,
        recurrenceUntil: "",
      }),
    ).toBe(0);
  });

  it("formule la règle en français, intervalle compris", () => {
    expect(
      formatRecurrenceRule({
        recurrence: "daily",
        recurrenceInterval: 1,
        recurrenceUntil: "2026-03-14",
      }),
    ).toBe("Tous les jours jusqu'au 14 mars 2026");
    expect(
      formatRecurrenceRule({
        recurrence: "weekly",
        recurrenceInterval: 2,
        recurrenceUntil: "2026-04-30",
      }),
    ).toBe("Toutes les 2 semaines jusqu'au 30 avril 2026");
    expect(
      formatRecurrenceRule({
        recurrence: "monthly",
        recurrenceInterval: 3,
        recurrenceUntil: "2026-12-10",
      }),
    ).toBe("Tous les 3 mois jusqu'au 10 décembre 2026");
    expect(formatRecurrenceRule(emptyRule())).toBe("Ne pas répéter");
  });

  it("annonce une règle sans date de fin sans fin de série", () => {
    expect(
      formatRecurrenceRule({
        recurrence: "weekly" as const,
        recurrenceInterval: 1,
        recurrenceUntil: "",
      }),
    ).toBe("Toutes les semaines");
  });
});
