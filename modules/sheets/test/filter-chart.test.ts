import { describe, expect, it } from "vitest";
import {
  extractChartData,
  layoutCartesian,
  layoutPie,
  niceTicks,
  tickLabel,
} from "../src/chart.ts";
import {
  detectFilterRange,
  distinctValues,
  EMPTY_LABEL,
  filterSummary,
  hiddenRows,
  isColumnFiltered,
  matchesCondition,
  withColumnFilter,
} from "../src/filter.ts";
import { normalizeTabSettings, readTabSettings, TabSettingsError } from "../src/tab-settings.ts";

const grid: Record<string, string> = {
  "0:0": "Ville",
  "0:1": "Ventes",
  "0:2": "Coûts",
  "1:0": "Paris",
  "1:1": "120",
  "1:2": "80",
  "2:0": "Lyon",
  "2:1": "90",
  "2:2": "95",
  "3:0": "Dakar",
  "3:1": "150",
  "3:2": "60",
  "4:0": "",
  "4:1": "10",
  "4:2": "",
};
const read = (row: number, col: number) => grid[`${row}:${col}`] ?? "";
const filter = { range: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 }, columns: {} };

describe("filtre automatique", () => {
  it("valeurs distinctes triées, vides en dernier", () => {
    expect(distinctValues(filter, 0, read)).toEqual(["Dakar", "Lyon", "Paris", EMPTY_LABEL]);
    expect(distinctValues(filter, 1, read)).toEqual(["10", "90", "120", "150"]);
  });

  it("masque par valeurs décochées et par condition", () => {
    const byValue = withColumnFilter(filter, 0, { hidden: ["Lyon", EMPTY_LABEL] });
    expect([...hiddenRows(byValue, read)].sort()).toEqual([2, 4]);
    expect(isColumnFiltered(byValue, 0)).toBe(true);
    expect(isColumnFiltered(byValue, 1)).toBe(false);
    const byCondition = withColumnFilter(byValue, 1, { condition: { op: "gte", value: 100 } });
    expect([...hiddenRows(byCondition, read)].sort()).toEqual([2, 4]);
    expect(filterSummary(byCondition, hiddenRows(byCondition, read))).toBe(
      "2 lignes sur 4 affichées",
    );
    const cleared = withColumnFilter(withColumnFilter(byCondition, 0, null), 1, { hidden: [] });
    expect(cleared.columns).toEqual({});
  });

  it("conditions texte et nombre", () => {
    expect(matchesCondition("Montpellier", { op: "contains", value: "PELL" })).toBe(true);
    expect(matchesCondition("12,5", { op: "gt", value: 12 })).toBe(true);
    expect(matchesCondition("abc", { op: "lt", value: 3 })).toBe(false);
    expect(matchesCondition(" ", { op: "empty" })).toBe(true);
    expect(matchesCondition("paris", { op: "equals", value: "Paris" })).toBe(true);
  });

  it("détecte la région de données autour de la cellule active", () => {
    const has = (row: number, col: number) => read(row, col) !== "";
    expect(
      detectFilterRange({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 }, has, {
        rows: 100,
        cols: 26,
      }),
    ).toEqual({ startRow: 0, endRow: 4, startCol: 0, endCol: 2 });
  });
});

