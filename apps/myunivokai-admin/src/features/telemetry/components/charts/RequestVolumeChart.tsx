"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TICK,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltipContent,
  useChartSeriesToggle
} from "@/components/ui/chart";
import { formatBucketInstant, formatBucketTime, formatWindow } from "../../format";
import type { TelemetryVolumePoint } from "../../types";

const VOLUME_CHART_CONFIG: ChartConfig = {
  requestCount: { label: "Requests", color: "var(--chart-1)" },
  errorCount: { label: "5xx", color: "var(--chart-5)" }
};

// Request volume over time, with server errors drawn underneath.
//
// `resolution` names which series was handed in, because the two are the same
// SHAPE and a different FACT. The minute series is the raw rollup interval —
// complete, and 10,080 points over a week. The hourly series is the same
// traffic grouped by telemetry-service, which is what a trend line should be
// drawn from. Labelling the axis "per minute" while plotting hours is the kind
// of error a reader cannot catch from the picture.
//
// The axis shows clock time rather than a date either way: a 24-hour window at
// minute resolution is 1440 points and a date on every tick is unreadable. The
// tooltip carries the full instant.
export function RequestVolumeChart({
  points,
  hours,
  isLoading = false,
  resolution = "minute"
}: {
  points: TelemetryVolumePoint[];
  hours: number;
  isLoading?: boolean;
  resolution?: "minute" | "hour";
}) {
  const { hiddenSeries, toggleSeries } = useChartSeriesToggle();
  const hasTraffic = points.some((point) => point.requestCount > 0);

  return (
    <SectionCard
      title={`Requests per ${resolution} · ${formatWindow(hours)}`}
      description={
        resolution === "hour"
          ? "One point per hour, grouped by telemetry-service from the minute-wide rollups underneath. A complete count, not a sample."
          : "One point per rollup interval. The gateway aggregates in memory and publishes one summary per minute, so this is a complete count rather than a sample."
      }
      action={<ChartLegend config={VOLUME_CHART_CONFIG} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />}
    >
      {isLoading ? (
        <Skeleton className="mt-4 h-[220px] rounded-lg" />
      ) : !hasTraffic ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No rollup covers this window. Either the gateway served nothing, or telemetry has not been switched on for
          it — TELEMETRY_ENABLED is off by default.
        </p>
      ) : (
        <ChartContainer config={VOLUME_CHART_CONFIG} height={220} className="mt-4">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucketStart"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              minTickGap={40}
              tickFormatter={formatBucketTime}
            />
            <YAxis tickLine={false} axisLine={false} tick={CHART_TICK} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              content={<ChartTooltipContent config={VOLUME_CHART_CONFIG} labelFormatter={formatBucketInstant} />}
            />
            {!hiddenSeries.has("requestCount") ? (
              <Area
                type="monotone"
                dataKey="requestCount"
                stroke={VOLUME_CHART_CONFIG.requestCount.color}
                fill={VOLUME_CHART_CONFIG.requestCount.color}
                fillOpacity={0.18}
                strokeWidth={2}
                animationDuration={400}
              />
            ) : null}
            {!hiddenSeries.has("errorCount") ? (
              <Area
                type="monotone"
                dataKey="errorCount"
                stroke={VOLUME_CHART_CONFIG.errorCount.color}
                fill={VOLUME_CHART_CONFIG.errorCount.color}
                fillOpacity={0.28}
                strokeWidth={2}
                animationDuration={400}
              />
            ) : null}
          </AreaChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}
