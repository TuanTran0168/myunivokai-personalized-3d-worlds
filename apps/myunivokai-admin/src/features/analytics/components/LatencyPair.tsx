import { cn } from "@/lib/utils";
import { formatDuration } from "../format";

// p50 and p95 side by side, always, plus the ratio between them.
//
// The ratio is the finding, and it is the thing neither number states on its
// own. A p95 twelve times the median is a tail owned by a handful of requests —
// look at what those requests have in common. A p95 barely above the median is
// everything being uniformly slow — look at capacity. Acting on those two means
// doing opposite things, and every screen that showed only a p95 forced the
// reader to guess which one they were in.
export function LatencyPair({
  p50,
  p95,
  slowest,
  average,
  interpolated = false,
  className
}: {
  p50: number;
  p95: number;
  slowest: number;
  average?: number;
  /** Renders the qualification telemetry-service's histogram percentiles need. */
  interpolated?: boolean;
  className?: string;
}) {
  // Guarded rather than computed blindly: a window with no traffic has a p50
  // of zero, and "Infinity× the median" is not a finding.
  const spread = p50 > 0 ? Math.round((p95 / p50) * 10) / 10 : null;

  return (
    <div className={cn("mt-3", className)}>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Percentile label="p50 · median" value={p50} tone="default" />
        <Percentile label="p95 · tail" value={p95} tone="tail" />
        <Percentile label="slowest seen" value={slowest} tone="muted" />
        {average !== undefined ? <Percentile label="mean" value={average} tone="muted" /> : null}
      </div>

      {/* The two percentiles on one axis, so the gap is visible rather than
          arithmetic. Scaled against the slowest observation, which is the only
          bound that is real — scaling against p95 would make every chart look
          identical. */}
      {slowest > 0 ? (
        <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/70 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.min((p50 / slowest) * 100, 100)}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-chart-5 transition-[left] duration-700 ease-out motion-reduce:transition-none"
            style={{ left: `${Math.min((p95 / slowest) * 100, 99.5)}%` }}
            aria-hidden
          />
        </div>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        {spread === null
          ? "Nothing was measured in this window."
          : spread >= 4
            ? `The tail is ${spread}× the median — a slow minority, not a slow platform.`
            : `The tail is ${spread}× the median — the whole distribution moves together.`}
        {interpolated ? " Percentiles are interpolated across fixed histogram edges." : ""}
      </p>
    </div>
  );
}

function Percentile({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "default" | "tail" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-heading font-semibold tabular-nums",
          tone === "muted" ? "text-base text-muted-foreground" : "text-lg text-foreground"
        )}
      >
        {formatDuration(value)}
      </p>
    </div>
  );
}
