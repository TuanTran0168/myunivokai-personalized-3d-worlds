//! Builders for the envelopes the tests need.
//!
//! Public rather than `#[cfg(test)]` for the same reason
//! [`crate::repository::memory`] is: integration tests under `tests/` are
//! separate crates and cannot see a unit-test module. Keeping the builders
//! here means a unit test and an integration test construct the same shapes
//! the same way, instead of two hand-rolled fixtures drifting apart.

use std::collections::HashMap;

use myunivokai_contracts::{
    telemetry_histogram_index_of, CacheBucket, Envelope, HttpRollupBucket, HttpRollupData,
    HttpRollupEnvelope, NatsBackendBucket, TelemetryHistogram,
};
use time::OffsetDateTime;

/// A rollup bucket, built by naming only what a test cares about.
#[derive(Debug, Clone)]
pub struct TestBucket {
    route_pattern: String,
    method: String,
    status_class: u8,
    request_count: i64,
    duration_sum_ms: i64,
    duration_max_ms: i64,
    error_codes: HashMap<String, i64>,
    explicit_histogram: Option<TelemetryHistogram>,
}

impl TestBucket {
    pub fn successful(
        route_pattern: &str,
        request_count: i64,
        duration_sum_ms: i64,
        duration_max_ms: i64,
    ) -> Self {
        Self::with_status(
            route_pattern,
            2,
            request_count,
            duration_sum_ms,
            duration_max_ms,
        )
    }

    pub fn with_status(
        route_pattern: &str,
        status_class: u8,
        request_count: i64,
        duration_sum_ms: i64,
        duration_max_ms: i64,
    ) -> Self {
        Self {
            route_pattern: route_pattern.to_owned(),
            method: "GET".to_owned(),
            status_class,
            request_count,
            duration_sum_ms,
            duration_max_ms,
            error_codes: HashMap::new(),
            explicit_histogram: None,
        }
    }

    pub fn with_method(mut self, method: &str) -> Self {
        self.method = method.to_owned();
        self
    }

    /// A bucket whose observations are spread across latency buckets by hand.
    ///
    /// [`Self::with_status`] puts every observation in the maximum's bucket,
    /// which is what most tests want and is useless for the one thing a spread
    /// distribution exists to show: that the median and the tail are different
    /// numbers. The caller owns the invariant here — the histogram must sum to
    /// `request_count`, and [`Self::histogram`]'s doc says why.
    pub fn with_histogram(
        route_pattern: &str,
        status_class: u8,
        request_count: i64,
        duration_sum_ms: i64,
        duration_max_ms: i64,
        histogram: TelemetryHistogram,
    ) -> Self {
        Self {
            explicit_histogram: Some(histogram),
            ..Self::with_status(
                route_pattern,
                status_class,
                request_count,
                duration_sum_ms,
                duration_max_ms,
            )
        }
    }

    pub fn with_error_code(mut self, error_code: &str, count: i64) -> Self {
        self.error_codes.insert(error_code.to_owned(), count);
        self
    }

    /// Places every observation in the bucket the maximum falls into, so the
    /// histogram always sums to the request count — the invariant the contract
    /// test enforces on the shared fixture. A test double that violated it
    /// would let a percentile assertion pass on data the gateway cannot
    /// produce.
    fn histogram(&self) -> TelemetryHistogram {
        if let Some(explicit) = self.explicit_histogram {
            return explicit;
        }
        let mut histogram: TelemetryHistogram = [0; 8];
        histogram[telemetry_histogram_index_of(self.duration_max_ms)] = self.request_count;
        histogram
    }
}

impl From<&TestBucket> for HttpRollupBucket {
    fn from(bucket: &TestBucket) -> Self {
        HttpRollupBucket {
            route_pattern: bucket.route_pattern.clone(),
            method: bucket.method.clone(),
            status_class: bucket.status_class,
            request_count: bucket.request_count,
            duration_sum_ms: bucket.duration_sum_ms,
            duration_max_ms: bucket.duration_max_ms,
            histogram: bucket.histogram(),
            error_codes: bucket.error_codes.clone(),
        }
    }
}

/// One envelope carrying the given HTTP buckets and nothing else.
pub fn rollup_envelope(
    instance_id: &str,
    bucket_start: OffsetDateTime,
    buckets: &[TestBucket],
) -> HttpRollupEnvelope {
    rollup_envelope_with(instance_id, bucket_start, buckets, &[], &[])
}

/// One envelope carrying all three concerns, as a real flush does.
pub fn rollup_envelope_with(
    instance_id: &str,
    bucket_start: OffsetDateTime,
    buckets: &[TestBucket],
    nats_backend_buckets: &[NatsBackendBucket],
    cache_buckets: &[CacheBucket],
) -> HttpRollupEnvelope {
    let data = HttpRollupData {
        instance_id: instance_id.to_owned(),
        bucket_start,
        bucket_duration_ms: 60_000,
        buckets: buckets.iter().map(HttpRollupBucket::from).collect(),
        nats_backend_buckets: nats_backend_buckets.to_vec(),
        cache_buckets: cache_buckets.to_vec(),
    };
    Envelope::new(
        myunivokai_contracts::telemetry_rollup_message_id(instance_id, bucket_start),
        bucket_start,
        data,
    )
}

/// A backend round-trip bucket with its histogram already consistent.
pub fn backend_bucket(
    service: &str,
    request_count: i64,
    duration_sum_ms: i64,
    duration_max_ms: i64,
    error_count: i64,
) -> NatsBackendBucket {
    let mut histogram: TelemetryHistogram = [0; 8];
    histogram[telemetry_histogram_index_of(duration_max_ms)] = request_count;
    NatsBackendBucket {
        service: service.to_owned(),
        request_count,
        duration_sum_ms,
        duration_max_ms,
        histogram,
        error_count,
    }
}

pub fn cache_bucket(namespace: &str, hits: i64, misses: i64) -> CacheBucket {
    CacheBucket {
        namespace: namespace.to_owned(),
        hits,
        misses,
    }
}
