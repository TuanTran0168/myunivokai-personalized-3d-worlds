// Mirrors contracts/go/contracts_analytics.go. Every one of these shapes is
// computed by analytics-service in SQL and relayed unchanged by the gateway —
// this app renders numbers, it never derives them.

export type WorldFamily = "universe" | "nature";
export type JobStatus = "queued" | "processing" | "completed" | "failed";

// Kept in step with contracts.AnalyticsDefaultPageSize / MaximumPageSize.
// analytics-service clamps to the same bounds server-side, so a mismatch here
// degrades the page-size picker rather than breaking a query.
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface TraitScores {
  creativity: number;
  discipline: number;
  curiosity: number;
  energy: number;
  focus: number;
}

export interface DistributionSlice {
  value: string;
  count: number;
}

export interface FamilyTotals {
  family: WorldFamily;
  worldCount: number;
  publishedCount: number;
  variantCount: number;
  jobCount: number;
  failedJobCount: number;
}

export interface JobHealth {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  inFlightJobs: number;
  failureRatePercent: number;
  averageDurationMs: number;
  // The median beside the tail. Unlike telemetry-service's interpolated pair,
  // both of these are exact — analytics-service has every job's own duration
  // and computes PERCENTILE_CONT over it.
  p50DurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
  measuredJobCount: number;
  publishRatePercent: number;
  multiVariantPercent: number;
}

// One measure against the equivalent period before it. The absolute values
// ride with the percentage because +200% is unreadable at low volume — three
// worlds becoming nine, and the card cannot say which without them.
export interface AnalyticsDelta {
  current: number;
  previous: number;
  changePercent: number;
  // False when the preceding period has no data at all, which is not a
  // previous value of zero. A platform deployed yesterday has no baseline, and
  // an arrow drawn against nothing invents a trend.
  hasBaseline: boolean;
}

export interface AnalyticsComparison {
  // How wide each half is, stated rather than assumed, so the card labels
  // itself instead of hard-coding "24h".
  periodHours: number;
  worlds: AnalyticsDelta;
  publishedWorlds: AnalyticsDelta;
  jobs: AnalyticsDelta;
  failedJobs: AnalyticsDelta;
}

// Each stage is a strict subset of the one before it, which is what makes the
// shape a funnel rather than four unrelated counters.
export interface AnalyticsFunnelStage {
  stage: "submitted" | "completed" | "projected" | "published";
  label: string;
  count: number;
  // Against the FIRST stage, never the previous one — otherwise the funnel
  // cannot be read end to end without multiplying in your head.
  percentOfEntry: number;
}

// Only hours that actually saw a job are returned; the chart fills the rest
// with zeroes, because a 24-slot axis is a rendering concern and
// analytics-service has no business inventing rows.
export interface AnalyticsHourBucket {
  // 0-23, UTC.
  hour: number;
  jobCount: number;
}

export interface Overview {
  days: number;
  totalWorlds: number;
  totalPublished: number;
  worldsInWindow: number;
  families: FamilyTotals[];
  jobHealth: JobHealth;
  archetypeTop: DistributionSlice[];
  worldStyleTop: DistributionSlice[];
  moodTop: DistributionSlice[];
  errorCodeTop: DistributionSlice[];
  averageTraitScores: TraitScores;
  generatedAt: string;
  oldestProjectedWorld?: string;
  // Always a fixed 24 hours on each side, independent of `days` above: the
  // range picker scopes the distributions and the funnel, while "vs yesterday"
  // is a fixed question.
  comparison: AnalyticsComparison;
  generationFunnel: AnalyticsFunnelStage[];
  hourOfDay: AnalyticsHourBucket[];
  // Absent when no job was submitted in the window.
  peakHour?: AnalyticsHourBucket;
  rarity: RarityReport;
}

// One variety of a rare feature. percentOfHits is against that feature's own
// hits, so the varieties of one feature sum to 100% — dividing by the whole
// population instead would make three species that account for every rare bird
// sum to the bird's own 35%.
export interface RaritySpeciesShare {
  key: string;
  label: string;
  count: number;
  percentOfHits: number;
}

