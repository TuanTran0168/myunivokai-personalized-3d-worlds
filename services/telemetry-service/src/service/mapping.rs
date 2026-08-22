//! Domain aggregate to wire response, as [`From`] impls rather than closures.
//!
//! This is the read path's counterpart to [`crate::domain::RollupBatch`]: that
//! is where the wire becomes storage, this is where storage becomes the wire.
//! Both are named things a reader can open, which is the point — a conversion
//! written inline inside a struct literal is a conversion nobody can find,
//! document or test on its own.
//!
//! `From` specifically, not a private `fn to_summary`, because C-CONV-TRAITS in
//! the [Rust API Guidelines] says conversions belong on the standard traits.
//! The payoff is at the call site: [`crate::service::TelemetryService::overview`]
//! reads `.map(Into::into).collect()` six times instead of six different
//! hand-written closures that have to be compared line by line to see that they
//! agree.
//!
//! The orphan rule permits this even though both sides are foreign-ish: the
//! trait is `core::convert::From` and the target types live in
//! `myunivokai_contracts`, but each impl names a local domain type as the
//! trait's parameter, which is the local type the rule requires.
//!
//! [Rust API Guidelines]: https://rust-lang.github.io/api-guidelines/interoperability.html#conversions-use-the-standard-traits-from-asref-asmut-c-conv-traits

use myunivokai_contracts::{
    TelemetryBackendSummary, TelemetryCacheSummary, TelemetryErrorCodeCount, TelemetryHourBucket,
    TelemetryRouteSummary, TelemetryStatusClassCount, TelemetryVolumePoint,
};

use crate::domain::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, RouteAggregate,
    StatusClassCount, VolumeBucket, WakeSignalBucket,
};

/// Every percentage on every telemetry screen, rounded in exactly one place.
///
/// Two decimals, and a total of zero reads as `0.0` rather than a division by
/// it. Centralised so that "error rate" and "hit rate" cannot end up disagreeing
/// about what 1/3 looks like.
pub(super) fn percentage_of(part: i64, total: i64) -> f64 {
    if total <= 0 {
        return 0.0;
    }
    (part as f64 * 100.0 / total as f64 * 100.0).round() / 100.0
}

impl From<StatusClassCount> for TelemetryStatusClassCount {
    fn from(slice: StatusClassCount) -> Self {
        Self {
            status_class: slice.status_class,
            request_count: slice.requests,
        }
    }
}

impl From<VolumeBucket> for TelemetryVolumePoint {
    fn from(bucket: VolumeBucket) -> Self {
        Self {
            bucket_start: bucket.bucket_start,
            request_count: bucket.requests,
            error_count: bucket.server_errors,
            p95_duration_ms: bucket.latency.p95_ms(),
        }
    }
}

/// The wake-signal series rides on the volume-point shape because the chart
/// that renders it is the same chart.
///
/// The two zeroes are "not applicable", not measurements: a `SERVICE_WAKING`
/// count carries no latency distribution and no error total of its own. Stated
/// here because the same two zeroes written inline inside a struct literal look
/// exactly like a quiet minute.
impl From<WakeSignalBucket> for TelemetryVolumePoint {
    fn from(bucket: WakeSignalBucket) -> Self {
        Self {
            bucket_start: bucket.bucket_start,
            request_count: bucket.count,
            error_count: 0,
            p95_duration_ms: 0,
        }
    }
}

impl From<HourOfDayBucket> for TelemetryHourBucket {
    fn from(bucket: HourOfDayBucket) -> Self {
        Self {
            hour: bucket.hour,
            request_count: bucket.requests,
            error_count: bucket.server_errors,
            p95_duration_ms: bucket.latency.p95_ms(),
        }
    }
}

impl From<ErrorCodeAggregate> for TelemetryErrorCodeCount {
    fn from(entry: ErrorCodeAggregate) -> Self {
        Self {
            error_code: entry.error_code,
            count: entry.count,
        }
    }
}

