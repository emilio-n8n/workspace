import { describe, expect, it } from "vitest";
import {
  AGENDA_DAYS,
  AGENDA_STEP_DAYS,
  addDays,
  addMonths,
  DEFAULT_VIEW_MODE,
  dayCellLabel,
  daysFrom,
  formatDayMonth,
  formatDayMonthYear,
  formatDayTitle,
  formatLongDay,
  formatMonthName,
  formatMonthYear,
  formatSpan,
  isSameDay,
  isSameMonth,
  isViewMode,
  MONTH_GRID_DAYS,
  parseDateInput,
  parseStoredView,
  rangeFor,
  serializeView,
  shiftCursor,
  startOfDay,
  startOfMonth,
  startOfWeek,
  VIEW_LABELS,
  VIEW_MODES,
  viewHeading,
} from "../src/ui/view-state.ts";

/** Référence fixe : mardi 13 octobre 2026, 15:47 locale. */
const NOW = new Date(2026, 9, 13, 15, 47, 12, 500);

describe("vues — mode et préférence persistée", () => {
  it("expose les quatre vues attendues, avec leurs libellés français", () => {
    expect(VIEW_MODES).toEqual(["day", "week", "month", "agenda"]);
    expect(VIEW_LABELS).toEqual({
      day: "Jour",
      week: "Semaine",
      month: "Mois",
      agenda: "Agenda",
    });
  });

  it("ne reconnaît que les quatre modes", () => {
    expect(isViewMode("day")).toBe(true);
    expect(isViewMode("agenda")).toBe(true);
    expect(isViewMode("année")).toBe(false);
    expect(isViewMode(undefined)).toBe(false);
  });

  it("relit une préférence valide et retombe sur la vue par défaut sinon", () => {
    expect(DEFAULT_VIEW_MODE).toBe("week");
    expect(parseStoredView("agenda")).toBe("agenda");
    expect(parseStoredView("  MONTH ")).toBe("month");
    expect(serializeView("agenda")).toBe("agenda");

    // Données absentes ou corrompues : jamais d'écran bloqué.
    expect(parseStoredView(null)).toBe(DEFAULT_VIEW_MODE);
    expect(parseStoredView(undefined)).toBe(DEFAULT_VIEW_MODE);
    expect(parseStoredView("")).toBe(DEFAULT_VIEW_MODE);
    expect(parseStoredView("vue-inexistante")).toBe(DEFAULT_VIEW_MODE);
  });
});

describe("vues — déplacement du curseur", () => {
  it("avance et recule d'une journée en vue jour", () => {
    expect(shiftCursor(NOW, "day", 1)).toEqual(addDays(NOW, 1));
    expect(shiftCursor(NOW, "day", -1)).toEqual(addDays(NOW, -1));
  });

  it("avance et recule d'une semaine en vue semaine et agenda", () => {
    expect(shiftCursor(NOW, "week", 1)).toEqual(addDays(NOW, 7));
    expect(shiftCursor(NOW, "week", -1)).toEqual(addDays(NOW, -7));
    expect(AGENDA_STEP_DAYS).toBe(7);
    expect(shiftCursor(NOW, "agenda", 1)).toEqual(addDays(NOW, 7));
    expect(shiftCursor(NOW, "agenda", -1)).toEqual(addDays(NOW, -7));
  });

  it("change de mois en vue mois, en bornant au dernier jour du mois", () => {
    const from31 = new Date(2026, 0, 31);
    expect(addMonths(from31, 1)).toEqual(new Date(2026, 1, 28)); // 2026 n'est pas bissextile
    expect(addMonths(from31, -1)).toEqual(new Date(2025, 11, 31));
    expect(shiftCursor(from31, "month", 1)).toEqual(new Date(2026, 1, 28));
  });

  it("conserve l'heure du curseur lors d'un décalage horaire positif", () => {
    const moved = shiftCursor(new Date(2026, 9, 13, 8, 30), "week", 1);
    expect(moved.getHours()).toBe(8);
    expect(moved.getMinutes()).toBe(30);
  });
});

