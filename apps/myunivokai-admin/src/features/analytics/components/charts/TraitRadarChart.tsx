"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from "recharts";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_GRID_STROKE, CHART_TICK, ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { TRAIT_CHART_CONFIG } from "../../chart-config";
import type { TraitScores } from "../../types";

const TRAIT_LABELS: Array<[keyof TraitScores, string]> = [
  ["creativity", "Creativity"],
  ["discipline", "Discipline"],
  ["curiosity", "Curiosity"],
  ["energy", "Energy"],
  ["focus", "Focus"]
];

// Five traits on a fixed 0-100 scale is the one shape a radar is actually
// right for: the question is the balance between the axes, not the size of any
// one of them, and five separate bars force the reader to do that comparison
// in their head. The radius axis is pinned to 0-100 rather than fitted to the
// data, so a flat-looking pentagon means the population really is balanced
// instead of the chart having rescaled itself.
export function TraitRadarChart({
  title,
  description,
  scores,
  isLoading = false
}: {
  title: string;
  description?: string;
  scores?: TraitScores;
  isLoading?: boolean;
}) {
  const data = scores
    ? TRAIT_LABELS.map(([key, label]) => ({ trait: label, score: scores[key] }))
    : [];

  return (
    <SectionCard title={title} description={description}>
      {isLoading || !scores ? (
        <Skeleton className="mt-4 h-[220px] rounded-lg" />
      ) : (
        <ChartContainer config={TRAIT_CHART_CONFIG} height={220} className="mt-2">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke={CHART_GRID_STROKE} />
            <PolarAngleAxis dataKey="trait" tick={CHART_TICK} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip content={<ChartTooltipContent config={TRAIT_CHART_CONFIG} hideIndicator />} />
            <Radar
              dataKey="score"
              stroke="var(--color-score)"
              strokeWidth={2}
              fill="var(--color-score)"
              fillOpacity={0.22}
              animationDuration={400}
            />
          </RadarChart>
        </ChartContainer>
      )}
    </SectionCard>
  );
}
