"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Database, Gauge, Timer, Zap } from "lucide-react";
import { DonutChart, type DonutSlice } from "@/components/ui/donut-chart";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { LatencyPair } from "@/features/analytics/components/LatencyPair";
import { formatCount, formatDuration } from "@/features/analytics/format";
import { telemetryApi } from "./api";
import { BackendLatencyList } from "./components/BackendLatencyList";
import { CacheHitRateList } from "./components/CacheHitRateList";
import { TelemetryShell } from "./components/TelemetryShell";
import { formatWindow } from "./format";
import { useTelemetryWindow } from "./useTelemetryWindow";

// Where the time goes. Every number on this screen is a duration or a thing
// that removes one — which is why the cache lives here and not on Traffic: a
// cache hit is not a request that arrived, it is a backend round trip that
// never happened.
export function PerformancePage() {
  const [hours, setHours] = useTelemetryWindow();
  const routesQuery = useQuery({
    queryKey: ["telemetry", "routes", hours],
    queryFn: () => telemetryApi.routes(hours),
    placeholderData: keepPreviousData
  });

  // The five slowest routes by tail latency, which is a different list from
  // the five busiest — and the one that matters here.
  const slowestRoutes = [...(routesQuery.data?.routes ?? [])]
    .sort((left, right) => right.p95DurationMs - left.p95DurationMs)
    .slice(0, 5);

  return (
    <TelemetryShell
      title="Performance"
      description="Where the time goes: the median against the tail, which backend owns it, and how much work the caches remove."
      hours={hours}
      onHoursChange={setHours}
    >
      {(overview, isLoading) => {
        const comparison = overview?.comparison;
        const periodLabel = `the previous ${formatWindow(hours).replace("last ", "")}`;
        const cache = overview?.cache ?? [];
        const cacheHits = cache.reduce((sum, namespace) => sum + namespace.hits, 0);
        const cacheMisses = cache.reduce((sum, namespace) => sum + namespace.misses, 0);
        const cacheSlices: DonutSlice[] = [
          { key: "hits", label: "Served from cache", value: cacheHits, color: "var(--chart-3)" },
          { key: "misses", label: "Went to a backend", value: cacheMisses, color: "var(--chart-4)" }
        ];

        return (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Timer}
                label="p50 response time"
                value={overview ? formatDuration(overview.p50DurationMs) : "—"}
                hint="what a typical request experienced"
              />
              <StatCard
                icon={Gauge}
                label="p95 response time"
                value={overview ? formatDuration(overview.p95DurationMs) : "—"}
                hint={
                  overview?.percentileIsInterpolated
                    ? "interpolated across bucket edges"
                    : undefined
                }
                delta={comparison?.p95DurationMs}
                // A rising p95 is a regression. This is the flag that decides
                // whether the badge is green or red, and getting it backwards
                // would make every slowdown look like good news.
                deltaHigherIsBetter={false}
                deltaPeriodLabel={periodLabel}
              />
              <StatCard
                icon={Zap}
                label="Slowest single request"
                value={overview ? formatDuration(overview.slowestDurationMs) : "—"}
                hint={overview ? `mean ${formatDuration(overview.averageDurationMs)}` : undefined}
              />
              <StatCard
                icon={Database}
                label="Cache hit rate"
                value={
                  cacheHits + cacheMisses > 0
                    ? `${Math.round((cacheHits / (cacheHits + cacheMisses)) * 1000) / 10}%`
                    : "—"
                }
                hint={
                  cacheHits + cacheMisses > 0
                    ? `${formatCount(cacheHits)} of ${formatCount(cacheHits + cacheMisses)} lookups`
                    : "no lookup happened in this window"
                }
              />
            </div>

            <SectionCard
              title="Response time distribution"
              description="Every percentile here is interpolated across the contract's eight fixed histogram edges. A p95 that looks exact and is not is worse than no p95, so it says so."
            >
              {isLoading || !overview ? (
                <Skeleton className="mt-3 h-[104px] rounded-lg" />
              ) : (
                <LatencyPair
                  p50={overview.p50DurationMs}
                  p95={overview.p95DurationMs}
                  slowest={overview.slowestDurationMs}
                  average={overview.averageDurationMs}
                  interpolated={overview.percentileIsInterpolated}
                />
              )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Backend round trips"
                description="How long each service took to answer, which the HTTP route alone cannot tell apart: /api/{family}/worlds reaches universe or nature depending on the family."
              >
                {isLoading ? (
                  <Skeleton className="mt-3 h-[160px] rounded-lg" />
                ) : (overview?.backends ?? []).length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No request reached a backend service in this window.
                  </p>
                ) : (
                  <BackendLatencyList backends={overview?.backends ?? []} />
                )}
              </SectionCard>

              <DonutChart
                title="Work the caches removed"
                description="Every hit is a backend round trip that never happened. A Redis outage counts as neither a hit nor a miss, so a falling total is an outage rather than a cold cache."
                slices={cacheSlices}
                isLoading={isLoading}
                formatValue={formatCount}
                centerValue={
                  cacheHits + cacheMisses > 0
                    ? `${Math.round((cacheHits / (cacheHits + cacheMisses)) * 100)}%`
                    : undefined
                }
                centerLabel="hit rate"
                emptyLabel="No cache lookup happened in this window."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Cache hit rate by namespace"
                description="The three Redis namespaces separately — one cold namespace inside a healthy total is invisible in the donut above."
              >
                {isLoading ? (
                  <Skeleton className="mt-3 h-[120px] rounded-lg" />
                ) : cache.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">No cache lookup happened in this window.</p>
                ) : (
                  <CacheHitRateList cache={cache} />
                )}
              </SectionCard>

              <SectionCard
                title="Slowest routes"
                description="By tail latency, not by volume — the busiest route and the slowest one are rarely the same row."
              >
                {routesQuery.isLoading ? (
                  <Skeleton className="mt-3 h-[120px] rounded-lg" />
                ) : slowestRoutes.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">No route was hit in this window.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {slowestRoutes.map((route) => (
                      <li
                        key={`${route.method} ${route.routePattern}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                      >
                        <span className="min-w-0 font-mono text-xs text-foreground">
                          <span className="text-muted-foreground">{route.method}</span> {route.routePattern}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          p50 {formatDuration(route.p50DurationMs)} · p95 {formatDuration(route.p95DurationMs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </>
        );
      }}
    </TelemetryShell>
  );
}
