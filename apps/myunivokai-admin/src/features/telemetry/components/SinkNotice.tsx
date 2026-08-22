import { ExternalLink, LineChart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { TelemetrySink } from "../types";

// What the screen shows when the running sink stores nothing locally.
//
// This exists because the alternative is worse in a specific way: with
// TELEMETRY_SINK=otlp every array in the response is legitimately empty, and
// empty charts read as "the platform served no traffic" rather than "the data
// is in Grafana". Those are opposite conclusions, and only one of them sends
// somebody looking in the right place.
export function SinkNotice({ sink }: { sink: TelemetrySink }) {
  return (
    <EmptyState
      icon={LineChart}
      title="The charts for this deployment live in Grafana"
      description={
        sink.dashboardUrl
          ? "This service is running with TELEMETRY_SINK=otlp, so it forwards every rollup to Grafana Cloud and keeps nothing locally to chart."
          : "This service is running with TELEMETRY_SINK=otlp, so it forwards every rollup to Grafana Cloud and keeps nothing locally to chart. No dashboard URL is configured — set TELEMETRY_DASHBOARD_URL to make this a link."
      }
    >
      {sink.dashboardUrl ? (
        <a
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          href={sink.dashboardUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open the Grafana dashboard
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </EmptyState>
  );
}
