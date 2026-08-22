"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Globe2, X } from "lucide-react";
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
import { WORLD_TABLE_HEADERS, WorldsTable } from "./components/WorldsTable";
import type { WorldListFilters } from "./types";

// The style list mirrors contracts/go's allowedWorldStyles. A style that
// exists in data but not here is still reachable — it just is not offered as
// a one-click filter.
const STYLE_OPTIONS = [
  { label: "All styles", value: "" },
  { label: "Cosmic galaxy", value: "cosmic-galaxy" },
  { label: "Nebula", value: "nebula" },
  { label: "Crystal", value: "crystal" },
  { label: "Aurora", value: "aurora" },
  { label: "Cyber orbit", value: "cyber-orbit" }
];

export function WorldsPage() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<WorldListFilters>(() => filtersFromQuery(searchParams));
  const pagination = useCursorPagination();

  // Changing a filter changes what row 1 is, so every cursor already taken
  // points into a different result set. Resetting is not a nicety — resuming
  // from a stale cursor silently skips rows.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [filters, reset]);

  const worldsQuery = useQuery({
    queryKey: ["analytics", "worlds", filters, pagination.pageSize, pagination.cursor],
    queryFn: () => analyticsApi.worlds(filters, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const worlds = worldsQuery.data?.worlds ?? [];

  return (
    <div>
      <PageHeader
        title="Worlds"
        description="Every generated world, newest first, projected from universe and nature events."
        sources={["Analytics Service"]}
      />

      <FilterBar>
        <SearchInput
          value={filters.search ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, search: value }))}
          placeholder="Nickname…"
        />
        <FilterSelect
          label="Family"
          value={filters.family ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, family: value as WorldListFilters["family"] }))}
          options={[
            { label: "All families", value: "" },
            { label: "Universe", value: "universe" },
            { label: "Nature", value: "nature" }
          ]}
        />
        <FilterSelect
          label="Style"
          value={filters.worldStyle ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, worldStyle: value }))}
          options={STYLE_OPTIONS}
        />
        <FilterSelect
          label="Published"
          value={filters.published ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, published: value as WorldListFilters["published"] }))}
          options={[
            { label: "Any", value: "" },
            { label: "Published", value: "true" },
            { label: "Private", value: "false" }
          ]}
        />
        <DateRangeFilter
          label="Created"
          since={filters.since ?? ""}
          until={filters.until ?? ""}
          onSinceChange={(value) => setFilters((current) => ({ ...current, since: value }))}
          onUntilChange={(value) => setFilters((current) => ({ ...current, until: value }))}
        />
      </FilterBar>

      {/* Archetype, mood and rare feature arrive from a chart on another
          screen rather than from a picker here, so they need somewhere visible
          to live — otherwise the list is filtered by something the page never
          mentions, which reads as missing rows. */}
      <ActiveChips
        filters={filters}
        onClear={(key) => setFilters((current) => ({ ...current, [key]: "" }))}
      />

      <Card>
        <CardContent className="pt-2">
          {worldsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Worlds are unavailable"
              description="analytics-service did not answer. It may be starting up, or the gateway may be unable to reach it."
            />
          ) : worldsQuery.isLoading ? (
            <TableSkeleton columnCount={WORLD_TABLE_HEADERS.length} headers={WORLD_TABLE_HEADERS} />
          ) : worlds.length === 0 ? (
            <EmptyState
              icon={Globe2}
              title="No worlds match"
              description="Worlds appear here seconds after they are generated. Try clearing the filters."
            />
          ) : (
            <>
              <WorldsTable worlds={worlds} />
              <CursorPagination
                pagination={pagination}
                nextCursor={worldsQuery.data?.nextCursor}
                loadedCount={worlds.length}
                totalCount={worldsQuery.data?.totalCount ?? 0}
                isFetching={worldsQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Read once, into state, rather than kept in the URL: the toolbar selects are
// already local state, and driving half the filters from the URL and half from
// state would leave the two able to disagree. The query string is an entry
// point here, not the source of truth.
function filtersFromQuery(searchParams: URLSearchParams | null): WorldListFilters {
  const family = searchParams?.get("family");
  const published = searchParams?.get("published");
  return {
    family: family === "universe" || family === "nature" ? family : "",
    archetype: searchParams?.get("archetype") ?? "",
    worldStyle: searchParams?.get("worldStyle") ?? "",
    mood: searchParams?.get("mood") ?? "",
    published: published === "true" || published === "false" ? published : "",
    rareFeature: searchParams?.get("rareFeature") ?? "",
    since: searchParams?.get("since") ?? "",
    until: searchParams?.get("until") ?? ""
  };
}

// Filters that arrive from a chart on another screen rather than from a picker
// on this one. They get a chip so the list never quietly excludes rows for a
// reason the page does not state — which reads as missing data, not as a
// filter.
const CHIP_LABELS: Array<[keyof WorldListFilters, string]> = [
  ["archetype", "Archetype"],
  ["mood", "Mood"],
  ["rareFeature", "Rare feature"]
];

function ActiveChips({
  filters,
  onClear
}: {
  filters: WorldListFilters;
  onClear: (key: keyof WorldListFilters) => void;
}) {
  const active = CHIP_LABELS.filter(([key]) => Boolean(filters[key]));
  if (active.length === 0) {
    return null;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {active.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onClear(key)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-accent/40 py-1 pl-2.5 pr-2 text-xs text-foreground transition-colors duration-150 hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{filters[key]}</span>
          <X className="size-3 text-muted-foreground" aria-hidden />
          <span className="sr-only">Clear {label} filter</span>
        </button>
      ))}
    </div>
  );
}
