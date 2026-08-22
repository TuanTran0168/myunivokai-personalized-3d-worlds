//! Mirrors `contracts/go/contracts_telemetry_rollup.go`.
//!
//! Read that file's comments for *why* each field is shaped this way; they are
//! not repeated here, because two copies of the same reasoning is exactly the
//! drift this mirror is trying to avoid. What is repeated is anything a Rust
//! reader would otherwise have to open the Go file to know.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::envelope::Envelope;

pub const TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT: &str = "myunivokai.events.telemetry.http.v1";
pub const TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT: &str =
    "myunivokai.queries.telemetry.overview.get.v1";
pub const TELEMETRY_ROUTE_LIST_QUERY_SUBJECT: &str = "myunivokai.queries.telemetry.route.list.v1";

pub const TELEMETRY_SINK_POSTGRES: &str = "postgres";
pub const TELEMETRY_SINK_OTLP: &str = "otlp";

/// The request funnel's stages. Each is a strict subset of the one before it:
/// everything that arrived, the part of it that was a valid request, and the
/// part of THAT the platform actually answered.
///
/// The nesting is the whole contract. An earlier version put backend round
/// trips in the middle two stages, which produced 302 -> 19 -> 19 -> 302 on a
/// real window — most traffic is health checks and 404s that never reach a
/// backend, so the shape collapsed and then fully recovered. Four counters in
/// a row are not a funnel unless each contains the next, and a chart implying
/// containment it does not have is worse than four separate numbers. Backend
/// fan-out is a ratio, not a stage.
///
/// Stable machine keys rather than the labels beside them — the admin app
/// colours and orders by these, so a reworded label must not become a new
/// stage.
pub const TELEMETRY_FUNNEL_STAGE_RECEIVED: &str = "received";
pub const TELEMETRY_FUNNEL_STAGE_ACCEPTED: &str = "accepted";
pub const TELEMETRY_FUNNEL_STAGE_SERVED: &str = "served";

/// The percentile reported alongside p95 everywhere in this pipeline.
pub const TELEMETRY_MEDIAN_PERCENTILE: f64 = 50.0;

pub const TELEMETRY_DEFAULT_HOURS: i64 = 24;
pub const TELEMETRY_MAXIMUM_HOURS: i64 = 168;

pub const TELEMETRY_STATUS_CLASS_MINIMUM: u8 = 1;
pub const TELEMETRY_STATUS_CLASS_MAXIMUM: u8 = 5;

pub const TELEMETRY_HISTOGRAM_BUCKET_COUNT: usize = 8;

/// The seven finite bucket edges; the eighth bucket is everything above the
/// last one. These numbers are duplicated in `contracts/go` and asserted by a
/// test on both sides — a percentile interpolated against the wrong edges is
/// wrong in a way that looks right.
pub const TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS: [i64; TELEMETRY_HISTOGRAM_BUCKET_COUNT - 1] =
    [5, 10, 25, 50, 100, 250, 1000];

