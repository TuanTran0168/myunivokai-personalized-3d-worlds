"use client";

import type { ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader } from "@/components/layout/page-header";
import { telemetryApi } from "../api";
import { SinkNotice } from "./SinkNotice";
import { DEFAULT_TELEMETRY_HOURS, TELEMETRY_WINDOW_OPTIONS, type TelemetryOverview } from "../types";

// The three platform screens — Traffic, Performance, Reliability — all read the
// same overview response, share the same window picker, and have the same three
// ways of having nothing to render: the service did not answer, the sink stores
// nothing locally, or the window is genuinely empty.
//
// This holds all of that once. Before it, splitting one Telemetry page into
// three would have meant three copies of the sink check — and a sink check that
// exists on two screens out of three is worse than none, because the screen
// missing it renders empty charts that read as "no traffic" when the truth is
// "the data is in Grafana".
//
// The window lives in the URL rather than in component state so that a link to
// a six-hour view is a link to a six-hour view. Moving between the three
// screens keeps it, which is the whole point of splitting them: they are one
// investigation, not three destinations.
export function TelemetryShell({
  title,
  description,
  hours,
  onHoursChange,
  children
}: {
  title: string;
  description: string;
  hours: number;
  onHoursChange: (hours: number) => void;
  children: (overview: TelemetryOverview | undefined, isLoading: boolean) => ReactNode;
}) {
  const overviewQuery = useQuery({
    queryKey: ["telemetry", "overview", hours],
    queryFn: () => telemetryApi.overview(hours),
    placeholderData: keepPreviousData
  });

  const overview = overviewQuery.data;
  // One flag decides the whole screen. With TELEMETRY_SINK=otlp every array is
  // legitimately empty, and empty charts read as "the platform served no
  // traffic" rather than "the data is in Grafana" — opposite conclusions, and
  // only one of them sends somebody to the right place.
  const chartsAvailable = overview?.chartsAvailable ?? true;

  return (
    <div>
      <PageHeader title={title} description={description} sources={["Telemetry Service"]} />

      <FilterBar>
        <FilterSelect
          label="Window"
          value={String(hours)}
          onChange={(value) => onHoursChange(Number(value) || DEFAULT_TELEMETRY_HOURS)}
          options={TELEMETRY_WINDOW_OPTIONS.map((option) => ({
            label: option.label,
            value: String(option.value)
          }))}
        />
      </FilterBar>

      {overviewQuery.isError ? (
        <Card>
          <CardContent className="pt-2">
            <EmptyState
              icon={AlertTriangle}
              title="Telemetry is unavailable"
              description="telemetry-service did not answer. It may be starting up — the gateway wakes it on demand, so a retry in a moment usually succeeds."
            />
          </CardContent>
        </Card>
      ) : !chartsAvailable && overview ? (
        <Card>
          <CardContent className="pt-2">
            <SinkNotice sink={overview} />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4 stagger-children">{children(overview, overviewQuery.isLoading)}</div>
      )}
    </div>
  );
}
