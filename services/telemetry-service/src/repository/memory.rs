//! An in-memory [`RollupRepository`], shipped rather than hidden behind
//! `#[cfg(test)]`.
//!
//! It exists so the read path can be tested for what it *computes* rather than
//! for what SQL it contains. Integration tests under `tests/` are separate
//! crates and cannot see `#[cfg(test)]` items, which is why this is a normal
//! public module — the same reason the standard library ships `io::Cursor`.
//!
//! It is a faithful double, not a stub: it accumulates on conflict exactly as
//! the `ON CONFLICT ... +` clauses do, takes the greater of two maxima, sums
//! histograms elementwise, and treats a repeated message id as a no-op. A
//! double that behaved differently would let a test pass on behaviour the
//! database does not have.

use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;

use async_trait::async_trait;
use myunivokai_contracts::TelemetryHistogram;
use time::OffsetDateTime;

use super::RollupRepository;
use crate::domain::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, HttpTotals,
    IngestOutcome, LatencySummary, RollupBatch, RouteAggregate, StatusClassCount, VolumeBucket,
    WakeSignalBucket,
};
use crate::error::{Error, Result};

const SERVER_ERROR_STATUS_CLASS: i16 = 5;
const WAKE_SIGNAL_ERROR_CODE: &str = "SERVICE_WAKING";

/// `date_trunc('hour', ... AT TIME ZONE 'UTC')`, in Rust.
///
/// The conversion to UTC is not decoration. The SQL states its zone explicitly
/// so two connections cannot disagree about where an hour starts, and a double
/// that truncated in whatever offset the value happened to carry would place
/// the same minute in a different hour than the database does.
fn truncate_to_hour(instant: OffsetDateTime) -> OffsetDateTime {
    let utc = instant.to_offset(time::UtcOffset::UTC);
    utc.replace_minute(0)
        .and_then(|value| value.replace_second(0))
        .and_then(|value| value.replace_nanosecond(0))
        .unwrap_or(utc)
}

#[derive(Debug, Clone, Copy, Default)]
struct Counters {
    count: i64,
    sum_ms: i64,
    max_ms: i64,
    histogram: TelemetryHistogram,
}

impl Counters {
    fn accumulate(&mut self, count: i64, sum_ms: i64, max_ms: i64, histogram: TelemetryHistogram) {
        self.count += count;
        self.sum_ms += sum_ms;
        self.max_ms = self.max_ms.max(max_ms);
        // Elementwise, exactly as the `ON CONFLICT` clause's UNNEST does. A
        // double that summed differently would let a percentile assertion pass
        // on behaviour the database does not have.
        for (stored, incoming) in self.histogram.iter_mut().zip(histogram.iter()) {
            *stored += incoming;
        }
    }

    fn summary(&self) -> LatencySummary {
        LatencySummary::new(self.count, self.sum_ms, self.max_ms, self.histogram)
    }
}

/// Keyed exactly as the tables are, so a test that passes here is a test that
/// exercised the same grouping the database performs.
#[derive(Default)]
struct State {
    processed_message_ids: HashSet<String>,
    http: BTreeMap<(OffsetDateTime, String, String, i16), Counters>,
    error_codes: BTreeMap<(OffsetDateTime, String), i64>,
    nats: BTreeMap<(OffsetDateTime, String), (Counters, i64)>,
    cache: BTreeMap<(OffsetDateTime, String), (i64, i64)>,
    /// Set to make the next call fail, so the consumer's nak path is testable
    /// without an unreachable database.
    next_failure: Option<&'static str>,
}

#[derive(Default)]
pub struct InMemoryRollupRepository {
    state: Mutex<State>,
}

impl InMemoryRollupRepository {
    pub fn new() -> Self {
        Self::default()
    }

    /// Makes the next repository call fail with a retryable storage error.
    pub fn fail_next_call(&self, reason: &'static str) {
        self.state.lock().expect("repository lock").next_failure = Some(reason);
    }

    fn take_failure(&self) -> Result<()> {
        let failure = self
            .state
            .lock()
            .expect("repository lock")
            .next_failure
            .take();
        match failure {
            // A pool timeout is the closest stand-in for "the database was
            // briefly unreachable", which is the case the consumer naks on.
            Some(_) => Err(Error::Storage(sqlx::Error::PoolTimedOut)),
            None => Ok(()),
        }
    }

    pub fn stored_message_count(&self) -> usize {
        self.state
            .lock()
            .expect("repository lock")
            .processed_message_ids
            .len()
    }
}

