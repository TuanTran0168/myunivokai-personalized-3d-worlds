"use client";

import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TICK,
  ChartContainer,
  ChartLegend,
  ChartTooltipContent,
  useChartSeriesToggle
} from "@/components/ui/chart";
import { ACTIVITY_CHART_CONFIG } from "../../chart-config";
import type { TimeseriesPoint } from "../../types";

// Four series over up to 90 days, drawn as a composed chart so each one gets
// the geometry that reads best for it: worlds as a filled area (a volume),
// published and jobs as lines (trends compared against that volume), failures
// as bars (discrete events that should stand out rather than blend in).
//
// This replaces a hand-drawn SVG of two bar series. That version had a
// standing note saying to revisit it if a screen ever needed real axes,
// brushing, or a tooltip that follows the cursor. All three are here now: the
// brush selects a sub-range without refetching, the tooltip reads every series
// for one day at once, and the legend switches a series off — which is the
// only practical way to compare two lines when a third dwarfs both.
export function ActivityChart({
  points,
  isLoading
}: {
  points: TimeseriesPoint[];
  isLoading: boolean;
}) {
  const { hiddenSeries, toggleSeries } = useChartSeriesToggle();
  const hasActivity = points.some(
    (point) => point.worldCount > 0 || point.jobCount > 0 || point.failedJobCount > 0
  );

  return (
    <SectionCard
      title="Daily activity"
      description="Worlds, publishes and job outcomes per day. Drag the strip below the axis to narrow the range."
      action={
        <ChartLegend config={ACTIVITY_CHART_CONFIG} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      }
    >
      {isLoading ? (
        <Skeleton className="mt-4 h-[260px] rounded-lg" />
      ) : !hasActivity ? (
        <p className="mt-4 text-xs text-muted-foreground">No activity recorded in this window yet.</p>
      ) : (
        <ChartContainer config={ACTIVITY_CHART_CONFIG} height={260} className="mt-4">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="activity-worlds-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-worldCount)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--color-worldCount)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              minTickGap={28}
              tickFormatter={formatAxisDay}
            />
            <YAxis tickLine={false} axisLine={false} tick={CHART_TICK} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              content={
                <ChartTooltipContent config={ACTIVITY_CHART_CONFIG} labelFormatter={formatTooltipDay} />
              }
            />
            {hiddenSeries.has("worldCount") ? null : (
              <Area
                type="monotone"
                dataKey="worldCount"
                stroke="var(--color-worldCount)"
                strokeWidth={2}
                fill="url(#activity-worlds-fill)"
                activeDot={{ r: 3 }}
                animationDuration={400}
              />
            )}
            {hiddenSeries.has("publishedCount") ? null : (
              <Line
                type="monotone"
                dataKey="publishedCount"
                stroke="var(--color-publishedCount)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                animationDuration={400}
              />
            )}
            {hiddenSeries.has("jobCount") ? null : (
              <Line
                type="monotone"
                dataKey="jobCount"
                stroke="var(--color-jobCount)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 3 }}
                animationDuration={400}
              />
            )}
            {hiddenSeries.has("failedJobCount") ? null : (
              <Bar
                dataKey="failedJobCount"
                fill="var(--color-failedJobCount)"
                radius={[3, 3, 0, 0]}
                maxBarSize={14}
                animationDuration={400}
              />
            )}
            {/* The brush is only useful once there are more days than fit
                comfortably; below that it is a second control competing with
                the range filter in the page header for the same job. */}
            {points.length > 14 ? (
              <Brush
                dataKey="day"
                height={22}
                travellerWidth={8}
                stroke={CHART_GRID_STROKE}
                fill="transparent"
                tickFormatter={formatAxisDay}
              />
            ) : null}
          </ComposedChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}

function formatAxisDay(day: string): string {
  return new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTooltipDay(day: unknown): string {
  if (typeof day !== "string") {
    return "";
  }
  return new Date(day).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
