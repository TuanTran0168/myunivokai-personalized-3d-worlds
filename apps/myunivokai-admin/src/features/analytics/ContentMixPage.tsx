"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { analyticsApi } from "./api";
import { DistributionChart } from "./components/charts/DistributionChart";
import { FamilyMixChart } from "./components/charts/FamilyMixChart";
import { TraitRadarChart } from "./components/charts/TraitRadarChart";
import { FAILURE_DISTRIBUTION_CHART_CONFIG } from "./chart-config";
import type { WorldFamily } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const FAMILY_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: "" },
  { label: "Universe", value: "universe" },
  { label: "Nature", value: "nature" }
];

// What the generator is actually producing, separated from Overview because it
// answers a different person's question. Overview asks "is the platform
// healthy"; this asks "is the output varied, and varied in the way we
// intended" — which is a product question, not an operational one, and the two
// were competing for the same scroll.
//
// Every bar here is a link into the worlds list with that value already
// selected. A distribution nobody can drill into is a picture; one that opens
// the matching rows is a tool.
export function ContentMixPage() {
  const router = useRouter();
  const [days, setDays] = useState<number>(30);
  const [family, setFamily] = useState<"" | WorldFamily>("");

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", days, family],
    queryFn: () => analyticsApi.overview(days, family),
    placeholderData: keepPreviousData
  });
  const overview = overviewQuery.data;

  // The family filter travels with the drill-through: a bar shown under
  // "Nature" that opened an unfiltered list would answer a different question
  // from the one that was clicked.
  const openWorlds = (parameter: "archetype" | "worldStyle" | "mood", value: string) => {
    const query = new URLSearchParams({ [parameter]: value });
    if (family) {
      query.set("family", family);
    }
    router.push(`/worlds?${query.toString()}`);
  };

  return (
    <div>
      <PageHeader
        title="Content mix"
        description="What the DNA generator is producing. Select any bar to open the worlds behind it."
        sources={["Analytics Service"]}
      />

      <FilterBar>
        <FilterSelect
          label="Family"
          value={family}
          onChange={(value) => setFamily(value as "" | WorldFamily)}
          options={FAMILY_OPTIONS}
        />
        <FilterSelect
          label="Range"
          value={String(days)}
          onChange={(value) => setDays(Number(value))}
          options={RANGE_OPTIONS.map((option) => ({ label: `${option} days`, value: String(option) }))}
        />
      </FilterBar>

      {overviewQuery.isError ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={AlertTriangle}
              title="Analytics is unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4 stagger-children">
          <FamilyMixChart families={overview?.families ?? []} isLoading={overviewQuery.isLoading} />

          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionChart
              title="Top archetypes"
              description="What the DNA generator is producing most."
              slices={overview?.archetypeTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("archetype", value)}
            />
            <DistributionChart
              title="World styles"
              description="Preferred style at submission time."
              slices={overview?.worldStyleTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("worldStyle", value)}
            />
            <DistributionChart
              title="Moods"
              description="The mood the profile resolved to."
              slices={overview?.moodTop ?? []}
              isLoading={overviewQuery.isLoading}
              onSelect={(value) => openWorlds("mood", value)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TraitRadarChart
              title="Average trait scores"
              description="Mean across every projected world, not just the selected range."
              scores={overview?.averageTraitScores}
              isLoading={overviewQuery.isLoading}
            />
            {/* Failure codes get their own colour and no drill-through: the
                worlds list is not filterable by an error code, and a bar that
                looks clickable but is not is worse than one that never did. */}
            <DistributionChart
              title="Failure codes"
              description="Why generation failed, over the selected range. Not clickable — the worlds list has no filter for these."
              slices={overview?.errorCodeTop ?? []}
              isLoading={overviewQuery.isLoading}
              config={FAILURE_DISTRIBUTION_CHART_CONFIG}
              emptyLabel="No failures in this window."
            />
          </div>
        </div>
      )}
    </div>
  );
}
