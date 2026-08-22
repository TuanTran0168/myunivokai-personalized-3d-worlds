"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/search-input";
import { CursorPagination, useCursorPagination } from "@/components/ui/cursor-pagination";
import { auditApi } from "./api";
import type { AuditListFilters } from "./types";

const TABLE_HEADERS = ["When", "Actor", "Action", "Target", "Result"];

export function AuditPage() {
  const [filters, setFilters] = useState<AuditListFilters>({});
  const pagination = useCursorPagination();

  // Same reason as the jobs/worlds tables: a filter change redefines row 1,
  // so an already-taken cursor points into a different result set.
  const { reset } = pagination;
  useEffect(() => {
    reset();
  }, [filters, reset]);

  const auditQuery = useQuery({
    queryKey: ["audit", filters, pagination.pageSize, pagination.cursor],
    queryFn: () => auditApi.list(filters, pagination.pageSize, pagination.cursor),
    placeholderData: keepPreviousData
  });

  const events = auditQuery.data?.events ?? [];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every login, failed login, role change and admin mutation, newest first."
        sources={["Auth Service"]}
      />

      <FilterBar>
        <SearchInput
          value={filters.search ?? ""}
          onChange={(value) => setFilters((current) => ({ ...current, search: value }))}
          placeholder="Action or target…"
        />
        <DateRangeFilter
          label="Occurred"
          since={filters.since ?? ""}
          until={filters.until ?? ""}
          onSinceChange={(value) => setFilters((current) => ({ ...current, since: value }))}
          onUntilChange={(value) => setFilters((current) => ({ ...current, until: value }))}
        />
      </FilterBar>
      <Card>
        <CardContent className="pt-2">
          {auditQuery.isLoading ? (
            <TableSkeleton columnCount={5} headers={TABLE_HEADERS} />
          ) : events.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No events match"
              description="Audit events appear here as they occur. Try clearing the date filter."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.auditEventId}>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {new Date(event.occurredAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{event.actorAccountId || "—"}</TableCell>
                        <TableCell className="text-sm">{event.action}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{event.target || "—"}</TableCell>
                        <TableCell className="text-sm">{event.result}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile timeline cards */}
              <div className="flex flex-col gap-3 sm:hidden">
                {events.map((event) => (
                  <div
                    key={event.auditEventId}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{event.action}</span>
                      <span className="text-xs text-muted-foreground">{event.result}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleString()}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {event.actorAccountId || "—"} → {event.target || "—"}
                    </p>
                  </div>
                ))}
              </div>

              <CursorPagination
                pagination={pagination}
                nextCursor={auditQuery.data?.nextCursor}
                loadedCount={events.length}
                totalCount={auditQuery.data?.totalCount ?? 0}
                isFetching={auditQuery.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
