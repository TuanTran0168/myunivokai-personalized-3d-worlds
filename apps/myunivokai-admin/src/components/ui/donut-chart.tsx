"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChartConfig, ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

const DONUT_CONFIG: ChartConfig = {
  value: { label: "Count", color: "var(--chart-1)" }
};

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

// A donut with its own legend, for the one question a donut answers well:
// "what is this made of", where the parts are few and named.
//
// Deliberately not offered for the distribution charts. A pie with eight
// archetype slices is unreadable next to eight bars sorted by size, and the
// only reason to reach for one there is that pies look busy. Status classes
// (at most five) and cache outcomes (two) are the shapes that earn it.
//
// The legend carries the raw count beside every percentage, because a slice
// alone cannot say whether 40% is four requests or four hundred thousand.
export function DonutChart({
  title,
  description,
  slices,
  isLoading = false,
  emptyLabel = "Nothing recorded in this window.",
  centerLabel,
  centerValue,
  formatValue
}: {
  title: string;
  description?: string;
  slices: DonutSlice[];
  isLoading?: boolean;
  emptyLabel?: string;
  centerLabel?: string;
  centerValue?: string;
  formatValue: (value: number) => string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <SectionCard title={title} description={description}>
      {isLoading ? (
        <Skeleton className="mt-3 h-[180px] rounded-lg" />
      ) : total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,160px)_1fr]">
          <div className="relative">
            <ChartContainer config={DONUT_CONFIG} height={160}>
              <PieChart>
                <Tooltip
                  content={
                    <ChartTooltipContent
                      config={DONUT_CONFIG}
                      hideIndicator
                      labelFormatter={(label) => String(label ?? "")}
                      valueFormatter={(value) =>
                        `${formatValue(value)} · ${Math.round((value / total) * 1000) / 10}%`
                      }
                    />
                  }
                />
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="60%"
                  outerRadius="88%"
                  paddingAngle={2}
                  strokeWidth={0}
                  animationDuration={450}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.key} fill={slice.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            {centerValue ? (
              // Pointer events off so the ring underneath stays hoverable.
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-heading text-lg font-semibold tabular-nums text-foreground">
                  {centerValue}
                </span>
                {centerLabel ? (
                  <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
                ) : null}
              </div>
            ) : null}
          </div>

          <ul className="flex flex-col gap-1.5">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate text-xs text-foreground">{slice.label}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatValue(slice.value)}
                  <span className="ml-1.5 text-[11px]">
                    {Math.round((slice.value / total) * 1000) / 10}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
