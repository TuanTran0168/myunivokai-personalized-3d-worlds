//! The write-side model: one envelope, validated, in the shape the tables take
//! it in.
//!
//! [`RollupBatch::from_envelope`] is the only place the wire contract and this
//! service's own schema meet, and it is a named function rather than a serde
//! attribute so the translation is something you can read and test. It does
//! two things no `#[derive]` could:
//!
//! 1. **Flattens error codes out of the HTTP buckets.** On the wire they are a
//!    map hanging off each `{route, method, status}` bucket, because that is
//!    where the gateway counts them. In storage they are their own table keyed
//!    on `{bucket_start, error_code}`, because the question they answer -
//!    "how often did we say SERVICE_WAKING" - has nothing to do with which
//!    route said it, and a column per code would make every new code a
//!    migration.
//! 2. **Derives the message id from the payload** rather than trusting the
//!    envelope's `jobId` or the `Nats-Msg-Id` header. Identity that comes from
//!    the content cannot be spoofed by a publisher that fills the field in
//!    wrongly, and it stays correct if a future publisher forgets the header.

use std::collections::BTreeMap;

use myunivokai_contracts::{telemetry_rollup_message_id, HttpRollupEnvelope, TelemetryHistogram};
use time::OffsetDateTime;

use crate::error::{Error, Result};