// A rare feature is never stored: the renderer re-derives it from the world's
// variant seed on every draw. analytics-service replays that same lottery over
// the seeds of real worlds, which is why observedPercent can differ from
// configuredPercent — one is what the generator was aimed at, the other is what
// it hit.
export interface RarityFeatureRate {
  key: string;
  label: string;
  family: WorldFamily;
  configuredPercent: number;
  // The denominator: worlds of this feature's family, in the window, carrying a
  // seed. Small denominators make observedPercent mostly sampling noise, which
  // is why the screen shows this number rather than the percentage alone.
  eligibleWorlds: number;
  observedCount: number;
  observedPercent: number;
  species?: RaritySpeciesShare[];
}

export interface RarityReport {
  features: RarityFeatureRate[];
  // Worlds in the window with no seed, and so in no denominator above. These
  // are not misses — they are worlds the lottery cannot be replayed for at all.
  unmeasuredWorlds: number;
}

export interface TimeseriesPoint {
  day: string;
  worldCount: number;
  publishedCount: number;
  jobCount: number;
  failedJobCount: number;
}

export interface Timeseries {
  days: number;
  points: TimeseriesPoint[];
}

export interface WorldProjection {
  worldId: string;
  family: WorldFamily;
  nickname: string;
  role?: string;
  archetype: string;
  sceneName: string;
  mood: string;
  worldStyle: string;
  favoriteColors: string[];
  traitScores: TraitScores;
  variantCount: number;
  selectedVariantNo: number;
  isPublished: boolean;
  publishedAt?: string;
  revision: number;
  sourceJobId: string;
  worldCreatedAt: string;
  projectedAt: string;
}

export interface WorldPage {
  worlds: WorldProjection[];
  nextCursor?: string;
  totalCount: number;
  pageSize: number;
}

// WorldDetail is WorldProjection plus the two identifiers a table has no room
// for, and the jobs that touched this world. Both halves arrive in one
// response so the world and its history can never be from different reads.
export interface WorldDetail {
  world: WorldProjection & { profileId: string; dnaVersionId: string };
  jobs: JobProjection[];
}

export interface JobProjection {
  jobId: string;
  family?: WorldFamily;
  status: JobStatus;
  errorCode?: string;
  errorMessage?: string;
  worldId?: string;
  profileId?: string;
  dnaVersionId?: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface JobPage {
  jobs: JobProjection[];
  nextCursor?: string;
  totalCount: number;
  pageSize: number;
}

// ServiceStartRecord is one process announcing it came up. Mirrors
// contracts/go/contracts_telemetry.go.
export interface ServiceStartRecord {
  service: string;
  instanceId: string;
  version: string;
  bootDurationMs: number;
  startedAt: string;
}

export interface ServiceStartPage {
  starts: ServiceStartRecord[];
  nextCursor?: string;
  totalCount: number;
  pageSize: number;
}

// ServiceWakeStats mirrors the gateway's adminWakeServiceStats. `wakeable`
// exists because a flat zero is ambiguous without it: a service with no URL
// configured is never woken, which is not the same as one that never slept.
export interface ServiceWakeStats {
  service: string;
  totalWakes: number;
  dailyWakes: Record<string, number>;
  lastSeenAt?: string | null;
  consecutiveFailedWakes: number;
  wakeable: boolean;
}

export interface WakeStats {
  days: number;
  services: ServiceWakeStats[];
  platform: {
    name: string;
    retryAfterSeconds: number;
    wakeableServiceCount: number;
  };
}

// archetype has no picker in the toolbar — there are too many values for a
// select, and analytics-service only returns the top eight. It is filterable
// all the same because the dashboard's distribution chart links into this list
// with one already chosen, and the gateway has always accepted the parameter.
// since/until are "YYYY-MM-DD" (native <input type="date"> values) or ""
// for no bound — the api layer converts them to RFC3339 instants.
// search matches nickname, case-insensitively.
export interface WorldListFilters {
  family?: WorldFamily | "";
  archetype?: string;
  worldStyle?: string;
  mood?: string;
  published?: "true" | "false" | "";
  since?: string;
  until?: string;
  search?: string;
  /** A key from the rarity catalogue, e.g. "black-hole". */
  rareFeature?: string;
}

// search matches jobId or errorMessage, case-insensitively.
export interface JobListFilters {
  family?: WorldFamily | "";
  status?: JobStatus | "";
  since?: string;
  until?: string;
  search?: string;
}
