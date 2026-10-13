import { describe, expect, it } from "vitest";
import {
  dateKey,
  dayHasEvents,
  daysFromWeek,
  daysWithEvents,
  eventDayKey,
  eventsOfDay,
  GRID_COLUMNS,
  gridPageStep,
  gridRows,
  groupEventsByDay,
  MINI_CALENDAR_WEEKS,
  miniCalendarDays,
  miniCalendarWeeks,
  nextGridIndex,
  overflowLabel,
  visibleEventsPerDay,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
} from "../src/ui/date-grid.ts";
import { startOfDay } from "../src/ui/view-state.ts";

/** Mardi 13 octobre 2026. */
const NOW = new Date(2026, 9, 13, 9, 30);

function event(title: string, startsAt: string, endsAt: string, allDay = false) {
  return { id: title, title, startsAt, endsAt, allDay };
}

describe("grille — clés de jour", () => {
  it("formate une clé locale sur dix chiffres", () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("rattache un événement horaire au jour local de son début", () => {
    expect(
      eventDayKey(event("Matin", "2026-10-13T07:30:00.000Z", "2026-10-13T08:30:00.000Z")),
    ).toBe("2026-10-13");
  });

  it("rattache un événement journée entière au préfixe UTC stocké", () => {
    // Stocké en minuit UTC : la clé est celle du jour stocké, sans décalage.
    expect(
      eventDayKey(event("Congé", "2026-10-13T00:00:00.000Z", "2026-10-14T00:00:00.000Z", true)),
    ).toBe("2026-10-13");
  });
});

describe("grille — regroupement par jour", () => {
  it("trie par heure puis par durée décroissante, les journées entières en tête", () => {
    const events = [
      event("Long", "2026-10-13T09:00:00.000Z", "2026-10-13T12:00:00.000Z"),
      event("Journée", "2026-10-13T00:00:00.000Z", "2026-10-14T00:00:00.000Z", true),
      event("Tôt", "2026-10-13T07:00:00.000Z", "2026-10-13T08:00:00.000Z"),
      event("Même heure", "2026-10-13T09:00:00.000Z", "2026-10-13T09:30:00.000Z"),
    ];
    const byDay = groupEventsByDay(events);
    expect(byDay.get("2026-10-13")?.map((item) => item.title)).toEqual([
      "Journée",
      "Tôt",
      "Long",
      "Même heure",
    ]);
  });

  it("renvoie une liste vide pour un jour sans événement", () => {
    const result = eventsOfDay(
      [event("Seul", "2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z")],
      NOW,
    );
    expect(result.key).toBe("2026-10-13");
    expect(result.list).toEqual([]);
  });

  it("déduplique les jours porteurs d'événements (pastilles du mini calendrier)", () => {
    const events = [
      event("A", "2026-10-13T09:00:00.000Z", "2026-10-13T10:00:00.000Z"),
      event("B", "2026-10-13T15:00:00.000Z", "2026-10-13T16:00:00.000Z"),
      event("C", "2026-10-20T09:00:00.000Z", "2026-10-20T10:00:00.000Z"),
    ];
    expect([...daysWithEvents(events)]).toEqual(["2026-10-13", "2026-10-20"]);
    expect(dayHasEvents(events, NOW)).toBe(true);
    expect(dayHasEvents(events, new Date(2026, 9, 14))).toBe(false);
  });

  it("ne modifie pas le tableau reçu", () => {
    const events = [
      event("Tard", "2026-10-13T16:00:00.000Z", "2026-10-13T17:00:00.000Z"),
      event("Tôt", "2026-10-13T08:00:00.000Z", "2026-10-13T09:00:00.000Z"),
    ];
    groupEventsByDay(events);
    expect(events.map((item) => item.title)).toEqual(["Tard", "Tôt"]);
  });
});

describe("grille — mini calendrier", () => {
  it("affiche six semaines de sept jours, toujours du lundi au dimanche", () => {
    const days = miniCalendarDays(new Date(2026, 9, 1));
    expect(days).toHaveLength(MINI_CALENDAR_WEEKS * GRID_COLUMNS);
    expect(days[0]).toEqual(new Date(2026, 8, 28)); // lundi précédant le 1er octobre
    expect(days.at(-1)).toEqual(new Date(2026, 10, 8)); // dimanche de la sixième semaine
    // Chaque case suit la semaine française : lundi (1) … samedi (6), dimanche (0).
    days.forEach((day, index) => {
      expect(day.getDay()).toBe((index + 1) % 7);
    });
  });

  it("garde une taille stable d'un mois à l'autre", () => {
    expect(miniCalendarDays(new Date(2026, 1, 1))).toHaveLength(
      miniCalendarDays(new Date(2026, 9, 1)).length,
    );
    // Le 1er février 2026 est un dimanche : la grille remonte au 26 janvier.
    expect(miniCalendarDays(new Date(2026, 1, 1))[0]).toEqual(new Date(2026, 0, 26));
  });

  it("découpe les mêmes jours en semaines", () => {
    const weeks = miniCalendarWeeks(new Date(2026, 9, 13));
    expect(weeks).toHaveLength(MINI_CALENDAR_WEEKS);
    for (const week of weeks) expect(week).toHaveLength(GRID_COLUMNS);
    expect(weeks[0]?.[0]).toEqual(startOfDay(new Date(2026, 8, 28)));
  });

  it("nombre les jours de la semaine en français, du lundi", () => {
    expect(WEEKDAY_LABELS).toHaveLength(7);
    expect(WEEKDAY_LABELS[0]).toBe("lun");
    expect(WEEKDAY_LABELS[6]).toBe("dim");
    expect(WEEKDAY_NAMES[0]).toBe("lundi");
    expect(WEEKDAY_NAMES[6]).toBe("dimanche");
    expect(daysFromWeek(new Date(2026, 9, 13))[0]).toEqual(new Date(2026, 9, 12));
  });

  it("résume les jours chargés de la grille du mois", () => {
    expect(visibleEventsPerDay([1, 2, 3, 4, 5])).toBe(3);
    expect(visibleEventsPerDay([1, 2])).toBe(2);
    expect(overflowLabel(2)).toBe("+2 autre(s)");
  });
});

describe("grille — navigation clavier", () => {
  const total = 42;
  const columns = 7;

  it("déplace le focus case par case, sans sortir de la grille", () => {
    expect(nextGridIndex(10, columns, total, "ArrowRight")).toBe(11);
    expect(nextGridIndex(10, columns, total, "ArrowLeft")).toBe(9);
    expect(nextGridIndex(10, columns, total, "ArrowDown")).toBe(17);
    expect(nextGridIndex(10, columns, total, "ArrowUp")).toBe(3);
  });

  it("borne les déplacements aux extrémités", () => {
    expect(nextGridIndex(41, columns, total, "ArrowRight")).toBeNull();
    expect(nextGridIndex(0, columns, total, "ArrowLeft")).toBeNull();
    expect(nextGridIndex(0, columns, total, "ArrowUp")).toBeNull();
    expect(nextGridIndex(35, columns, total, "ArrowDown")).toBeNull(); // dernière ligne
  });

  it("ramène au début et à la fin de la ligne", () => {
    expect(nextGridIndex(10, columns, total, "Home")).toBe(7);
    expect(nextGridIndex(10, columns, total, "End")).toBe(13);
    expect(nextGridIndex(10, columns, total, "Enter")).toBeNull();
  });

  it("saute une grille entière pour changer de mois", () => {
    const step = gridPageStep(columns, total);
    expect(step).toBe(42);
    expect(nextGridIndex(10, columns, total, "PageDown")).toBe(41);
    expect(nextGridIndex(10, columns, total, "PageUp")).toBe(0); // borné à la première case
  });

  it("compte les lignes d'une grille partiellement remplie", () => {
    expect(gridRows(42, 7)).toBe(6);
    expect(gridRows(8, 7)).toBe(2);
    expect(gridRows(7, 7)).toBe(1);
  });
});
