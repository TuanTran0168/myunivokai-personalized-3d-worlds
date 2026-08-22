"use client";

import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TICK,
  type ChartConfig,
  ChartContainer,
  ChartTooltipContent
} from "@/components/ui/chart";
import { DISTRIBUTION_CHART_CONFIG } from "../../chart-config";
import type { DistributionSlice } from "../../types";

// A horizontal bar chart for the top-N distributions. Horizontal because the
// categories are words of unpredictable length — "cosmic-galaxy" against a
// vertical axis either wraps or gets cut, and a rotated label is unreadable at
// this size.
//
// onSelect makes the chart a control rather than a picture: clicking a bar on
// the dashboard opens the worlds list already filtered to that value, which is
// the question anyone asks immediately after seeing the bar. A chart without
// it is still correct, so onSelect is optional and the cursor only changes
// where there is somewhere to go.
export function DistributionChart({
  title,
  description,
  slices,
  isLoading = false,
  config = DISTRIBUTION_CHART_CONFIG,
  emptyLabel = "No data in this window.",
  onSelect
}: {
  title: string;
  description?: string;
  slices: DistributionSlice[];
  isLoading?: boolean;
  config?: ChartConfig;
  emptyLabel?: string;
  onSelect?: (value: string) => void;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  // 30px a row keeps the bars legible at any count; a fixed height would give
  // three categories the same space as eight and leave one of them wrong.
  const height = Math.max(120, slices.length * 30 + 24);

  return (
    <SectionCard title={title} description={description}>
      {isLoading ? (
        <Skeleton className="mt-4 h-[140px] rounded-lg" />
      ) : slices.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ChartContainer config={config} height={height} className="mt-4">
          <BarChart data={slices} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={CHART_TICK} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="value"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              width={104}
            />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              content={
                <ChartTooltipContent
                  config={config}
                  valueFormatter={(value) =>
                    total === 0
                      ? value.toLocaleString()
                      : `${value.toLocaleString()} · ${((value / total) * 100).toFixed(1)}%`
                  }
                />
              }
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18} animationDuration={400}>
              {slices.map((slice) => (
                <Cell
                  key={slice.value}
                  fill="var(--color-count)"
                  className={onSelect ? "cursor-pointer" : undefined}
                  onClick={onSelect ? () => onSelect(slice.value) : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}
