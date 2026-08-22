import { formatCount, formatDuration } from "@/features/analytics/format";
import { serviceDisplayName } from "@/lib/service-names";
import type { TelemetryBackendSummary } from "../types";

// Round-trip time per backend service, which end-to-end response time cannot
// answer: a request under /api/{family}/worlds reaches universe or nature
// depending on the family, and both wear the same route template. This is the
// only place that distinction is visible.
export function BackendLatencyList({ backends }: { backends: TelemetryBackendSummary[] }) {
  const slowest = Math.max(1, ...backends.map((backend) => backend.p95DurationMs));

  return (
    <div className="mt-3 flex flex-col gap-2">
      {backends.map((backend) => (
        <div key={backend.service} className="rounded-lg border border-border/60 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-foreground">{serviceDisplayName(backend.service)}</p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              p95 {formatDuration(backend.p95DurationMs)} · slowest {formatDuration(backend.slowestDurationMs)}
            </p>
          </div>
          {/* A bar relative to the slowest backend, not to an absolute scale:
              the question this answers is "which one is dragging", and an
              absolute millisecond scale makes every bar tiny on a healthy
              fleet. */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round((backend.p95DurationMs / slowest) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {formatCount(backend.requestCount)} round trip{backend.requestCount === 1 ? "" : "s"}
            {backend.errorCount > 0
              ? ` · ${formatCount(backend.errorCount)} failed (no-responders and timeouts included)`
              : " · none failed"}
          </p>
        </div>
      ))}
    </div>
  );
}
