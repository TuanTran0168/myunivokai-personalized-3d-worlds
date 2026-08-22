"use client";

import { Bar, BarChart, Cell, Tooltip, XAxis } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChartConfig, ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

const HOUR_CHART_CONFIG: ChartConfig = {
  value: { label: "Volume", color: "var(--chart-1)" }
};

export interface HourBucketLike {
  hour: number;
  value: number;
}

// Twenty-four bars, one per hour of the day, summed across every day in the
// window. This is the chart the timeline cannot replace: a timeline says "it
// was busy on Tuesday afternoon", and this says "it is busy every afternoon" —
// which is the one that decides when a deploy is cheap.
//
// Both services return only the hours that saw traffic. The missing ones are
// filled with explicit zeroes HERE rather than in SQL, because a 24-slot axis
// is a rendering decision: a gap in the middle of the day would otherwise read
// as a narrower day rather than as a quiet hour.
export function HourOfDayChart({
  title,
  description,
  buckets,
  peakHour,
  isLoading = false,
  formatValue,
  emptyLabel = "Nothing was recorded in this window."
}: {
  title: string;
  description?: string;
  buckets: HourBucketLike[];
  /** Highlighted in the accent colour; every other bar is muted. */
  peakHour?: number;
  isLoading?: boolean;
  formatValue: (value: number) => string;
  emptyLabel?: string;
}) {
  const byHour = new Map(buckets.map((bucket) => [bucket.hour, bucket.value]));
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    value: byHour.get(hour) ?? 0
  }));
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <SectionCard
      title={title}
      description={description}
      // UTC is stated on the chart, not converted away. Two operators in two
      // countries have to be able to quote the same number to each other.
      action={<span className="font-mono text-[11px] text-muted-foreground">UTC</span>}
    >
      {isLoading ? (
        <Skeleton className="mt-3 h-[140px] rounded-lg" />
      ) : total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ChartContainer config={HOUR_CHART_CONFIG} height={140} className="mt-2">
          <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              minTickGap={16}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  config={HOUR_CHART_CONFIG}
                  labelFormatter={(label) => `${String(label ?? "")} UTC`}
                  valueFormatter={(value) => formatValue(value)}
                />
              }
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} animationDuration={500}>
              {points.map((point) => (
                <Cell
                  key={point.hour}
                  fill={point.hour === peakHour ? "var(--chart-1)" : "var(--chart-4)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}
