import type { ChartConfig } from "@/components/ui/chart";

// Series definitions shared by the analytics charts. They are declared once
// here so "worlds" is the same brass in the activity chart, the family mix and
// any chart added later — a legend that means one thing on one screen and
// something else on the next is worse than no legend.
//
// The values are the --chart-1..5 tokens from globals.css, not hex literals.
export const ACTIVITY_CHART_CONFIG: ChartConfig = {
  worldCount: { label: "Worlds created", color: "var(--chart-1)" },
  publishedCount: { label: "Published", color: "var(--chart-3)" },
  jobCount: { label: "Jobs run", color: "var(--chart-2)" },
  failedJobCount: { label: "Failed jobs", color: "var(--chart-5)" }
};

export const FAMILY_CHART_CONFIG: ChartConfig = {
  universe: { label: "Universe", color: "var(--chart-2)" },
  nature: { label: "Nature", color: "var(--chart-3)" }
};

export const DISTRIBUTION_CHART_CONFIG: ChartConfig = {
  count: { label: "Worlds", color: "var(--chart-1)" }
};

export const FAILURE_DISTRIBUTION_CHART_CONFIG: ChartConfig = {
  count: { label: "Failures", color: "var(--chart-5)" }
};

export const TRAIT_CHART_CONFIG: ChartConfig = {
  score: { label: "Average score", color: "var(--chart-1)" }
};

// The fleet chart cannot have a fixed config: its series are whichever
// services the gateway reports, which is a deployment fact rather than a
// design decision. Colours are assigned by position from the same five tokens
// and wrap, which is fine — this chart is read alongside a labelled legend.
export const SERIES_COLOR_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)"
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLOR_TOKENS[index % SERIES_COLOR_TOKENS.length];
}