/// Whether an envelope was stored or recognised as one already seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestOutcome {
    Stored,
    AlreadyStored,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRollupRow {
    pub route_pattern: String,
    pub method: String,
    pub status_class: i16,
    pub request_count: i64,
    pub duration_sum_ms: i64,
    pub duration_max_ms: i64,
    pub histogram: TelemetryHistogram,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorCodeRollupRow {
    pub error_code: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NatsRollupRow {
    pub service: String,
    pub request_count: i64,
    pub duration_sum_ms: i64,
    pub duration_max_ms: i64,
    pub histogram: TelemetryHistogram,
    pub error_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheRollupRow {
    pub namespace: String,
    pub hits: i64,
    pub misses: i64,
}

/// One flush, ready to be written in one transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollupBatch {
    /// `{instance, bucket start}` - what separates two instances flushing one
    /// interval (two facts) from one instance's interval arriving twice (one
    /// fact, delivered twice).
    pub message_id: String,
    pub instance_id: String,
    pub bucket_start: OffsetDateTime,
    pub http: Vec<HttpRollupRow>,
    pub error_codes: Vec<ErrorCodeRollupRow>,
    pub nats: Vec<NatsRollupRow>,
    pub cache: Vec<CacheRollupRow>,
}

impl RollupBatch {
    pub fn from_envelope(envelope: &HttpRollupEnvelope) -> Result<Self> {
        let data = &envelope.data;
        // The contract validates its own invariants; repeating them here would
        // be a second opinion that can disagree with the first.
        data.validate().map_err(Error::InvalidRollup)?;

        let mut error_code_totals: BTreeMap<String, i64> = BTreeMap::new();
        let mut http = Vec::with_capacity(data.buckets.len());
        for bucket in &data.buckets {
            http.push(HttpRollupRow {
                route_pattern: bucket.route_pattern.clone(),
                method: bucket.method.clone(),
                status_class: i16::from(bucket.status_class),
                request_count: bucket.request_count,
                duration_sum_ms: bucket.duration_sum_ms,
                duration_max_ms: bucket.duration_max_ms,
                histogram: bucket.histogram,
            });
            for (error_code, count) in &bucket.error_codes {
                // Summed across buckets rather than written per bucket: the
                // same code appears under several routes in one interval, and
                // the table's key is {bucket_start, error_code}. Adding here
                // means one row per code per interval instead of one upsert
                // per code per route hammering the same row.
                *error_code_totals.entry(error_code.clone()).or_insert(0) += *count;
            }
        }

        Ok(Self {
            message_id: telemetry_rollup_message_id(&data.instance_id, data.bucket_start),
            instance_id: data.instance_id.clone(),
            bucket_start: data.bucket_start,
            http,
            error_codes: error_code_totals
                .into_iter()
                .map(|(error_code, count)| ErrorCodeRollupRow { error_code, count })
                .collect(),
            nats: data
                .nats_backend_buckets
                .iter()
                .map(|bucket| NatsRollupRow {
                    service: bucket.service.clone(),
                    request_count: bucket.request_count,
                    duration_sum_ms: bucket.duration_sum_ms,
                    duration_max_ms: bucket.duration_max_ms,
                    histogram: bucket.histogram,
                    error_count: bucket.error_count,
                })
                .collect(),
            cache: data
                .cache_buckets
                .iter()
                .map(|bucket| CacheRollupRow {
                    namespace: bucket.namespace.clone(),
                    hits: bucket.hits,
                    misses: bucket.misses,
                })
                .collect(),
        })
    }

    /// How many rows this batch will touch. Logged rather than asserted - it
    /// is the number that says whether one gateway is quietly producing far
    /// more series than the cardinality rule allows.
    pub fn row_count(&self) -> usize {
        self.http.len() + self.error_codes.len() + self.nats.len() + self.cache.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use myunivokai_contracts::{CacheBucket, Envelope, HttpRollupBucket, HttpRollupData};
    use std::collections::HashMap;
    use time::macros::datetime;

    fn envelope_with(buckets: Vec<HttpRollupBucket>) -> HttpRollupEnvelope {
        Envelope::new(
            "job",
            datetime!(2026-08-13 09:15:00 UTC),
            HttpRollupData {
                instance_id: "instance-a".to_owned(),
                bucket_start: datetime!(2026-08-13 09:14:00 UTC),
                bucket_duration_ms: 60_000,
                buckets,
                nats_backend_buckets: Vec::new(),
                cache_buckets: vec![CacheBucket {
                    namespace: "world:v1".to_owned(),
                    hits: 3,
                    misses: 1,
                }],
            },
        )
    }

    fn bucket(route: &str, status_class: u8, error_codes: &[(&str, i64)]) -> HttpRollupBucket {
        HttpRollupBucket {
            route_pattern: route.to_owned(),
            method: "GET".to_owned(),
            status_class,
            request_count: 1,
            duration_sum_ms: 10,
            duration_max_ms: 10,
            histogram: [0, 1, 0, 0, 0, 0, 0, 0],
            error_codes: error_codes
                .iter()
                .map(|(code, count)| ((*code).to_owned(), *count))
                .collect::<HashMap<_, _>>(),
        }
    }

    // The same code appears under several routes in one interval. Writing them
    // per route would mean several upserts hammering one row; summing here
    // means one row per code per interval.
    #[test]
    fn error_codes_are_summed_across_every_route_that_produced_them() {
        let envelope = envelope_with(vec![
            bucket("/api/universe/worlds", 5, &[("SERVICE_WAKING", 2)]),
            bucket("/api/nature/worlds", 5, &[("SERVICE_WAKING", 3)]),
            bucket("/api/jobs/{jobID}", 4, &[("RATE_LIMITED", 1)]),
        ]);

        let batch = RollupBatch::from_envelope(&envelope).expect("valid envelope");

        assert_eq!(batch.error_codes.len(), 2);
        // BTreeMap ordering makes the batch deterministic, which is what keeps
        // two identical envelopes producing identical statements.
        assert_eq!(batch.error_codes[0].error_code, "RATE_LIMITED");
        assert_eq!(batch.error_codes[0].count, 1);
        assert_eq!(batch.error_codes[1].error_code, "SERVICE_WAKING");
        assert_eq!(batch.error_codes[1].count, 5);
    }

    #[test]
    fn a_bucket_with_no_error_code_contributes_no_row() {
        let envelope = envelope_with(vec![bucket("/api/universe/worlds", 2, &[])]);
        let batch = RollupBatch::from_envelope(&envelope).expect("valid envelope");
        assert!(batch.error_codes.is_empty());
        assert_eq!(batch.http.len(), 1);
        assert_eq!(batch.cache.len(), 1);
        assert_eq!(batch.row_count(), 2);
    }

    // Identity comes from the payload, so a publisher that fills jobId in
    // wrongly cannot make one interval look like another.
    #[test]
    fn the_message_id_is_derived_from_the_payload_not_the_envelope() {
        let mut envelope = envelope_with(vec![bucket("/api/universe/worlds", 2, &[])]);
        envelope.job_id = "a-completely-different-id".to_owned();

        let batch = RollupBatch::from_envelope(&envelope).expect("valid envelope");

        assert_eq!(batch.message_id, "instance-a:2026-08-13T09:14:00Z");
    }

    #[test]
    fn an_envelope_the_contract_rejects_never_becomes_a_batch() {
        let mut envelope = envelope_with(vec![bucket("", 2, &[])]);
        envelope.data.instance_id = "  ".to_owned();

        let error = RollupBatch::from_envelope(&envelope).expect_err("must be rejected");

        assert!(matches!(error, Error::InvalidRollup(_)));
        assert!(
            !error.is_retryable(),
            "a malformed envelope must not be naked"
        );
    }
}