#[async_trait]
impl RollupRepository for InMemoryRollupRepository {
    async fn record_batch(&self, batch: &RollupBatch) -> Result<IngestOutcome> {
        self.take_failure()?;
        let mut state = self.state.lock().expect("repository lock");
        if !state.processed_message_ids.insert(batch.message_id.clone()) {
            return Ok(IngestOutcome::AlreadyStored);
        }

        for row in &batch.http {
            state
                .http
                .entry((
                    batch.bucket_start,
                    row.route_pattern.clone(),
                    row.method.clone(),
                    row.status_class,
                ))
                .or_default()
                .accumulate(
                    row.request_count,
                    row.duration_sum_ms,
                    row.duration_max_ms,
                    row.histogram,
                );
        }
        for row in &batch.error_codes {
            *state
                .error_codes
                .entry((batch.bucket_start, row.error_code.clone()))
                .or_insert(0) += row.count;
        }
        for row in &batch.nats {
            let entry = state
                .nats
                .entry((batch.bucket_start, row.service.clone()))
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                row.request_count,
                row.duration_sum_ms,
                row.duration_max_ms,
                row.histogram,
            );
            entry.1 += row.error_count;
        }
        for row in &batch.cache {
            let entry = state
                .cache
                .entry((batch.bucket_start, row.namespace.clone()))
                .or_insert((0, 0));
            entry.0 += row.hits;
            entry.1 += row.misses;
        }
        Ok(IngestOutcome::Stored)
    }

    async fn http_totals(&self, since: OffsetDateTime) -> Result<HttpTotals> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut totals = Counters::default();
        let mut server_errors = 0;
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            if *bucket_start < since {
                continue;
            }
            totals.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                server_errors += counters.count;
            }
        }
        Ok(HttpTotals {
            requests: totals.count,
            server_errors,
            latency: totals.summary(),
        })
    }

    async fn http_totals_between(
        &self,
        since: OffsetDateTime,
        until: OffsetDateTime,
    ) -> Result<HttpTotals> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut totals = Counters::default();
        let mut server_errors = 0;
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            // Half-open, matching SELECT_TOTALS_BETWEEN exactly. A double that
            // closed the upper bound would let a comparison test pass on
            // arithmetic the database does not perform.
            if *bucket_start < since || *bucket_start >= until {
                continue;
            }
            totals.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                server_errors += counters.count;
            }
        }
        Ok(HttpTotals {
            requests: totals.count,
            server_errors,
            latency: totals.summary(),
        })
    }

    async fn status_mix(&self, since: OffsetDateTime) -> Result<Vec<StatusClassCount>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<i16, i64> = BTreeMap::new();
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            if *bucket_start >= since {
                *grouped.entry(*status_class).or_insert(0) += counters.count;
            }
        }
        Ok(grouped
            .into_iter()
            .map(|(status_class, requests)| StatusClassCount {
                status_class: status_class.max(0) as u8,
                requests,
            })
            .collect())
    }

    async fn volume_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<OffsetDateTime, (Counters, i64)> = BTreeMap::new();
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped
                .entry(*bucket_start)
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                entry.1 += counters.count;
            }
        }
        Ok(grouped
            .into_iter()
            .map(|(bucket_start, (counters, server_errors))| VolumeBucket {
                bucket_start,
                requests: counters.count,
                server_errors,
                latency: counters.summary(),
            })
            .collect())
    }

    async fn hourly_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<OffsetDateTime, (Counters, i64)> = BTreeMap::new();
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped
                .entry(truncate_to_hour(*bucket_start))
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                entry.1 += counters.count;
            }
        }
        Ok(grouped
            .into_iter()
            .map(|(bucket_start, (counters, server_errors))| VolumeBucket {
                bucket_start,
                requests: counters.count,
                server_errors,
                latency: counters.summary(),
            })
            .collect())
    }

    async fn hour_of_day(&self, since: OffsetDateTime) -> Result<Vec<HourOfDayBucket>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<u8, (Counters, i64)> = BTreeMap::new();
        for ((bucket_start, _, _, status_class), counters) in &state.http {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped
                .entry(bucket_start.to_offset(time::UtcOffset::UTC).hour())
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                entry.1 += counters.count;
            }
        }
        Ok(grouped
            .into_iter()
            .map(|(hour, (counters, server_errors))| HourOfDayBucket {
                hour,
                requests: counters.count,
                server_errors,
                latency: counters.summary(),
            })
            .collect())
    }

    async fn top_error_codes(
        &self,
        since: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<ErrorCodeAggregate>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<String, i64> = BTreeMap::new();
        for ((bucket_start, error_code), count) in &state.error_codes {
            if *bucket_start >= since {
                *grouped.entry(error_code.clone()).or_insert(0) += count;
            }
        }
        let mut aggregates: Vec<ErrorCodeAggregate> = grouped
            .into_iter()
            .map(|(error_code, count)| ErrorCodeAggregate { error_code, count })
            .collect();
        aggregates.sort_by(|left, right| {
            right
                .count
                .cmp(&left.count)
                .then_with(|| left.error_code.cmp(&right.error_code))
        });
        aggregates.truncate(limit.max(0) as usize);
        Ok(aggregates)
    }

    async fn wake_signals(&self, since: OffsetDateTime) -> Result<Vec<WakeSignalBucket>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        Ok(state
            .error_codes
            .iter()
            .filter(|((bucket_start, error_code), _)| {
                *bucket_start >= since && error_code == WAKE_SIGNAL_ERROR_CODE
            })
            .map(|((bucket_start, _), count)| WakeSignalBucket {
                bucket_start: *bucket_start,
                count: *count,
            })
            .collect())
    }

    async fn backend_aggregates(&self, since: OffsetDateTime) -> Result<Vec<BackendAggregate>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<String, (Counters, i64)> = BTreeMap::new();
        for ((bucket_start, service), (counters, errors)) in &state.nats {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped
                .entry(service.clone())
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            entry.1 += errors;
        }
        Ok(grouped
            .into_iter()
            .map(|(service, (counters, errors))| BackendAggregate {
                service,
                requests: counters.count,
                errors,
                latency: counters.summary(),
            })
            .collect())
    }

    async fn cache_aggregates(&self, since: OffsetDateTime) -> Result<Vec<CacheAggregate>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        for ((bucket_start, namespace), (hits, misses)) in &state.cache {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped.entry(namespace.clone()).or_insert((0, 0));
            entry.0 += hits;
            entry.1 += misses;
        }
        Ok(grouped
            .into_iter()
            .map(|(namespace, (hits, misses))| CacheAggregate {
                namespace,
                hits,
                misses,
            })
            .collect())
    }

    async fn route_aggregates(&self, since: OffsetDateTime) -> Result<Vec<RouteAggregate>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        let mut grouped: BTreeMap<(String, String), (Counters, i64)> = BTreeMap::new();
        for ((bucket_start, route_pattern, method, status_class), counters) in &state.http {
            if *bucket_start < since {
                continue;
            }
            let entry = grouped
                .entry((route_pattern.clone(), method.clone()))
                .or_insert((Counters::default(), 0));
            entry.0.accumulate(
                counters.count,
                counters.sum_ms,
                counters.max_ms,
                counters.histogram,
            );
            if *status_class >= SERVER_ERROR_STATUS_CLASS {
                entry.1 += counters.count;
            }
        }
        let mut aggregates: Vec<RouteAggregate> = grouped
            .into_iter()
            .map(
                |((route_pattern, method), (counters, server_errors))| RouteAggregate {
                    route_pattern,
                    method,
                    requests: counters.count,
                    server_errors,
                    latency: counters.summary(),
                },
            )
            .collect();
        aggregates.sort_by(|left, right| {
            right
                .requests
                .cmp(&left.requests)
                .then_with(|| left.route_pattern.cmp(&right.route_pattern))
                .then_with(|| left.method.cmp(&right.method))
        });
        Ok(aggregates)
    }

    async fn oldest_bucket_start(&self) -> Result<Option<OffsetDateTime>> {
        self.take_failure()?;
        let state = self.state.lock().expect("repository lock");
        Ok(state
            .http
            .keys()
            .map(|(bucket_start, _, _, _)| *bucket_start)
            .min())
    }

    async fn delete_before(&self, cutoff: OffsetDateTime) -> Result<u64> {
        self.take_failure()?;
        let mut state = self.state.lock().expect("repository lock");
        let before =
            state.http.len() + state.error_codes.len() + state.nats.len() + state.cache.len();
        state
            .http
            .retain(|(bucket_start, _, _, _), _| *bucket_start >= cutoff);
        state
            .error_codes
            .retain(|(bucket_start, _), _| *bucket_start >= cutoff);
        state
            .nats
            .retain(|(bucket_start, _), _| *bucket_start >= cutoff);
        state
            .cache
            .retain(|(bucket_start, _), _| *bucket_start >= cutoff);
        let after =
            state.http.len() + state.error_codes.len() + state.nats.len() + state.cache.len();
        Ok((before - after) as u64)
    }
}
