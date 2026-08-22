"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsApi } from "./api";
import { RarityFeatureCard } from "./components/RarityFeatureCard";
import { formatCount } from "./format";
import type { WorldFamily } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const FAMILY_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: "" },
  { label: "Universe", value: "universe" },
  { label: "Nature", value: "nature" }
];

// "The black hole is tuned to 40% — how often does it actually come up?"
//
// Nothing stored anywhere could answer that before this screen. A rare feature
// is never persisted: the renderer re-derives it from the world's variant seed
// every time it draws. So analytics-service carries the seed across the data
// boundary and REPLAYS the same lottery over the seeds of real worlds — which
// is why the number here can differ from the configured one. Reading the config
// back out would answer a different question: what the generator was aimed at,
// not what it hit.
//
// This is its own screen rather than a section of Content mix because it is the
// one panel here whose numbers are mostly noise until the population is large,
// and a panel that needs a paragraph about sample size does not belong wedged
// between two distributions that do not.
export function RarityPage() {
  const [days, setDays] = useState<number>(30);
  const [family, setFamily] = useState<"" | WorldFamily>("");

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", days, family],
    queryFn: () => analyticsApi.overview(days, family),
    placeholderData: keepPreviousData
  });
  const rarity = overviewQuery.data?.rarity;
  const features = rarity?.features ?? [];

  // One scale across every bar, so the panel reads as a comparison between
  // features and not five unrelated pictures. Padded above the largest value
  // present, never below the loudest configured rate, so re-tuning a feature
  // cannot make its own target fall off the end of its own bar.
  const scaleMaxPercent = Math.max(
    5,
    ...features.map((feature) => Math.max(feature.configuredPercent, feature.observedPercent) * 1.15)
  );

  return (
    <div>
      <PageHeader
        title="Rarity"
        description="How often each rare feature actually comes up, replayed from the seeds of real worlds — not read back from the configured probability."
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
          {/* Stated up front, not in a footnote. Worlds generated before the
              seed crossed the data boundary cannot have their lottery replayed
              at all, and a reader who took them for misses would conclude every
              rate is running low. */}
          {rarity && rarity.unmeasuredWorlds > 0 ? (
            <Card>
              <CardContent className="flex items-start gap-2.5 pt-2">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs text-muted-foreground">
                  {formatCount(rarity.unmeasuredWorlds)} world
                  {rarity.unmeasuredWorlds === 1 ? "" : "s"} in this window carry no seed and are in
                  none of the counts below. They were projected before rarity tracking shipped —
                  their lottery cannot be replayed, which is not the same as having rolled nothing.
                  Each one rejoins the numbers the next time its world changes.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {overviewQuery.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-[190px] rounded-2xl" />
              ))}
            </div>
          ) : features.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Info}
                  title="No rare feature applies here"
                  description="This family has no rarity lotteries, or nothing has been generated in the selected range."
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {features.map((feature) => (
                <RarityFeatureCard
                  key={feature.key}
                  feature={feature}
                  scaleMaxPercent={scaleMaxPercent}
                  // The family travels with the drill-through so the list
                  // answers the same question the card did. The date range does
                  // NOT: the worlds list bounds on calendar days and this panel
                  // on a rolling window, and pretending they are the same bound
                  // would hand over a list whose count disagrees with the card
                  // it came from.
                  worldsHref={`/worlds?rareFeature=${encodeURIComponent(feature.key)}${
                    family ? `&family=${family}` : `&family=${feature.family}`
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
