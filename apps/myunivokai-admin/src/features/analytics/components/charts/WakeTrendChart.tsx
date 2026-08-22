"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
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
import { serviceDisplayName } from "@/lib/service-names";
import { seriesColor } from "../../chart-config";
import type { ServiceWakeStats } from "../../types";

// Wakes per day, stacked by service.
//
// The gateway has always returned this breakdown — a `dailyWakes` map per
// service — and the fleet screen showed only the total, throwing away the
// shape. The shape is the interesting part: a flat line of one or two wakes a
// day is a free tier behaving as designed, whereas a spike on one service is
// either a crash loop or a scraper, and neither is visible in a total.
//
// Series are whichever services the gateway reports, so the config is built at
// render time rather than declared. Services that are not wakeable are left
// out entirely: they report a permanent zero for a configuration reason, and a
// permanently empty legend entry is noise.
export function WakeTrendChart({
  services,
  days,
  isLoading = false
}: {
  services: ServiceWakeStats[];
  days: number;
  isLoading?: boolean;
}) {
  const charted = services.filter((entry) => entry.wakeable || entry.totalWakes > 0);
  const config: ChartConfig = Object.fromEntries(
    charted.map((entry, index) => [entry.service, { label: serviceDisplayName(entry.service), color: seriesColor(index) }])
  );

  const rows = buildDailyRows(charted);
  const hasWakes = charted.some((entry) => entry.totalWakes > 0);
  const { hiddenSeries, toggleSeries } = useChartSeriesToggle();

  return (
    <SectionCard
      title={`Wakes per day · last ${days} days`}
      description="How often the gateway had to start a sleeping service, broken down by which one."
      action={
        charted.length > 0 ? (
          <ChartLegend config={config} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
        ) : null
      }
    >
      {isLoading ? (
        <Skeleton className="mt-4 h-[200px] rounded-lg" />
      ) : !hasWakes ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No wake was needed in this window — every service answered on its own.
        </p>
      ) : (
        <ChartContainer config={config} height={200} className="mt-4">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              minTickGap={16}
              tickFormatter={formatAxisDay}
            />
            <YAxis tickLine={false} axisLine={false} tick={CHART_TICK} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              content={<ChartTooltipContent config={config} labelFormatter={formatTooltipDay} />}
            />
            {charted
              .filter((entry) => !hiddenSeries.has(entry.service))
              .map((entry) => (
                <Bar
                  key={entry.service}
                  dataKey={entry.service}
                  stackId="wakes"
                  fill={config[entry.service].color}
                  maxBarSize={28}
                  animationDuration={400}
                />
              ))}
          </BarChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}

// The gateway keys each service's counters by UTC day and every service is
// asked for the same range, so the union of the keys is the range — sorting it
// lexically is sorting it chronologically for YYYY-MM-DD.
function buildDailyRows(services: ServiceWakeStats[]): Array<Record<string, string | number>> {
  const days = new Set<string>();
  for (const entry of services) {
    for (const day of Object.keys(entry.dailyWakes ?? {})) {
      days.add(day);
    }
  }
  return [...days].sort().map((day) => {
    const row: Record<string, string | number> = { day };
    for (const entry of services) {
      row[entry.service] = entry.dailyWakes?.[day] ?? 0;
    }
    return row;
  });
}

function formatAxisDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTooltipDay(day: unknown): string {
  if (typeof day !== "string") {
    return "";
  }
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}