/// A fixed-width latency histogram.
///
/// Unlike the Go mirror, which is an array only on the producing side, serde
/// rejects a JSON array of the wrong length outright — so a malformed envelope
/// fails to decode here rather than being silently zero-filled. That asymmetry
/// is the reason the Go side carries an explicit length check in `Validate`.
pub type TelemetryHistogram = [i64; TELEMETRY_HISTOGRAM_BUCKET_COUNT];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRollupBucket {
    /// chi's route TEMPLATE — `/api/universe/worlds/{worldID}` — never the raw
    /// path. Storing the path would make every world id its own series.
    pub route_pattern: String,
    pub method: String,
    pub status_class: u8,
    pub request_count: i64,
    pub duration_sum_ms: i64,
    pub duration_max_ms: i64,
    pub histogram: TelemetryHistogram,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub error_codes: HashMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NatsBackendBucket {
    pub service: String,
    pub request_count: i64,
    pub duration_sum_ms: i64,
    pub duration_max_ms: i64,
    pub histogram: TelemetryHistogram,
    pub error_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheBucket {
    pub namespace: String,
    pub hits: i64,
    pub misses: i64,
}

/// One flush: everything one gateway instance observed in one interval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRollupData {
    pub instance_id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub bucket_duration_ms: i64,
    #[serde(default)]
    pub buckets: Vec<HttpRollupBucket>,
    #[serde(default)]
    pub nats_backend_buckets: Vec<NatsBackendBucket>,
    #[serde(default)]
    pub cache_buckets: Vec<CacheBucket>,
}

/// The name `telemetry-service-plan.md` uses for the whole message. It is an
/// alias rather than a struct so this crate has exactly one envelope type,
/// matching `contracts/go`.
pub type HttpRollupEnvelope = Envelope<HttpRollupData>;

impl HttpRollupData {
    /// Mirrors Go's `HTTPRollupData.Validate`, and is the last line of defence
    /// before a bucket key becomes a primary-key column.
    pub fn validate(&self) -> Result<(), String> {
        if self.instance_id.trim().is_empty() {
            return Err("instanceId is required".to_owned());
        }
        if self.bucket_duration_ms <= 0 {
            return Err("bucketDurationMs must be positive".to_owned());
        }
        for (index, bucket) in self.buckets.iter().enumerate() {
            if bucket.route_pattern.trim().is_empty() {
                return Err(format!("buckets.{index}.routePattern is required"));
            }
            if bucket.method.trim().is_empty() {
                return Err(format!("buckets.{index}.method is required"));
            }
            if bucket.status_class < TELEMETRY_STATUS_CLASS_MINIMUM
                || bucket.status_class > TELEMETRY_STATUS_CLASS_MAXIMUM
            {
                return Err(format!(
                    "buckets.{index}.statusClass must be {TELEMETRY_STATUS_CLASS_MINIMUM}-{TELEMETRY_STATUS_CLASS_MAXIMUM}"
                ));
            }
            if bucket.request_count < 0 || bucket.duration_sum_ms < 0 || bucket.duration_max_ms < 0
            {
                return Err(format!("buckets.{index} counters must not be negative"));
            }
        }
        for (index, bucket) in self.nats_backend_buckets.iter().enumerate() {
            if bucket.service.trim().is_empty() {
                return Err(format!("natsBackendBuckets.{index}.service is required"));
            }
            if bucket.request_count < 0 || bucket.error_count < 0 {
                return Err(format!(
                    "natsBackendBuckets.{index} counters must not be negative"
                ));
            }
        }
        for (index, bucket) in self.cache_buckets.iter().enumerate() {
            if bucket.namespace.trim().is_empty() {
                return Err(format!("cacheBuckets.{index}.namespace is required"));
            }
            if bucket.hits < 0 || bucket.misses < 0 {
                return Err(format!(
                    "cacheBuckets.{index} counters must not be negative"
                ));
            }
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.buckets.is_empty()
            && self.nats_backend_buckets.is_empty()
            && self.cache_buckets.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryOverviewQueryData {
    #[serde(default)]
    pub hours: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRouteListQueryData {
    #[serde(default)]
    pub hours: i64,
}

/// On every telemetry response, not only the ones that fail to answer: the
/// admin app reads one field to decide whether to render charts or a link,
/// instead of inferring intent from a missing array.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySinkDescriptor {
    pub sink: String,
    pub charts_available: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub dashboard_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryVolumePoint {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_start: OffsetDateTime,
    pub request_count: i64,
    pub error_count: i64,
    pub p95_duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStatusClassCount {
    pub status_class: u8,
    pub request_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryErrorCodeCount {
    pub error_code: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryBackendSummary {
    pub service: String,
    pub request_count: i64,
    pub error_count: i64,
    pub average_duration_ms: i64,
    pub p50_duration_ms: i64,
    pub p95_duration_ms: i64,
    pub slowest_duration_ms: i64,
}

/// One measure against the window of the same width immediately before it.
///
/// Both absolute values travel with the percentage: +100% is a different fact
/// when it is 2 requests becoming 4 than when it is 20,000 becoming 40,000,
/// and a card showing only the percentage cannot tell the reader which.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDelta {
    pub current: i64,
    pub previous: i64,
    pub change_percent: f64,
    /// False when the previous window holds no data at all, which is not the
    /// same as a previous value of zero. A service that was asleep has no
    /// baseline, and "+100%" rendered against nothing is a fabricated trend.
    pub has_baseline: bool,
}

/// The whole "vs the previous window" block.
///
/// `errors` is deliberately the error COUNT and not the rate: two rates
/// subtract into a percentage-POINT difference, and calling that a percent
/// change is the most common way a card like this ends up lying.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryComparison {
    #[serde(with = "time::serde::rfc3339")]
    pub previous_window_start: OffsetDateTime,
    pub requests: TelemetryDelta,
    pub errors: TelemetryDelta,
    pub p95_duration_ms: TelemetryDelta,
}

/// One step of the request funnel. `stage` is a stable machine key; `label` is
/// what a chart prints.
///
/// `percent_of_entry` is against the FIRST stage rather than the previous one,
/// so the funnel reads end to end without multiplying in your head.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryFunnelStage {
    pub stage: String,
    pub label: String,
    pub count: i64,
    pub percent_of_entry: f64,
}

/// One hour of the day summed across every day in the window.
///
/// This answers what the raw timeline cannot: not "when was it busy once" but
/// "when is it reliably busy" — the question that decides when a deploy is
/// cheap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryHourBucket {
    /// 0-23, UTC. The admin app labels the timezone rather than converting,
    /// so two operators in two countries read the same number.
    pub hour: u8,
    pub request_count: i64,
    pub error_count: i64,
    pub p95_duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCacheSummary {
    pub namespace: String,
    pub hits: i64,
    pub misses: i64,
    pub hit_rate_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryOverviewResponseData {
    #[serde(flatten)]
    pub sink: TelemetrySinkDescriptor,
    pub hours: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub generated_at: OffsetDateTime,
    pub total_requests: i64,
    pub error_requests: i64,
    pub error_rate_percent: f64,
    pub average_duration_ms: i64,
    /// P50 travels beside P95 everywhere. The gap between them is the finding:
    /// a p50 of 40ms under a p95 of 900ms is a tail problem, and the same p95
    /// under a p50 of 700ms is a capacity problem. Either number alone cannot
    /// tell those two apart.
    pub p50_duration_ms: i64,
    pub p95_duration_ms: i64,
    pub slowest_duration_ms: i64,
    /// Always true for the postgres sink, and rendered on the screen rather
    /// than buried in a tooltip: a p95 that looks exact and is not is worse
    /// than no p95.
    pub percentile_is_interpolated: bool,
    pub status_mix: Vec<TelemetryStatusClassCount>,
    pub volume_points: Vec<TelemetryVolumePoint>,
    /// The same traffic rolled up to the hour. `volume_points` is
    /// minute-resolution and a 7-day window holds 10,080 of them — a chart
    /// nobody can read and a payload nobody needs; this is what the trend line
    /// is actually drawn from.
    pub hourly_points: Vec<TelemetryVolumePoint>,
    /// The busiest single hour in the window, absent when it holds nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peak_hour: Option<TelemetryVolumePoint>,
    pub hour_of_day: Vec<TelemetryHourBucket>,
    /// Absent for a window with no measurable predecessor — see
    /// [`TelemetryDelta::has_baseline`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<TelemetryComparison>,
    pub traffic_funnel: Vec<TelemetryFunnelStage>,
    pub error_code_top: Vec<TelemetryErrorCodeCount>,
    pub backends: Vec<TelemetryBackendSummary>,
    pub cache: Vec<TelemetryCacheSummary>,
    pub wake_signals: Vec<TelemetryVolumePoint>,
    #[serde(
        default,
        with = "time::serde::rfc3339::option",
        skip_serializing_if = "Option::is_none"
    )]
    pub oldest_bucket_start: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRouteSummary {
    pub route_pattern: String,
    pub method: String,
    pub request_count: i64,
    pub error_count: i64,
    pub error_rate_percent: f64,
    pub average_duration_ms: i64,
    pub p50_duration_ms: i64,
    pub p95_duration_ms: i64,
    pub slowest_duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRouteListResponseData {
    #[serde(flatten)]
    pub sink: TelemetrySinkDescriptor,
    pub hours: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub generated_at: OffsetDateTime,
    pub percentile_is_interpolated: bool,
    pub routes: Vec<TelemetryRouteSummary>,
}

/// Mirrors Go's `TelemetryRollupMessageID`: `{instance, bucket start}`, which
/// is what separates two instances flushing one interval (two facts) from one
/// instance's interval arriving twice (one fact, delivered twice).
pub fn telemetry_rollup_message_id(instance_id: &str, bucket_start: OffsetDateTime) -> String {
    let formatted = bucket_start
        .to_offset(time::UtcOffset::UTC)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    format!("{instance_id}:{formatted}")
}

pub fn normalize_telemetry_hours(hours: i64) -> i64 {
    if hours <= 0 {
        return TELEMETRY_DEFAULT_HOURS;
    }
    if hours > TELEMETRY_MAXIMUM_HOURS {
        return TELEMETRY_MAXIMUM_HOURS;
    }
    hours
}

pub fn status_class_of(status_code: i64) -> u8 {
    let status_class = status_code / 100;
    if !(i64::from(TELEMETRY_STATUS_CLASS_MINIMUM)..=i64::from(TELEMETRY_STATUS_CLASS_MAXIMUM))
        .contains(&status_class)
    {
        return TELEMETRY_STATUS_CLASS_MAXIMUM;
    }
    status_class as u8
}

/// Places one observed duration into a bucket. The boundary is inclusive, so
/// 25 ms lands in the 25 ms bucket and 26 ms does not.
pub fn telemetry_histogram_index_of(duration_ms: i64) -> usize {
    for (index, upper_bound) in TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS.iter().enumerate() {
        if duration_ms <= *upper_bound {
            return index;
        }
    }
    TELEMETRY_HISTOGRAM_BUCKET_COUNT - 1
}

/// Interpolates a percentile across the fixed bucket edges.
///
/// This lives beside the edges rather than inside a sink because it is
/// meaningless apart from them: the answer is a linear interpolation *within*
/// whichever bucket the target rank lands in, so changing an edge silently
/// changes every percentile ever computed.
///
/// `observed_maximum_ms` is not decoration. The last bucket has no upper edge,
/// so a percentile landing there could only be reported as "somewhere above
/// 1000 ms" — the observed maximum is the one real number available to bound
/// it, and it also clamps the result so an interpolation can never claim a
/// latency larger than anything actually seen.
///
/// The answer is an approximation by construction. Every caller is required to
/// carry `percentile_is_interpolated` alongside it.
pub fn percentile_from_histogram(
    histogram: &TelemetryHistogram,
    percentile: f64,
    observed_maximum_ms: i64,
) -> i64 {
    let total: i64 = histogram.iter().sum();
    if total <= 0 {
        return 0;
    }
    let target_rank = (percentile.clamp(0.0, 100.0) / 100.0) * total as f64;
    let mut cumulative: i64 = 0;
    for (index, count) in histogram.iter().enumerate() {
        if *count <= 0 {
            continue;
        }
        let next_cumulative = cumulative + count;
        if next_cumulative as f64 >= target_rank {
            let lower_bound = bucket_lower_bound_ms(index);
            let upper_bound = bucket_upper_bound_ms(index, observed_maximum_ms);
            let position_within_bucket = (target_rank - cumulative as f64) / *count as f64;
            let interpolated = lower_bound as f64
                + (upper_bound - lower_bound) as f64 * position_within_bucket.clamp(0.0, 1.0);
            return clamp_to_observed_maximum(interpolated.round() as i64, observed_maximum_ms);
        }
        cumulative = next_cumulative;
    }
    observed_maximum_ms.max(0)
}

fn bucket_lower_bound_ms(index: usize) -> i64 {
    if index == 0 {
        0
    } else {
        TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS[index - 1]
    }
}

fn bucket_upper_bound_ms(index: usize, observed_maximum_ms: i64) -> i64 {
    match TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS.get(index) {
        Some(upper_bound) => *upper_bound,
        // The overflow bucket. Its real upper edge is unknown, and the
        // observed maximum is the only honest stand-in available.
        None => {
            let last_finite_edge =
                TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS[TELEMETRY_HISTOGRAM_BUCKET_COUNT - 2];
            observed_maximum_ms.max(last_finite_edge)
        }
    }
}

/// Caps an interpolation at the largest latency actually observed.
///
/// Zero is a real maximum, not a missing one — the gateway floors a
/// sub-millisecond request to 0 ms, so a bucket in which every request was
/// faster than the clock's resolution has an honest maximum of zero. Treating
/// zero as "unknown" and skipping the cap here made such a bucket report a p95
/// of 5 ms, which is the interpolation's own bucket edge rather than anything
/// that happened. This function is only ever reached with at least one
/// observation, so the maximum is always meaningful.
fn clamp_to_observed_maximum(value: i64, observed_maximum_ms: i64) -> i64 {
    value.clamp(0, observed_maximum_ms.max(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn the_histogram_edges_are_the_documented_ones() {
        assert_eq!(
            TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS,
            [5, 10, 25, 50, 100, 250, 1000],
            "these seven numbers are duplicated in contracts/go and must stay identical"
        );
    }

    #[test]
    fn histogram_boundaries_land_in_the_lower_bucket() {
        assert_eq!(telemetry_histogram_index_of(0), 0);
        assert_eq!(telemetry_histogram_index_of(5), 0);
        assert_eq!(telemetry_histogram_index_of(6), 1);
        assert_eq!(telemetry_histogram_index_of(25), 2);
        assert_eq!(telemetry_histogram_index_of(26), 3);
        assert_eq!(telemetry_histogram_index_of(1000), 6);
        assert_eq!(telemetry_histogram_index_of(1001), 7);
    }

    #[test]
    fn an_unexpected_status_stays_visible_as_a_server_error() {
        assert_eq!(status_class_of(200), 2);
        assert_eq!(status_class_of(404), 4);
        assert_eq!(status_class_of(503), 5);
        assert_eq!(status_class_of(0), 5);
        assert_eq!(status_class_of(600), 5);
    }

    #[test]
    fn hours_are_clamped_to_the_streams_own_retention() {
        assert_eq!(normalize_telemetry_hours(0), TELEMETRY_DEFAULT_HOURS);
        assert_eq!(normalize_telemetry_hours(-1), TELEMETRY_DEFAULT_HOURS);
        assert_eq!(normalize_telemetry_hours(1), 1);
        assert_eq!(normalize_telemetry_hours(9999), TELEMETRY_MAXIMUM_HOURS);
    }

    #[test]
    fn an_empty_histogram_has_no_percentile_rather_than_a_made_up_one() {
        assert_eq!(percentile_from_histogram(&[0; 8], 95.0, 0), 0);
    }

    #[test]
    fn a_percentile_interpolates_within_the_bucket_it_lands_in() {
        // Ten observations, all between 50 ms and 100 ms. p95 is the 9.5th of
        // them, i.e. 95% of the way through that one bucket: 50 + 47.5.
        let histogram: TelemetryHistogram = [0, 0, 0, 0, 10, 0, 0, 0];
        assert_eq!(percentile_from_histogram(&histogram, 95.0, 100), 98);
        assert_eq!(percentile_from_histogram(&histogram, 50.0, 100), 75);
    }

    #[test]
    fn a_percentile_never_exceeds_a_latency_that_was_actually_observed() {
        // Everything landed in the 50-100 ms bucket but nothing was slower
        // than 61 ms, so no interpolation may claim 98 ms.
        let histogram: TelemetryHistogram = [0, 0, 0, 0, 10, 0, 0, 0];
        assert_eq!(percentile_from_histogram(&histogram, 95.0, 61), 61);
    }

    // Found by running the real pipeline: a bucket where every request
    // finished inside a millisecond reported p95 = 5 ms, which is the
    // interpolation's own bucket edge and not anything that happened. Zero is
    // a real observed maximum, not a missing one.
    #[test]
    fn a_bucket_of_sub_millisecond_requests_reports_zero_rather_than_a_bucket_edge() {
        let histogram: TelemetryHistogram = [12, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(percentile_from_histogram(&histogram, 95.0, 0), 0);
    }

    #[test]
    fn the_overflow_bucket_is_bounded_by_the_observed_maximum() {
        let histogram: TelemetryHistogram = [0, 0, 0, 0, 0, 0, 0, 4];
        let p95 = percentile_from_histogram(&histogram, 95.0, 4200);
        assert!(
            (1000..=4200).contains(&p95),
            "p95 fell outside the overflow bucket: {p95}"
        );
    }

    #[test]
    fn the_message_id_is_stable_across_timezones_but_not_across_instances() {
        let bucket_start = datetime!(2026-08-13 09:14:00 UTC);
        let first = telemetry_rollup_message_id("instance-a", bucket_start);
        assert_eq!(first, "instance-a:2026-08-13T09:14:00Z");
        assert_ne!(
            first,
            telemetry_rollup_message_id("instance-b", bucket_start)
        );
        assert_ne!(
            first,
            telemetry_rollup_message_id("instance-a", bucket_start + time::Duration::minutes(1))
        );
    }

    #[test]
    fn a_rollup_missing_its_identity_is_rejected() {
        let mut data = HttpRollupData {
            instance_id: "instance".to_owned(),
            bucket_start: datetime!(2026-08-13 09:14:00 UTC),
            bucket_duration_ms: 60_000,
            buckets: Vec::new(),
            nats_backend_buckets: Vec::new(),
            cache_buckets: Vec::new(),
        };
        assert!(data.validate().is_ok());
        assert!(data.is_empty());

        data.instance_id = "  ".to_owned();
        assert!(data.validate().is_err());
    }

    #[test]
    fn a_histogram_of_the_wrong_length_fails_to_decode() {
        let payload = serde_json::json!({
            "routePattern": "/api/universe/worlds",
            "method": "POST",
            "statusClass": 2,
            "requestCount": 1,
            "durationSumMs": 10,
            "durationMaxMs": 10,
            "histogram": [0, 0, 1]
        });
        assert!(
            serde_json::from_value::<HttpRollupBucket>(payload).is_err(),
            "serde must reject a histogram that cannot be summed with the others"
        );
    }
}
