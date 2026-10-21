import { cn, IconClose, Menu } from "@workspace/ui";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { type ChartData, layoutCartesian, layoutPie, seriesColor, tickLabel } from "../chart.ts";
import { CHART_TYPES, type ChartType, type SheetChart } from "../tab-settings.ts";

const HEADER = 32;

/** Dessin SVG d'un graphique (primitives calculées par `chart.ts`). */
export function ChartSvg({
  data,
  type,
  width,
  height,
}: {
  data: ChartData;
  type: ChartType;
  width: number;
  height: number;
}) {
  if (data.series.length === 0 || data.categories.length === 0) {
    return (
      <p className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">
        Aucune donnée numérique dans la plage.
      </p>
    );
  }
  if (type === "pie") {
    const pie = layoutPie(data, { width, height });
    return (
      <svg
        role="img"
        aria-label={`Secteurs : ${data.categories.join(", ")}`}
        viewBox={`0 0 ${width} ${height}`}
        className="size-full"
      >
        {pie.arcs.map((arc) => (
          <path
            key={arc.index}
            d={arc.path}
            style={{ fill: seriesColor(arc.index) }}
            className="stroke-card"
            strokeWidth={1.5}
          >
            <title>{`${data.categories[arc.index] ?? ""} : ${arc.value} (${Math.round(arc.share * 100)} %)`}</title>
          </path>
        ))}
        {pie.arcs.map((arc) =>
          arc.share >= 0.06 ? (
            <text
              key={`l${arc.index}`}
              x={arc.labelX}
              y={arc.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-card text-[11px] font-medium"
            >
              {`${Math.round(arc.share * 100)} %`}
            </text>
          ) : null,
        )}
        <g>
          {data.categories.map((label, index) => (
            <g
              key={label + String(index)}
              transform={`translate(${width * 0.76} ${16 + index * 18})`}
            >
              <rect width={10} height={10} rx={2} style={{ fill: seriesColor(index) }} />
              <text x={16} y={9} className="fill-foreground text-[11px]">
                {label.length > 16 ? `${label.slice(0, 15)}…` : label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    );
  }
  const layout = layoutCartesian(data, type, { width, height });
  const horizontal = type === "bar";
  const { plot } = layout;
  return (
    <svg
      role="img"
      aria-label={`${CHART_TYPES.find((entry) => entry.id === type)?.label ?? ""} : ${data.series.map((series) => series.name).join(", ")}`}
      viewBox={`0 0 ${width} ${height}`}
      className="size-full"
    >
      {layout.ticks.map((tick) =>
        horizontal ? (
          <g key={tick.value}>
            <line
              x1={tick.pos}
              x2={tick.pos}
              y1={plot.top}
              y2={plot.top + plot.height}
              className="stroke-border"
            />
            <text
              x={tick.pos}
              y={plot.top + plot.height + 14}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tickLabel(tick.value)}
            </text>
          </g>
        ) : (
          <g key={tick.value}>
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={tick.pos}
              y2={tick.pos}
              className="stroke-border"
            />
            <text
              x={plot.left - 6}
              y={tick.pos}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tickLabel(tick.value)}
            </text>
          </g>
        ),
      )}
      {layout.categories.map((category, index) =>
        horizontal ? (
          <text
            key={category.label + String(index)}
            x={plot.left - 6}
            y={category.pos}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-foreground text-[10px]"
          >
            {category.label.length > 12 ? `${category.label.slice(0, 11)}…` : category.label}
          </text>
        ) : (
          <text
            key={category.label + String(index)}
            x={category.pos}
            y={plot.top + plot.height + 14}
            textAnchor="middle"
            className="fill-foreground text-[10px]"
          >
            {category.label.length > 10 ? `${category.label.slice(0, 9)}…` : category.label}
          </text>
        ),
      )}
      {layout.bars.map((bar) => (
        <rect
          key={`${bar.series}-${bar.index}`}
          x={bar.x}
          y={bar.y}
          width={Math.max(0, bar.width)}
          height={Math.max(0, bar.height)}
          rx={2}
          style={{ fill: seriesColor(bar.series) }}
        >
          <title>{`${data.series[bar.series]?.name ?? ""} — ${data.categories[bar.index] ?? ""} : ${bar.value}`}</title>
        </rect>
      ))}
      {layout.lines.map((line) => (
        <g key={line.series}>
          <polyline
            points={line.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            style={{ stroke: seriesColor(line.series) }}
          />
          {line.points.map((point) => (
            <circle
              key={`${point.x}-${point.y}`}
              cx={point.x}
              cy={point.y}
              r={3}
              style={{ fill: seriesColor(line.series) }}
            >
              <title>{`${data.series[line.series]?.name ?? ""} : ${point.value}`}</title>
            </circle>
          ))}
        </g>
      ))}
      <line
        x1={horizontal ? layout.zero : plot.left}
        x2={horizontal ? layout.zero : plot.left + plot.width}
        y1={horizontal ? plot.top : layout.zero}
        y2={horizontal ? plot.top + plot.height : layout.zero}
        className="stroke-muted-foreground"
      />
    </svg>
  );
}

type FrameProps = {
  chart: SheetChart;
  data: ChartData;
  canEdit: boolean;
  onChange: (next: SheetChart) => void;
  onDelete: () => void;
};

/**
 * Graphique flottant sur la grille : déplacé par sa barre de titre, redimensionné
 * par son coin, type et suppression au menu. Le geste n'écrit qu'au relâché.
 */
export function ChartFrame({ chart, data, canEdit, onChange, onDelete }: FrameProps) {
  const [draft, setDraft] = useState<SheetChart | null>(null);
  const current = draft ?? chart;
  const startRef = useRef<{
    x: number;
    y: number;
    chart: SheetChart;
    mode: "move" | "resize";
  } | null>(null);

  function begin(event: ReactPointerEvent, mode: "move" | "resize") {
    if (!canEdit || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,[role=menu]") && mode === "move") return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY, chart: current, mode };
  }
  function move(event: ReactPointerEvent) {
    const start = startRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    setDraft(
      start.mode === "move"
        ? {
            ...start.chart,
            x: Math.max(0, Math.round(start.chart.x + dx)),
            y: Math.max(0, Math.round(start.chart.y + dy)),
          }
        : {
            ...start.chart,
            width: Math.min(1600, Math.max(200, Math.round(start.chart.width + dx))),
            height: Math.min(1200, Math.max(150, Math.round(start.chart.height + dy))),
          },
    );
  }
  function end() {
    if (!startRef.current) return;
    startRef.current = null;
    if (draft) onChange(draft);
    setDraft(null);
  }

  return (
    <section
      aria-label={`Graphique ${current.title || "sans titre"}`}
      data-chart-id={chart.id}
      className="absolute z-[8] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lift"
      style={{ left: current.x, top: current.y, width: current.width, height: current.height }}
    >
      <header
        onPointerDown={(event) => begin(event, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-border px-2",
          canEdit && "cursor-move",
        )}
        style={{ height: HEADER }}
      >
        <input
          aria-label="Titre du graphique"
          value={current.title}
          disabled={!canEdit}
          placeholder="Titre du graphique"
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setDraft({ ...current, title: event.target.value.slice(0, 120) })}
          onBlur={() => {
            if (draft) onChange(draft);
            setDraft(null);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
        />
        {canEdit ? (
          <>
            <Menu
              label="Type de graphique"
              align="end"
              triggerClassName="h-7 border-transparent bg-transparent px-2 text-xs hover:bg-muted focus-visible:ring-offset-0"
              items={CHART_TYPES.map((type) => ({
                id: `type-${type.id}`,
                label: type.id === chart.type ? `${type.label} (actuel)` : type.label,
                onSelect: () => onChange({ ...chart, type: type.id }),
              }))}
            />
            <button
              type="button"
              aria-label="Supprimer le graphique"
              title="Supprimer le graphique"
              onClick={onDelete}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconClose />
            </button>
          </>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 p-1">
        <ChartSvg
          data={data}
          type={current.type}
          width={current.width - 8}
          height={current.height - HEADER - 8}
        />
      </div>
      {data.series.length > 1 && current.type !== "pie" ? (
        <footer className="flex shrink-0 flex-wrap gap-3 px-3 pb-1.5 text-[11px] text-muted-foreground">
          {data.series.map((series, index) => (
            <span key={series.name + String(index)} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: seriesColor(index) }}
              />
              {series.name}
            </span>
          ))}
        </footer>
      ) : null}
      {canEdit ? (
        <span
          aria-hidden
          data-chart-resize
          onPointerDown={(event) => begin(event, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute right-0 bottom-0 size-3 cursor-nwse-resize border-r-2 border-b-2 border-muted-foreground/60"
        />
      ) : null}
    </section>
  );
}
