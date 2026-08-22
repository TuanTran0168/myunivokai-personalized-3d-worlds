// Mirrors contracts/go/contracts_telemetry_rollup.go, which is itself mirrored
// by contracts/rust. Every shape here is computed by telemetry-service and
// relayed unchanged by the gateway — this app renders numbers, it never derives
// them.
//
// This is a separate feature folder from `analytics` on purpose. The two read
// from different services with different data boundaries: analytics answers
// questions about worlds and jobs, telemetry answers questions about the
// platform itself, and merging them here would put one service's outage on the
// other's screen.

// Kept in step with contracts.TelemetryDefaultHours / MaximumHours.
// telemetry-service clamps to the same bounds server-side, so a mismatch here
// degrades the window picker rather than breaking a query.
export const TELEMETRY_WINDOW_OPTIONS = [
  { label: "Last hour", value: 1 },
  { label: "Last 6 hours", value: 6 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 3 days", value: 72 },
  { label: "Last 7 days", value: 168 }
] as const;

export const DEFAULT_TELEMETRY_HOURS = 24;

// On every telemetry response, not only the ones that fail to answer. The
// screen reads `chartsAvailable` to decide whether to draw charts or a link,
// instead of inferring intent from an empty array — an empty chart and "the
// data lives in Grafana" look identical otherwise, and mean opposite things.
export interface TelemetrySink {
  sink: "postgres" | "otlp";
  chartsAvailable: boolean;
  dashboardUrl?: string;
}

export interface TelemetryVolumePoint {
  bucketStart: string;
  requestCount: number;
  errorCount: number;
  p95DurationMs: number;
}

export interface TelemetryStatusClassCount {
  statusClass: number;
  requestCount: number;
}

export interface TelemetryErrorCodeCount {
  errorCode: string;
  count: number;
}

export interface TelemetryBackendSummary {
  service: string;
  requestCount: number;
  errorCount: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
}

// One measure against the window of the same width immediately before it.
//
// Both absolute values travel with the percentage because a percentage alone
// is unreadable at low volume: +100% is two requests becoming four, and the
// card has no way to say which without them.
export interface TelemetryDelta {
  current: number;
  previous: number;
  changePercent: number;
  // False when the previous window holds no data at all — a service that was
  // asleep, or a deploy from an hour ago. Different from a previous value of
  // zero, and the screen must say "no baseline" rather than draw an arrow.
  hasBaseline: boolean;
}

export interface TelemetryComparison {
  previousWindowStart: string;
  requests: TelemetryDelta;
  // The error COUNT, not the rate: two rates subtract into a percentage-POINT
  // difference, and reporting that as a percent change is how a card like this
  // ends up lying.
  errors: TelemetryDelta;
  p95DurationMs: TelemetryDelta;
}

// Each stage strictly contains the next: everything that arrived, the part of
// it that was a valid request, and the part of THAT the platform answered.
//
// The nesting is the contract. An earlier version of this funnel used backend
// round trips for its middle stages and rendered 302 -> 19 -> 19 -> 302 on real
// traffic — health checks and 404s never reach a backend, so it collapsed and
// then fully recovered. Backend fan-out is a ratio, not a funnel stage.
export interface TelemetryFunnelStage {
  stage: "received" | "accepted" | "served";
  label: string;
  count: number;
  /** Against the FIRST stage, never the previous one. Never above 100. */
  percentOfEntry: number;
}

export interface TelemetryHourBucket {
  // 0-23, UTC. Rendered with the zone beside it rather than converted, so two
  // operators in two countries read the same number.
  hour: number;
  requestCount: number;
  errorCount: number;
  p95DurationMs: number;
}

export interface TelemetryCacheSummary {
  namespace: string;
  hits: number;
  misses: number;
  hitRatePercent: number;
}

export interface TelemetryOverview extends TelemetrySink {
  hours: number;
  generatedAt: string;
  totalRequests: number;
  // 5xx only. A 404 or a validation failure is the client's problem, and
  // folding it in would produce an error rate that never goes down; statusMix
  // carries the rest so nothing is hidden.
  errorRequests: number;
  errorRatePercent: number;
  averageDurationMs: number;
  // The median beside the tail. The gap between them is the finding: a low p50
  // under a high p95 is a tail a few requests own, and two high numbers are
  // everything being slow — opposite fixes, indistinguishable from either
  // number alone.
  p50DurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
  // Always true when charts are available. The screen is required to render
  // this qualification next to the number: a p95 that looks exact and is not
  // is worse than no p95.
  percentileIsInterpolated: boolean;
  statusMix: TelemetryStatusClassCount[];
  // Minute resolution. A 7-day window holds 10,080 of these — kept for the
  // fine-grained chart, never for the trend line.
  volumePoints: TelemetryVolumePoint[];
  // The same traffic rolled up to the hour. This is what the trend is drawn
  // from.
  hourlyPoints: TelemetryVolumePoint[];
  // Absent when the window holds nothing at all.
  peakHour?: TelemetryVolumePoint;
  hourOfDay: TelemetryHourBucket[];
  // Absent when the previous window has no data to compare against.
  comparison?: TelemetryComparison;
  trafficFunnel: TelemetryFunnelStage[];
  errorCodeTop: TelemetryErrorCodeCount[];
  backends: TelemetryBackendSummary[];
  cache: TelemetryCacheSummary[];
  wakeSignals: TelemetryVolumePoint[];
  // What actually exists in the store, which is not always what was asked for.
  // A service asleep for a week has no data for most of a 24-hour window, and
  // a chart that does not say so reads as "no traffic" rather than "no data".
  oldestBucketStart?: string;
}

export interface TelemetryRouteSummary {
  routePattern: string;
  method: string;
  requestCount: number;
  errorCount: number;
  errorRatePercent: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
}

export interface TelemetryRouteList extends TelemetrySink {
  hours: number;
  generatedAt: string;
  percentileIsInterpolated: boolean;
  routes: TelemetryRouteSummary[];
}
