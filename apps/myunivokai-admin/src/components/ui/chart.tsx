"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// One chart language for the whole admin app.
//
// A ChartConfig maps a series key to the label and colour that series uses
// everywhere it appears — the geometry, the legend and the tooltip all read
// this same map. The alternative, handing a colour to <Bar>, a label to
// <Legend> and a third copy to the tooltip, is exactly how a legend ends up
// describing a bar it no longer matches.
//
// Colours are CSS custom properties, never literals: --chart-1..5 are defined
// once in globals.css beside the rest of the palette, so a chart re-themes
// with the app instead of pinning hex values into TSX.
export type ChartConfig = Record<string, { label: string; color: string }>;

// ChartContainer publishes each series colour as --color-<key> on a wrapper
// element, which is what lets a <Bar fill="var(--color-failed)"> stay honest:
// the geometry names the series, not a colour, so re-colouring a series is a
// one-line change in the config rather than a search across the chart.
export function ChartContainer({
  config,
  height = 220,
  className,
  children
}: {
  config: ChartConfig;
  height?: number;
  className?: string;
  children: React.ReactElement;
}) {
  const seriesColors = Object.fromEntries(
    Object.entries(config).map(([key, series]) => [`--color-${key}`, series.color])
  ) as React.CSSProperties;

  return (
    <div className={cn("w-full", className)} style={{ ...seriesColors, height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// Recharts injects active/payload/label into whatever element is handed to
// <Tooltip content>, so every one of them is optional here. Typing them as
// required would be a lie about who calls this.
export interface ChartTooltipItem {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  config,
  labelFormatter,
  valueFormatter,
  hideIndicator = false
}: {
  active?: boolean;
  payload?: ChartTooltipItem[];
  label?: unknown;
  config: ChartConfig;
  labelFormatter?: (label: unknown) => string;
  valueFormatter?: (value: number, key: string) => string;
  hideIndicator?: boolean;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="glass-panel min-w-[10rem] rounded-lg px-2.5 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground">
        {labelFormatter ? labelFormatter(label) : String(label ?? "")}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {payload.map((item, index) => {
          // dataKey first, name second: a cartesian series is identified by
          // its dataKey, while a pie slice shares one dataKey across every
          // slice and is only told apart by its name.
          const key = String(item.dataKey ?? item.name ?? index);
          const series = config[key] ?? config[String(item.name ?? "")];
          const numericValue = typeof item.value === "number" ? item.value : Number(item.value ?? 0);
          return (
            <li key={key} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {hideIndicator ? null : (
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: series?.color ?? item.color ?? "var(--muted-foreground)" }}
                  />
                )}
                <span className="truncate">{series?.label ?? String(item.name ?? key)}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-foreground">
                {valueFormatter ? valueFormatter(numericValue, key) : numericValue.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The legend is a row of buttons rather than Recharts' own <Legend>, because
// the point of it here is to switch a series off: reading a 90-day chart with
// three overlapping series is a matter of hiding two of them. Recharts can do
// this through onClick on its legend, but then the hidden state lives in a
// place the chart's own geometry cannot see, and each chart needs the same
// wiring anyway.
export function ChartLegend({
  config,
  hiddenSeries,
  onToggle,
  className
}: {
  config: ChartConfig;
  hiddenSeries: ReadonlySet<string>;
  onToggle: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {Object.entries(config).map(([key, series]) => {
        const hidden = hiddenSeries.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={!hidden}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors duration-150",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hidden ? "text-muted-foreground/50" : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn("size-2 rounded-xs transition-opacity duration-150", hidden && "opacity-25")}
              style={{ backgroundColor: series.color }}
            />
            <span className={cn(hidden && "line-through")}>{series.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// useChartSeriesToggle owns the hidden-series set so each chart does not
// re-declare it. Everything is visible until someone hides it.
export function useChartSeriesToggle() {
  const [hiddenSeries, setHiddenSeries] = React.useState<ReadonlySet<string>>(new Set());
  const toggleSeries = React.useCallback((key: string) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);
  return { hiddenSeries, toggleSeries };
}

// Shared axis/grid styling. These are objects rather than a wrapper component
// because Recharts reads <XAxis> as configuration during its own layout pass
// and silently ignores an axis it did not itself receive as a direct child.
export const CHART_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;
export const CHART_GRID_STROKE = "var(--border)";
export const CHART_CURSOR_FILL = "rgba(255, 255, 255, 0.05)";
