"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { SearchInput } from "@/components/ui/search-input";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { analyticsApi } from "./api";
import { JobsTable, jobTableHeaders } from "./components/JobsTable";
import type { JobListFilters } from "./types";

const STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" }
];

const TABLE_HEADERS = jobTableHeaders(true);

export function JobsPage() {
  const [filters, setFilters] = useState<JobListFilters>({ family: "", status: "" });
  const pagination = useCursorPagination();

  // Same reason as the worlds table: a filter change redefines row 1, so an
  // already-taken cursor points into a different result set.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [filters, reset]);

  const jobsQuery = useQuery({
    queryKey: ["analytics", "jobs", filters, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.jobs(filters, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Generation jobs across dna, universe and nature — what failed, why, and how long it took."
        sources={["Analytics Service"]}
      />

      <FilterBar>
        <SearchInput
          value={filters.search ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, search: value }))}
          placeholder="Job id or error…"
        />
        <FilterSelect
          label="Family"
          value={filters.family ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, family: value as JobListFilters["family"] }))}
          options={[
            { label: "All families", value: "" },
            { label: "Universe", value: "universe" },
            { label: "Nature", value: "nature" }
          ]}
        />
        <FilterSelect
          label="Status"
          value={filters.status ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, status: value as JobListFilters["status"] }))}
          options={STATUS_OPTIONS}
        />
        <DateRangeFilter
          label="Submitted"
          since={filters.since ?? ""}
          until={filters.until ?? ""}
          onSinceChange={(value) => setFilters((current) => ({ ...current, since: value }))}
          onUntilChange={(value) => setFilters((current) => ({ ...current, until: value }))}
        />
      </FilterBar>
      <Card>
        <CardContent className="pt-2">
          {jobsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Jobs are unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : jobsQuery.isLoading ? (
            <TableSkeleton columnCount={TABLE_HEADERS.length} headers={TABLE_HEADERS} />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No jobs match"
              description="Jobs appear here as generations run. Try clearing the filters."
            />
          ) : (
            <>
              <JobsTable jobs={jobs} />
              <CursorPagination
                pagination={pagination}
                nextCursor={jobsQuery.data?.nextCursor}
                loadedCount={jobs.length}
                totalCount={jobsQuery.data?.totalCount ?? 0}
                isFetching={jobsQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
