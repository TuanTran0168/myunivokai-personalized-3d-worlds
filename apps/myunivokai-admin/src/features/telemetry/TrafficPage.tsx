"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Clock, Database, Route, TriangleAlert } from "lucide-react";
import { DonutChart, type DonutSlice } from "@/components/ui/donut-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { HourOfDayChart } from "@/components/ui/hour-of-day-chart";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { formatCount, formatDateTime, formatPercent } from "@/features/analytics/format";
import { telemetryApi } from "./api";
import { ROUTE_TABLE_HEADERS, RoutesTable } from "./components/RoutesTable";
import { TelemetryShell } from "./components/TelemetryShell";
import { RequestVolumeChart } from "./components/charts/RequestVolumeChart";
import { formatBucketInstant, formatStatusClass, formatWindow } from "./format";
import { useTelemetryWindow } from "./useTelemetryWindow";

// Status classes are the one distribution on these screens that earns a donut:
// at most five named parts of one whole. The colours are fixed per class rather
// than assigned by position, so 5xx is the vermillion on every screen that
// draws it and a reader never has to check the legend to know if red is bad.
const STATUS_CLASS_COLORS: Record<number, string> = {
  1: "var(--chart-4)",
  2: "var(--chart-3)",
  3: "var(--chart-2)",
  4: "var(--chart-1)",
  5: "var(--chart-5)"
};

// How much is arriving, when, and through which routes. Deliberately NOT how
// fast it is (Performance) or how much of it failed (Reliability) — one
// question per screen is the whole reason there are three.
export function TrafficPage() {
  const [hours, setHours] = useTelemetryWindow();
  const routesQuery = useQuery({
    queryKey: ["telemetry", "routes", hours],
    queryFn: () => telemetryApi.routes(hours),
    placeholderData: keepPreviousData
  });
  const routes = routesQuery.data?.routes ?? [];

  return (
    <TelemetryShell
      title="Traffic"
      description="How much is arriving at the gateway, when it arrives, and which routes carry it."
      hours={hours}
      onHoursChange={setHours}
    >
      {(overview, isLoading) => {
        const comparison = overview?.comparison;
        const periodLabel = `the previous ${formatWindow(hours).replace("last ", "")}`;
        const statusSlices: DonutSlice[] = (overview?.statusMix ?? []).map((slice) => ({
          key: String(slice.statusClass),
          label: formatStatusClass(slice.statusClass),
          value: slice.requestCount,
          color: STATUS_CLASS_COLORS[slice.statusClass] ?? "var(--chart-4)"
        }));

        return (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Activity}
                label={`Requests · ${formatWindow(hours)}`}
                value={overview ? formatCount(overview.totalRequests) : "—"}
                hint={
                  overview?.oldestBucketStart
                    ? `data from ${formatDateTime(overview.oldestBucketStart)}`
                    : "no rollup stored yet"
                }
                delta={comparison?.requests}
                deltaHigherIsBetter
                deltaPeriodLabel={periodLabel}
              />
              <StatCard
                icon={Clock}
                label="Busiest hour"
                value={
                  overview?.peakHour
                    ? formatBucketInstant(overview.peakHour.bucketStart)
                    : overview
                      ? "—"
                      : "—"
                }
                hint={
                  overview?.peakHour
                    ? `${formatCount(overview.peakHour.requestCount)} requests in that hour`
                    : "nothing recorded in this window"
                }
              />
              <StatCard
                icon={Route}
                label="Routes hit"
                value={routesQuery.data ? formatCount(routes.length) : "—"}
                hint="one row per chi template and method"
              />
              <StatCard
                icon={TriangleAlert}
                label="Server error rate"
                value={overview ? formatPercent(overview.errorRatePercent) : "—"}
                hint={overview ? `${formatCount(overview.errorRequests)} in the 5xx class` : undefined}
                tone={overview && overview.errorRatePercent > 0 ? "warning" : "default"}
                delta={comparison?.errors}
                deltaHigherIsBetter={false}
                deltaPeriodLabel={periodLabel}
              />
            </div>

            <RequestVolumeChart
              points={overview?.hourlyPoints ?? []}
              hours={hours}
              isLoading={isLoading}
              // Hourly, not the minute series. A 7-day window holds 10,080
              // minute buckets — a chart nobody can read, drawn from a payload
              // nobody needs.
              resolution="hour"
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DonutChart
                title="Status mix"
                description="Every response the gateway sent, by class. 4xx is the client's problem and is kept out of the error rate above — not hidden, just counted separately."
                slices={statusSlices}
                isLoading={isLoading}
                formatValue={formatCount}
                centerValue={overview ? formatCount(overview.totalRequests) : undefined}
                centerLabel="responses"
                emptyLabel="Nothing reached the gateway in this window."
              />

              <HourOfDayChart
                title="When the traffic arrives"
                description="Summed across every day in the window — the recurring shape of the day, which the timeline above cannot show."
                buckets={(overview?.hourOfDay ?? []).map((bucket) => ({
                  hour: bucket.hour,
                  value: bucket.requestCount
                }))}
                peakHour={
                  overview?.peakHour
                    ? new Date(overview.peakHour.bucketStart).getUTCHours()
                    : undefined
                }
                isLoading={isLoading}
                formatValue={(value) => `${formatCount(value)} requests`}
                emptyLabel="Nothing reached the gateway in this window."
              />
            </div>

            <SectionCard
              title="Per route"
              description="One row per chi route template and method, busiest first. A world id never appears here — the template is the key, which is what keeps this table bounded by the route count rather than by traffic."
            >
              {routesQuery.isError ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="The route table is unavailable"
                  description="telemetry-service answered the overview but not this query. Narrowing the window is the usual fix."
                />
              ) : routesQuery.isLoading ? (
                <div className="mt-3">
                  <TableSkeleton columnCount={ROUTE_TABLE_HEADERS.length} headers={ROUTE_TABLE_HEADERS} />
                </div>
              ) : routes.length === 0 ? (
                <EmptyState
                  icon={Database}
                  title="No route was hit in this window"
                  description="Either nothing reached the gateway, or TELEMETRY_ENABLED is off — it is off by default, and with it off nothing is ever published."
                />
              ) : (
                <RoutesTable routes={routes} />
              )}
            </SectionCard>
          </>
        );
      }}
    </TelemetryShell>
  );
}