describe("graphiques", () => {
  const reader = (row: number, col: number) => {
    const text = read(row, col);
    const number = text !== "" && !Number.isNaN(Number(text)) ? Number(text) : null;
    return { text, number };
  };

  it("extrait catégories et séries (en-têtes en première ligne)", () => {
    const data = extractChartData({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 }, reader);
    expect(data.categories).toEqual(["Paris", "Lyon", "Dakar"]);
    expect(data.series.map((series) => series.name)).toEqual(["Ventes", "Coûts"]);
    expect(data.series[0]?.values).toEqual([120, 90, 150]);
  });

  it("plage sans en-têtes : séries numérotées", () => {
    const data = extractChartData({ startRow: 1, endRow: 3, startCol: 1, endCol: 1 }, reader);
    expect(data.categories).toEqual(["1", "2", "3"]);
    expect(data.series).toEqual([{ name: "Série 1", values: [120, 90, 150] }]);
  });

  it("graduations rondes et libellés", () => {
    expect(niceTicks(0, 150)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(-20, 95)).toEqual([-50, 0, 50, 100]);
    expect(niceTicks(0, 9)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(tickLabel(15000)).toBe("15 k");
    expect(tickLabel(2_500_000)).toBe("2,5 M");
  });

  it("géométrie histogramme, barres et courbes", () => {
    const data = extractChartData({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 }, reader);
    const column = layoutCartesian(data, "column", { width: 464, height: 244 });
    expect(column.bars).toHaveLength(6);
    const tallest = column.bars.reduce((a, b) => (b.height > a.height ? b : a));
    expect(tallest.value).toBe(150);
    expect(Math.round(tallest.y)).toBe(column.plot.top);
    const bar = layoutCartesian(data, "bar", { width: 500, height: 300 });
    expect(bar.bars.every((rect) => rect.x >= bar.plot.left)).toBe(true);
    const line = layoutCartesian(data, "line", { width: 464, height: 244 });
    expect(line.lines).toHaveLength(2);
    expect(line.lines[0]?.points.map((point) => point.value)).toEqual([120, 90, 150]);
  });

  it("secteurs : parts proportionnelles, valeurs négatives ignorées", () => {
    const pie = layoutPie(
      { categories: ["a", "b", "c"], series: [{ name: "s", values: [1, 3, -2] }] },
      { width: 400, height: 300 },
    );
    expect(pie.arcs.map((arc) => arc.share)).toEqual([0.25, 0.75]);
    const full = layoutPie(
      { categories: ["a"], series: [{ name: "s", values: [5] }] },
      { width: 400, height: 300 },
    );
    expect(full.arcs[0]?.path).toContain("A");
  });
});

describe("réglages d'onglet", () => {
  const chart = {
    id: "c1",
    type: "pie",
    range: { startRow: 0, endRow: 3, startCol: 0, endCol: 1 },
    title: "Ventes",
    x: 10,
    y: 20,
    width: 480,
    height: 300,
  };
  it("valide volets, filtre et graphiques", () => {
    expect(normalizeTabSettings({ frozen: { rows: 1, cols: 0 }, charts: [chart] })).toEqual({
      frozen: { rows: 1, cols: 0 },
      charts: [chart],
    });
    expect(normalizeTabSettings({ frozen: { rows: 0, cols: 0 } })).toBeNull();
    expect(
      normalizeTabSettings({
        filter: {
          range: { startRow: 4, endRow: 0, startCol: 2, endCol: 0 },
          columns: { "1": { hidden: ["a", "a"] } },
        },
      }),
    ).toEqual({
      filter: {
        range: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
        columns: { "1": { hidden: ["a"] } },
      },
    });
  });
  it("refuse les écarts", () => {
    expect(() => normalizeTabSettings({ couleur: 1 })).toThrow(TabSettingsError);
    expect(() => normalizeTabSettings({ frozen: { rows: 99, cols: 0 } })).toThrow(TabSettingsError);
    expect(() => normalizeTabSettings({ charts: [{ ...chart, type: "radar" }] })).toThrow(
      TabSettingsError,
    );
    expect(() =>
      normalizeTabSettings({
        filter: { range: filter.range, columns: { "9": { hidden: ["x"] } } },
      }),
    ).toThrow(TabSettingsError);
    expect(() =>
      normalizeTabSettings({
        filter: { range: filter.range, columns: { "1": { condition: { op: "gt", value: "x" } } } },
      }),
    ).toThrow(TabSettingsError);
    expect(readTabSettings({ couleur: 1 })).toEqual({});
  });
});
