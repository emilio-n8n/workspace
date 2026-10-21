/**
 * Graphiques (histogramme, barres, courbes, secteurs) : extraction des séries
 * depuis une plage et géométrie SVG. Logique pure — le composant React ne fait
 * que dessiner les primitives renvoyées ; les tests vérifient les nombres.
 *
 * Convention d'Excel : si la première ligne contient du texte, ce sont les
 * noms des séries ; si la première colonne contient du texte, ce sont les
 * catégories (axe X ou parts du secteur).
 */
import type { RangeRef } from "./tab-settings.ts";

export type ChartSeries = { name: string; values: (number | null)[] };
export type ChartData = { categories: string[]; series: ChartSeries[] };

export type CellReader = (row: number, col: number) => { text: string; number: number | null };

/** Couleurs des séries : jetons du design (variables CSS), jamais en dur. */
export const SERIES_COLORS = [
  "var(--app-sheets)",
  "var(--app-docs)",
  "var(--app-slides)",
  "var(--attention)",
  "var(--app-calendar)",
  "var(--destructive)",
  "var(--app-forms)",
  "var(--app-chat)",
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

export function extractChartData(range: RangeRef, read: CellReader): ChartData {
  const isText = (row: number, col: number) => {
    const cell = read(row, col);
    return cell.text.trim() !== "" && cell.number === null;
  };
  let headerRow = false;
  for (let col = range.startCol; col <= range.endCol; col += 1) {
    if (isText(range.startRow, col)) headerRow = true;
  }
  const firstDataRow = headerRow ? range.startRow + 1 : range.startRow;
  let categoryCol = range.endCol > range.startCol;
  if (categoryCol) {
    let anyText = false;
    for (let row = firstDataRow; row <= range.endRow; row += 1) {
      const cell = read(row, range.startCol);
      if (cell.number !== null && cell.text.trim() !== "") categoryCol = false;
      if (isText(row, range.startCol)) anyText = true;
    }
    categoryCol = categoryCol && anyText;
  }
  const firstSeriesCol = categoryCol ? range.startCol + 1 : range.startCol;
  const categories: string[] = [];
  for (let row = firstDataRow; row <= range.endRow; row += 1) {
    categories.push(categoryCol ? read(row, range.startCol).text : String(row - firstDataRow + 1));
  }
  const series: ChartSeries[] = [];
  for (let col = firstSeriesCol; col <= range.endCol; col += 1) {
    const name = headerRow
      ? read(range.startRow, col).text || `Série ${series.length + 1}`
      : `Série ${series.length + 1}`;
    const values: (number | null)[] = [];
    for (let row = firstDataRow; row <= range.endRow; row += 1) values.push(read(row, col).number);
    series.push({ name, values });
  }
  return { categories, series };
}

/** Graduations « rondes » (1, 2, 5 × 10ⁿ) couvrant [min, max], zéro inclus. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  let low = Math.min(0, min);
  let high = Math.max(0, max);
  if (low === high) high = low + 1;
  const raw = (high - low) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? raw;
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step)
    ticks.push(Number(value.toPrecision(12)) || 0);
  return ticks;
}

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  series: number;
  index: number;
  value: number;
};
export type Point = { x: number; y: number; value: number };
export type Arc = {
  path: string;
  series: number;
  index: number;
  value: number;
  share: number;
  labelX: number;
  labelY: number;
};

export type Plot = { left: number; top: number; width: number; height: number };

export type CartesianLayout = {
  plot: Plot;
  ticks: { value: number; pos: number }[];
  categories: { label: string; pos: number }[];
  bars: Rect[];
  lines: { series: number; points: Point[] }[];
  /** Position de la ligne du zéro (axe des valeurs). */
  zero: number;
};

