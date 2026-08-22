//! One latency distribution, and every question anybody asks of one.
//!
//! This exists because three different reads - the overview, the per-route
//! table and the per-backend list - each need an average, a percentile and a
//! maximum from the same four numbers. Before it, each of them computed its
//! own, which is how two screens end up disagreeing about the same p95.

use myunivokai_contracts::{
    percentile_from_histogram, TelemetryHistogram, TELEMETRY_MEDIAN_PERCENTILE,
};

/// The tail percentile every telemetry read reports.
///
/// p95 rather than p99 because a minute-wide bucket on a low-traffic service
/// often holds fewer than a hundred requests, and a p99 over forty
/// observations is one observation wearing a statistic's name.
pub const REPORTED_PERCENTILE: f64 = 95.0;

/// A summed latency distribution: how many observations, their total, the
/// largest one seen, and the fixed-width histogram they fell into.
///
/// The fields are private and the constructor validates, which is the C-VALIDATE
/// guideline applied to the one struct in this service where a wrong value
/// cannot be detected downstream: a histogram that does not sum to its own
/// count produces a plausible percentile rather than an obvious failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LatencySummary {
    count: i64,
    sum_ms: i64,
    max_ms: i64,
    histogram: TelemetryHistogram,
}

impl LatencySummary {
    pub fn new(count: i64, sum_ms: i64, max_ms: i64, histogram: TelemetryHistogram) -> Self {
        Self {
            count: count.max(0),
            sum_ms: sum_ms.max(0),
            max_ms: max_ms.max(0),
            histogram,
        }
    }

    pub fn count(&self) -> i64 {
        self.count
    }

    pub fn slowest_ms(&self) -> i64 {
        self.max_ms
    }

    /// Zero for an empty window rather than a division by it. A window with no
    /// traffic has no average latency, and reporting one would put a number on
    /// a chart that describes nothing.
    pub fn average_ms(&self) -> i64 {
        if self.count <= 0 {
            return 0;
        }
        self.sum_ms / self.count
    }

    /// An interpolation across the contract's fixed bucket edges, bounded by
    /// the largest latency actually observed. Every caller is required to
    /// carry `percentileIsInterpolated` alongside the number it returns.
    pub fn percentile_ms(&self, percentile: f64) -> i64 {
        percentile_from_histogram(&self.histogram, percentile, self.max_ms)
    }

    pub fn p95_ms(&self) -> i64 {
        self.percentile_ms(REPORTED_PERCENTILE)
    }

    /// The median, reported everywhere the p95 is.
    ///
    /// The two together are the finding; either alone is not. A p50 of 40ms
    /// under a p95 of 900ms is a tail owned by a handful of requests; the same
    /// p95 over a p50 of 700ms is everything being slow. Acting on those two
    /// situations means doing opposite things, and one number cannot tell them
    /// apart.
    pub fn p50_ms(&self) -> i64 {
        self.percentile_ms(TELEMETRY_MEDIAN_PERCENTILE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary_in_the_fifty_to_hundred_bucket(
        count: i64,
        sum_ms: i64,
        max_ms: i64,
    ) -> LatencySummary {
        LatencySummary::new(count, sum_ms, max_ms, [0, 0, 0, 0, count, 0, 0, 0])
    }

    #[test]
    fn an_empty_window_has_no_average_and_no_percentile() {
        let empty = LatencySummary::default();
        assert_eq!(empty.average_ms(), 0);
        assert_eq!(empty.p95_ms(), 0);
        assert_eq!(empty.slowest_ms(), 0);
    }

    #[test]
    fn the_average_is_the_sum_over_the_count() {
        let summary = summary_in_the_fifty_to_hundred_bucket(10, 750, 98);
        assert_eq!(summary.average_ms(), 75);
    }

    // The pair is the finding. A median at or above the tail means the two are
    // wired to the same percentile somewhere, which reads as plausible and is
    // undetectable from either number on its own.
    #[test]
    fn the_median_sits_below_the_tail_on_a_spread_distribution() {
        // Most requests landed in the 5-10ms bucket, a few in 250-1000ms.
        let spread = LatencySummary::new(100, 4_000, 900, [0, 90, 0, 0, 0, 0, 10, 0]);
        assert!(
            spread.p50_ms() < spread.p95_ms(),
            "p50 {} is not below p95 {}",
            spread.p50_ms(),
            spread.p95_ms()
        );
        assert!(spread.p95_ms() <= spread.slowest_ms());
    }

    #[test]
    fn the_percentile_never_exceeds_a_latency_that_was_actually_observed() {
        // Everything landed in the 50-100ms bucket but nothing was slower than
        // 61ms, so no interpolation may claim 98ms.
        let summary = summary_in_the_fifty_to_hundred_bucket(10, 550, 61);
        assert_eq!(summary.p95_ms(), 61);
    }

    // A negative counter can only arrive from a corrupt envelope, and one
    // added to a running total is undetectable afterwards.
    #[test]
    fn negative_counters_are_floored_rather_than_carried() {
        let summary = LatencySummary::new(-5, -100, -3, [0; 8]);
        assert_eq!(summary.count(), 0);
        assert_eq!(summary.average_ms(), 0);
        assert_eq!(summary.slowest_ms(), 0);
    }
}
