"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, MoonStar, Power, Server, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { SectionCard } from "@/components/ui/section-card";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { serviceDisplayName } from "@/lib/service-names";
import { analyticsApi } from "./api";
import { StatCard } from "@/components/ui/stat-card";
import { SERVICE_START_HEADERS, ServiceStartsTable } from "./components/ServiceStartsTable";
import { WakeRow } from "./components/WakeRow";
import { WakeTrendChart } from "./components/charts/WakeTrendChart";
import { formatCount } from "./format";

const WAKE_STATS_DAYS = 7;

export function FleetPage() {
  const [service, setService] = useState("");
  const pagination = useCursorPagination();

  // Same reason as the worlds table: a cursor names a position in one
  // particular result set, so changing the filter invalidates every cursor
  // already taken.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [service, reset]);

  const wakeQuery = useQuery({
    queryKey: ["analytics", "wake-stats", WAKE_STATS_DAYS],
    queryFn: () => analyticsApi.wakeStats(WAKE_STATS_DAYS)
  });
  const startsQuery = useQuery({
    queryKey: ["analytics", "service-starts", service, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.serviceStarts(service, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const wake = wakeQuery.data;
  const starts = startsQuery.data?.starts ?? [];
  const strandedServices = wake?.services.filter((entry) => entry.consecutiveFailedWakes > 0) ?? [];

  // The service filter is built from what the fleet actually reports rather
  // than from a hardcoded list, so a service added later appears here without
  // anyone remembering to edit this file.
  const serviceOptions = [
    { label: "All services", value: "" },
    ...(wake?.services ?? []).map((entry) => ({ label: serviceDisplayName(entry.service), value: entry.service }))
  ];

  return (
    <div>
      <PageHeader
        title="Fleet"
        description="Which services have restarted, and which ones the gateway has been unable to wake."
        sources={["API Gateway", "Analytics Service"]}
      />

      <FilterBar>
        <FilterSelect label="Service" value={service} onChange={setService} options={serviceOptions} />
      </FilterBar>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Power}
          label="Wake platform"
          value={wake?.platform.name ?? "—"}
          hint={wake ? `${wake.platform.wakeableServiceCount} service(s) wakeable` : undefined}
        />
        <StatCard
          icon={MoonStar}
          label={`Wakes sent · ${WAKE_STATS_DAYS}d`}
          value={wake ? formatCount(wake.services.reduce((total, entry) => total + entry.totalWakes, 0)) : "—"}
          hint={wake ? `retry hint ${wake.platform.retryAfterSeconds}s` : undefined}
        />
        <StatCard
          icon={TriangleAlert}
          label="Services not answering"
          value={wake ? String(strandedServices.length) : "—"}
          hint={strandedServices.map((entry) => serviceDisplayName(entry.service)).join(", ") || "all answering"}
          tone={strandedServices.length > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={Server}
          label="Restarts recorded"
          value={startsQuery.data ? formatCount(startsQuery.data.totalCount) : "—"}
          hint={service ? `filtered to ${service}` : "across every service"}
        />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {wakeQuery.isError ? (
          <Card>
            <CardContent className="pt-2">
              <EmptyState
                icon={AlertTriangle}
                title="Wake statistics are unavailable"
                description="The gateway could not read them. They live in Redis, so this is a gateway-side dependency, not analytics-service."
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <WakeTrendChart
              services={wake?.services ?? []}
              days={WAKE_STATS_DAYS}
              isLoading={wakeQuery.isLoading}
            />

            <SectionCard
              title={`Wake status · last ${WAKE_STATS_DAYS} days`}
              description="One row per service the gateway knows how to start."
            >
              {wakeQuery.isLoading ? (
                <div className="mt-3 flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-full rounded-md" />
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {(wake?.services ?? []).map((entry) => (
                    <WakeRow key={entry.service} stats={entry} />
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        )}

        <SectionCard
          title="Restart history"
          description="Every process announces its own boot, with the build it is running and how long it took to be ready."
        >
          {startsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Restart history is unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : startsQuery.isLoading ? (
            <div className="mt-3">
              <TableSkeleton columnCount={SERVICE_START_HEADERS.length} headers={SERVICE_START_HEADERS} />
            </div>
          ) : starts.length === 0 ? (
            <EmptyState
              icon={Server}
              title="No restarts recorded"
              description="Every service announces its own boot. An empty list means nothing has started since this table was created."
            />
          ) : (
            <>
              <ServiceStartsTable starts={starts} />
              <CursorPagination
                pagination={pagination}
                nextCursor={startsQuery.data?.nextCursor}
                loadedCount={starts.length}
                totalCount={startsQuery.data?.totalCount ?? 0}
                isFetching={startsQuery.isFetching}
              />
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