describe("vues — plages interrogées", () => {
  it("la vue jour couvre uniquement la journée du curseur", () => {
    const range = rangeFor("day", NOW);
    expect(range.from).toEqual(startOfDay(NOW));
    expect(range.to).toEqual(addDays(startOfDay(NOW), 1));
    expect(range.days).toHaveLength(1);
    expect(range.days[0]).toEqual(startOfDay(NOW));
  });

  it("la vue semaine couvre sept jours du lundi au dimanche", () => {
    const range = rangeFor("week", NOW);
    expect(range.from).toEqual(startOfWeek(NOW));
    expect(range.from).toEqual(new Date(2026, 9, 12)); // lundi
    expect(range.days).toHaveLength(7);
    expect(range.days.at(-1)).toEqual(new Date(2026, 9, 18)); // dimanche
    expect(range.to).toEqual(addDays(range.from, 7));
  });

  it("la vue mois couvre six semaines entières englobant le mois", () => {
    const range = rangeFor("month", NOW); // octobre 2026
    expect(range.from).toEqual(new Date(2026, 8, 28)); // lundi précédant le 1er octobre
    expect(range.to).toEqual(addDays(range.from, MONTH_GRID_DAYS));
    expect(range.days).toHaveLength(MONTH_GRID_DAYS);
    // Chaque jour d'octobre est bien dans la grille.
    for (let day = 1; day <= 31; day += 1) {
      const target = new Date(2026, 9, day);
      expect(range.days.some((candidate) => isSameDay(candidate, target))).toBe(true);
    }
  });

  it("la vue agenda part du curseur et couvre trente jours", () => {
    const range = rangeFor("agenda", NOW);
    expect(range.from).toEqual(startOfDay(NOW));
    expect(range.days).toHaveLength(AGENDA_DAYS);
    expect(range.to).toEqual(addDays(startOfDay(NOW), AGENDA_DAYS));
    expect(range.days.at(-1)).toEqual(addDays(startOfDay(NOW), AGENDA_DAYS - 1));
  });

  it("chaque plage respecte le garde-fou de 366 jours du service", () => {
    for (const mode of VIEW_MODES) {
      const range = rangeFor(mode, NOW);
      expect(range.to.getTime() - range.from.getTime()).toBeLessThanOrEqual(366 * 86_400_000);
    }
  });

  it("les jours sont triés et consécutifs", () => {
    const { days } = rangeFor("month", NOW);
    for (let index = 1; index < days.length; index += 1) {
      const previous = days[index - 1];
      const current = days[index];
      if (!previous || !current) throw new Error("jour manquant");
      expect(current.getTime() - previous.getTime()).toBe(86_400_000);
    }
  });

  it("les semaines commencent un lundi", () => {
    expect(startOfWeek(new Date(2026, 9, 13)).getDay()).toBe(1); // mardi → lundi
    expect(startOfWeek(new Date(2026, 9, 11)).getDay()).toBe(1); // dimanche → lundi précédent
    expect(daysFrom(new Date(2026, 9, 13, 22, 5), 3)).toEqual([
      new Date(2026, 9, 13),
      new Date(2026, 9, 14),
      new Date(2026, 9, 15),
    ]);
  });
});

describe("vues — libellés français", () => {
  it("formate les dates longues et courtes", () => {
    expect(formatLongDay(new Date(2026, 9, 13))).toBe("mardi 13 octobre 2026");
    expect(formatDayTitle(new Date(2026, 9, 13))).toBe("Mardi 13 octobre 2026");
    expect(formatDayMonth(new Date(2026, 9, 13))).toBe("13 octobre");
    expect(formatDayMonthYear(new Date(2026, 9, 5))).toBe("5 octobre 2026");
    expect(formatMonthYear(new Date(2026, 9, 13))).toBe("octobre 2026");
    expect(formatMonthName(new Date(2026, 0, 1))).toBe("janvier");
  });

  it("formate un intervalle, réduit quand les mois coïncident", () => {
    expect(formatSpan(new Date(2026, 9, 12), new Date(2026, 9, 18))).toBe("12 au 18 octobre 2026");
    expect(formatSpan(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe(
      "28 septembre au 4 octobre 2026",
    );
  });

  it("titre chaque vue", () => {
    expect(viewHeading("day", NOW)).toBe("Mardi 13 octobre 2026");
    expect(viewHeading("week", NOW)).toBe("Semaine du 12 au 18 octobre 2026");
    expect(viewHeading("month", NOW)).toBe("Octobre 2026");
    expect(viewHeading("agenda", NOW)).toBe("Agenda — du 13 octobre au 11 novembre 2026");
  });

  it("nomme les cases de la grille pour les lecteurs d'écran", () => {
    expect(dayCellLabel(new Date(2026, 9, 13), false)).toBe("mardi 13 octobre 2026");
    expect(dayCellLabel(new Date(2026, 9, 13), true)).toBe("mardi 13 octobre 2026, aujourd'hui");
  });

  it("compare jours et mois", () => {
    expect(isSameDay(new Date(2026, 9, 13, 23, 59), new Date(2026, 9, 13, 0, 1))).toBe(true);
    expect(isSameDay(new Date(2026, 9, 13), new Date(2026, 9, 14))).toBe(false);
    expect(isSameMonth(new Date(2026, 9, 1), new Date(2026, 9, 31))).toBe(true);
    expect(isSameMonth(new Date(2026, 9, 31), new Date(2026, 10, 1))).toBe(false);
  });

  it("lit une date locale `aaaa-mm-jj`", () => {
    expect(parseDateInput("2026-10-13")).toEqual(new Date(2026, 9, 13));
    expect(parseDateInput(" 2026-01-05 ")).toEqual(new Date(2026, 0, 5));
  });

  it("refuse une date mal formée ou inexistante", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("2026-10-13T00:00:00Z")).toBeNull();
    expect(parseDateInput("2026-02-30")).toBeNull(); // 30 février
    expect(parseDateInput("2026-13-01")).toBeNull(); // mois 13
    expect(parseDateInput("13/10/2026")).toBeNull();
  });

  it("interprète la date en heure locale, sans décalage UTC", () => {
    // `new Date("2026-10-13")` vaut minuit UTC : dans un fuseau négatif, le
    // jour serait décalé d'un jour. La lecture locale évite cet écart.
    const date = parseDateInput("2026-10-13");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(13);
  });

  it("encadre le premier jour du mois", () => {
    expect(startOfMonth(NOW)).toEqual(new Date(2026, 9, 1));
    expect(startOfDay(new Date(2026, 9, 13, 23, 59, 59))).toEqual(new Date(2026, 9, 13));
  });
});
