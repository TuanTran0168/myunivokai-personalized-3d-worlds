"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Clock, Gauge, Globe2, Send, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { FunnelChart } from "@/components/ui/funnel-chart";
import { HourOfDayChart } from "@/components/ui/hour-of-day-chart";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { analyticsApi } from "./api";
import { ActivityChart } from "./components/charts/ActivityChart";
import { LatencyPair } from "./components/LatencyPair";
import { formatCount, formatDate, formatPercent } from "./format";
import type { WorldFamily } from "./types";

const RANGE_OPTIONS = [7, 30, 90] as const;
const FAMILY_OPTIONS: { label: string; value: "" | WorldFamily }[] = [
  { label: "All families", value: "" },
  { label: "Universe", value: "universe" },
  { label: "Nature", value: "nature" }
];

// The business landing screen: is the platform producing, is production
// healthy, and is today different from yesterday.
//
// It used to also carry every distribution chart, the family mix and the trait
// radar — eleven panels answering two unrelated questions on one scroll. Those
// moved to Content mix, which is a question about the GENERATOR's output; this
// page is a question about VOLUME and HEALTH. Splitting them is the difference
// between a screen you scan in five seconds and one you scroll.
export function OverviewPage() {
  const [days, setDays] = useState<number>(30);
  const [family, setFamily] = useState<"" | WorldFamily>("");

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", days, family],
    queryFn: () => analyticsApi.overview(days, family),
    placeholderData: keepPreviousData
  });
  const timeseriesQuery = useQuery({
    queryKey: ["analytics", "timeseries", days, family],
    queryFn: () => analyticsApi.timeseries(days, family),
    placeholderData: keepPreviousData
  });

  const overview = overviewQuery.data;
  const health = overview?.jobHealth;
  const comparison = overview?.comparison;
  // The comparison window is a fixed day on each side, independent of the
  // range picker. Saying so on every badge is the difference between a reader
  // trusting the number and a reader assuming it tracks the picker above it.
  const periodLabel = comparison
    ? comparison.periodHours === 24
      ? "the previous 24 hours"
      : `the previous ${comparison.periodHours} hours`
    : "the previous period";

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Eventually consistent — a world appears here seconds after it is created."
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overviewQuery.isLoading || !overview || !health ? (
              [0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[86px] rounded-2xl" />)
            ) : (
              <>
                <StatCard
                  icon={Globe2}
                  label="Worlds"
                  value={formatCount(overview.totalWorlds)}
                  hint={`${formatCount(comparison?.worlds.current ?? 0)} in the last ${comparison?.periodHours ?? 24}h`}
                  delta={comparison?.worlds}
                  deltaHigherIsBetter
                  deltaPeriodLabel={periodLabel}
                />
                <StatCard
                  icon={Send}
                  label="Published"
                  value={formatCount(overview.totalPublished)}
                  hint={`${formatPercent(health.publishRatePercent)} of all worlds`}
                  delta={comparison?.publishedWorlds}
                  deltaHigherIsBetter
                  deltaPeriodLabel={periodLabel}
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Job failure rate"
                  value={formatPercent(health.failureRatePercent)}
                  hint={`${formatCount(health.failedJobs)} of ${formatCount(health.totalJobs)} jobs · ${days}d`}
                  tone={health.failureRatePercent > 0 ? "warning" : "default"}
                  delta={comparison?.failedJobs}
                  // Fewer failures is the good direction, which is the whole
                  // reason this flag is required rather than defaulted.
                  deltaHigherIsBetter={false}
                  deltaPeriodLabel={periodLabel}
                />
                <StatCard
                  icon={Gauge}
                  label="Jobs run"
                  value={formatCount(health.totalJobs)}
                  hint={`${formatCount(health.inFlightJobs)} in flight now`}
                  delta={comparison?.jobs}
                  deltaHigherIsBetter
                  deltaPeriodLabel={periodLabel}
                />
              </>
            )}
          </div>

          <ActivityChart points={timeseriesQuery.data?.points ?? []} isLoading={timeseriesQuery.isLoading} />

          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelChart
              title="Generation funnel"
              description={`Of the jobs submitted in the last ${days} days, how many reached each stage. Every share is of the first stage, not the one before it.`}
              stages={overview?.generationFunnel ?? []}
              isLoading={overviewQuery.isLoading}
              formatCount={formatCount}
              emptyLabel="No job was submitted in this window."
            />

            <HourOfDayChart
              title="When jobs are submitted"
              description="Summed across every day in the window — the recurring shape of the day, not one busy afternoon."
              buckets={(overview?.hourOfDay ?? []).map((bucket) => ({
                hour: bucket.hour,
                value: bucket.jobCount
              }))}
              peakHour={overview?.peakHour?.hour}
              isLoading={overviewQuery.isLoading}
              formatValue={(value) => `${formatCount(value)} jobs`}
              emptyLabel="No job was submitted in this window."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Job duration"
              description="Exact percentiles over every finished job — analytics-service has each job's own duration, so nothing here is interpolated."
            >
              {overviewQuery.isLoading || !health ? (
                <Skeleton className="mt-3 h-[72px] rounded-lg" />
              ) : (
                <>
                  <LatencyPair
                    p50={health.p50DurationMs}
                    p95={health.p95DurationMs}
                    slowest={health.slowestDurationMs}
                    average={health.averageDurationMs}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Measured over {formatCount(health.measuredJobCount)} finished jobs.
                  </p>
                </>
              )}
            </SectionCard>

            <SectionCard
              title="Peak hour"
              description="The busiest hour of the day across the selected range."
              action={
                <Link
                  href="/content"
                  className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:text-accent-foreground"
                >
                  Content mix
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              }
            >
              {overviewQuery.isLoading ? (
                <Skeleton className="mt-3 h-[72px] rounded-lg" />
              ) : !overview?.peakHour ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  No job was submitted in this window, so there is no busiest hour to report.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                  <Figure
                    icon={Clock}
                    label="Busiest hour"
                    value={`${String(overview.peakHour.hour).padStart(2, "0")}:00 UTC`}
                    hint={`${formatCount(overview.peakHour.jobCount)} jobs submitted`}
                  />
                  <Figure
                    icon={Timer}
                    label="Multi-variant worlds"
                    value={health ? formatPercent(health.multiVariantPercent) : "—"}
                  />
                  <Figure
                    icon={Globe2}
                    label="Oldest projected world"
                    value={overview.oldestProjectedWorld ? formatDate(overview.oldestProjectedWorld) : "—"}
                  />
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
  hint
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 truncate font-heading text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