function bounds(data: ChartData): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const series of data.series) {
    for (const value of series.values) {
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return { min, max };
}

/**
 * Mise en page d'un graphique cartésien. `horizontal` = barres (catégories en
 * ordonnée) ; sinon histogramme ou courbes (catégories en abscisse).
 */
export function layoutCartesian(
  data: ChartData,
  kind: "bar" | "column" | "line",
  size: { width: number; height: number },
): CartesianLayout {
  const horizontal = kind === "bar";
  const plot: Plot = {
    left: horizontal ? 84 : 48,
    top: 12,
    width: Math.max(10, size.width - (horizontal ? 100 : 64)),
    height: Math.max(10, size.height - 44),
  };
  const { min, max } = bounds(data);
  const ticks = niceTicks(min, max);
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const span = high - low || 1;
  const valueAxis = horizontal ? plot.width : plot.height;
  const toPos = (value: number) =>
    horizontal
      ? plot.left + ((value - low) / span) * valueAxis
      : plot.top + plot.height - ((value - low) / span) * valueAxis;
  const count = Math.max(1, data.categories.length);
  const band = (horizontal ? plot.height : plot.width) / count;
  const categories = data.categories.map((label, index) => ({
    label,
    pos: (horizontal ? plot.top : plot.left) + band * (index + 0.5),
  }));
  const zero = toPos(0);
  const bars: Rect[] = [];
  const lines: { series: number; points: Point[] }[] = [];
  if (kind === "line") {
    data.series.forEach((series, seriesIndex) => {
      const points: Point[] = [];
      series.values.forEach((value, index) => {
        if (value === null) return;
        points.push({ x: categories[index]?.pos ?? 0, y: toPos(value), value });
      });
      lines.push({ series: seriesIndex, points });
    });
  } else {
    const groups = Math.max(1, data.series.length);
    const inner = band * 0.8;
    const thickness = inner / groups;
    data.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, index) => {
        if (value === null) return;
        const start =
          (horizontal ? plot.top : plot.left) + band * index + band * 0.1 + thickness * seriesIndex;
        const end = toPos(value);
        if (horizontal) {
          bars.push({
            x: Math.min(zero, end),
            y: start,
            width: Math.abs(end - zero),
            height: thickness,
            series: seriesIndex,
            index,
            value,
          });
        } else {
          bars.push({
            x: start,
            y: Math.min(zero, end),
            width: thickness,
            height: Math.abs(end - zero),
            series: seriesIndex,
            index,
            value,
          });
        }
      });
    });
  }
  return {
    plot,
    ticks: ticks.map((value) => ({ value, pos: toPos(value) })),
    categories,
    bars,
    lines,
    zero,
  };
}

/** Secteurs de la première série (valeurs négatives ou vides ignorées). */
export function layoutPie(
  data: ChartData,
  size: { width: number; height: number },
): { cx: number; cy: number; r: number; arcs: Arc[] } {
  const cx = size.width * 0.38;
  const cy = size.height / 2;
  const r = Math.max(10, Math.min(size.width * 0.34, size.height / 2 - 12));
  const values = (data.series[0]?.values ?? []).map((value) =>
    value !== null && value > 0 ? value : 0,
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  const arcs: Arc[] = [];
  if (total <= 0) return { cx, cy, r, arcs };
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    if (value <= 0) return;
    const share = value / total;
    const sweep = share * Math.PI * 2;
    const end = angle + sweep;
    const mid = angle + sweep / 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = sweep > Math.PI ? 1 : 0;
    const path =
      share >= 0.9999
        ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
        : `M ${cx} ${cy} L ${round(x1)} ${round(y1)} A ${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)} Z`;
    arcs.push({
      path,
      series: 0,
      index,
      value,
      share,
      labelX: cx + r * 0.65 * Math.cos(mid),
      labelY: cy + r * 0.65 * Math.sin(mid),
    });
    angle = end;
  });
  return { cx, cy, r, arcs };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Libellé court d'une graduation (« 1,5 k », « 2 M »). */
export function tickLabel(value: number): string {
  const abs = Math.abs(value);
  const format = (number: number, suffix: string) =>
    `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(number)}${suffix}`;
  if (abs >= 1e6) return format(value / 1e6, " M");
  if (abs >= 1e4) return format(value / 1e3, " k");
  return format(value, "");
}