impl From<BackendAggregate> for TelemetryBackendSummary {
    fn from(backend: BackendAggregate) -> Self {
        Self {
            service: backend.service,
            request_count: backend.requests,
            error_count: backend.errors,
            average_duration_ms: backend.latency.average_ms(),
            p50_duration_ms: backend.latency.p50_ms(),
            p95_duration_ms: backend.latency.p95_ms(),
            slowest_duration_ms: backend.latency.slowest_ms(),
        }
    }
}

impl From<CacheAggregate> for TelemetryCacheSummary {
    fn from(namespace: CacheAggregate) -> Self {
        Self {
            hit_rate_percent: percentage_of(namespace.hits, namespace.hits + namespace.misses),
            namespace: namespace.namespace,
            hits: namespace.hits,
            misses: namespace.misses,
        }
    }
}

impl From<RouteAggregate> for TelemetryRouteSummary {
    fn from(route: RouteAggregate) -> Self {
        Self {
            error_rate_percent: percentage_of(route.server_errors, route.requests),
            average_duration_ms: route.latency.average_ms(),
            p50_duration_ms: route.latency.p50_ms(),
            p95_duration_ms: route.latency.p95_ms(),
            slowest_duration_ms: route.latency.slowest_ms(),
            route_pattern: route.route_pattern,
            method: route.method,
            request_count: route.requests,
            error_count: route.server_errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::LatencySummary;
    use time::macros::datetime;

    #[test]
    fn percentages_round_to_two_places_and_survive_an_empty_window() {
        assert_eq!(percentage_of(0, 0), 0.0);
        assert_eq!(percentage_of(1, 3), 33.33);
        assert_eq!(percentage_of(50, 100), 50.0);
    }

    // A namespace that was looked up and never hit is a 0% hit rate, which is a
    // finding. Absent, or a division by zero, is not.
    #[test]
    fn a_namespace_that_only_ever_missed_reads_as_zero_percent() {
        let summary = TelemetryCacheSummary::from(CacheAggregate {
            namespace: "share:v1".to_owned(),
            hits: 0,
            misses: 7,
        });
        assert_eq!(summary.hit_rate_percent, 0.0);
        assert_eq!(summary.misses, 7);

        let untouched = TelemetryCacheSummary::from(CacheAggregate {
            namespace: "job:v1".to_owned(),
            hits: 0,
            misses: 0,
        });
        assert_eq!(untouched.hit_rate_percent, 0.0);
    }

    // The two conversions that land on the same wire type must not be
    // interchangeable by accident: one carries a measured p95, the other has
    // none to carry.
    #[test]
    fn a_wake_signal_reports_no_latency_it_never_measured() {
        let bucket_start = datetime!(2026-08-13 09:14:00 UTC);
        let wake = TelemetryVolumePoint::from(WakeSignalBucket {
            bucket_start,
            count: 3,
        });
        assert_eq!(wake.request_count, 3);
        assert_eq!(wake.p95_duration_ms, 0);
        assert_eq!(wake.error_count, 0);

        let volume = TelemetryVolumePoint::from(VolumeBucket {
            bucket_start,
            requests: 3,
            server_errors: 1,
            latency: LatencySummary::new(3, 300, 140, [0, 0, 0, 0, 0, 3, 0, 0]),
        });
        assert_eq!(volume.error_count, 1);
        assert!(volume.p95_duration_ms > 0);
    }

    #[test]
    fn a_route_carries_its_own_error_rate_over_its_own_requests() {
        let summary = TelemetryRouteSummary::from(RouteAggregate {
            route_pattern: "/api/universe/worlds/{worldID}".to_owned(),
            method: "GET".to_owned(),
            requests: 37,
            server_errors: 3,
            latency: LatencySummary::new(37, 3700, 210, [0, 0, 0, 0, 0, 37, 0, 0]),
        });
        assert_eq!(summary.route_pattern, "/api/universe/worlds/{worldID}");
        assert_eq!(summary.error_rate_percent, 8.11);
        assert_eq!(summary.average_duration_ms, 100);
    }
}
