//! Turning a `PgRow` into a domain aggregate.
//!
//! Kept out of the repository body so that the queries read as queries and the
//! decoding reads as decoding. Every function here is total: a column that is
//! missing or of the wrong type is a `sqlx::Error`, never a silent zero, which
//! is the difference between a schema drift that fails loudly and one that
//! shows an empty chart.

use myunivokai_contracts::{TelemetryHistogram, TELEMETRY_HISTOGRAM_BUCKET_COUNT};
use sqlx::postgres::PgRow;
use sqlx::Row;

use crate::domain::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, HttpTotals,
    LatencySummary, RouteAggregate, StatusClassCount, VolumeBucket, WakeSignalBucket,
};

/// The eight columns `statements::histogram_sum_columns!` produces, in order.
const HISTOGRAM_COLUMN_NAMES: [&str; TELEMETRY_HISTOGRAM_BUCKET_COUNT] = [
    "histogram_1",
    "histogram_2",
    "histogram_3",
    "histogram_4",
    "histogram_5",
    "histogram_6",
    "histogram_7",
    "histogram_8",
];

fn histogram(row: &PgRow) -> Result<TelemetryHistogram, sqlx::Error> {
    let mut histogram: TelemetryHistogram = [0; TELEMETRY_HISTOGRAM_BUCKET_COUNT];
    for (index, column_name) in HISTOGRAM_COLUMN_NAMES.iter().enumerate() {
        histogram[index] = row.try_get(*column_name)?;
    }
    Ok(histogram)
}

/// The four columns every latency-bearing query selects, decoded once.
fn latency(row: &PgRow, count: i64) -> Result<LatencySummary, sqlx::Error> {
    Ok(LatencySummary::new(
        count,
        row.try_get("duration_sum_ms")?,
        row.try_get("duration_max_ms")?,
        histogram(row)?,
    ))
}

/// The totals query selects no `duration_sum_ms` for the volume buckets, so
/// that one decodes its latency with a zero sum - a bucket's average is not
/// shown anywhere, only its p95.
fn latency_without_sum(row: &PgRow, count: i64) -> Result<LatencySummary, sqlx::Error> {
    Ok(LatencySummary::new(
        count,
        0,
        row.try_get("duration_max_ms")?,
        histogram(row)?,
    ))
}

pub fn http_totals(row: &PgRow) -> Result<HttpTotals, sqlx::Error> {
    let requests: i64 = row.try_get("request_count")?;
    Ok(HttpTotals {
        requests,
        server_errors: row.try_get("error_count")?,
        latency: latency(row, requests)?,
    })
}

pub fn status_class_count(row: &PgRow) -> Result<StatusClassCount, sqlx::Error> {
    let status_class: i16 = row.try_get("status_class")?;
    Ok(StatusClassCount {
        // The contract bounds this to 1..5 and a CHECK does not; a class
        // outside the range is reported rather than dropped, because a handler
        // producing one is broken and losing the observation hides exactly
        // that.
        status_class: status_class.clamp(0, i16::from(u8::MAX)) as u8,
        requests: row.try_get("request_count")?,
    })
}

pub fn volume_bucket(row: &PgRow) -> Result<VolumeBucket, sqlx::Error> {
    let requests: i64 = row.try_get("request_count")?;
    Ok(VolumeBucket {
        bucket_start: row.try_get("bucket_start")?,
        requests,
        server_errors: row.try_get("error_count")?,
        latency: latency_without_sum(row, requests)?,
    })
}

pub fn hour_of_day_bucket(row: &PgRow) -> Result<HourOfDayBucket, sqlx::Error> {
    let requests: i64 = row.try_get("request_count")?;
    let hour: i16 = row.try_get("hour_of_day")?;
    Ok(HourOfDayBucket {
        // EXTRACT(HOUR ...) cannot leave 0..=23, so this clamp never fires. It
        // is here because the alternative at this boundary is `as u8`, which
        // would turn an impossible negative into 255 silently rather than into
        // something a reader can reason about.
        hour: hour.clamp(0, 23) as u8,
        requests,
        server_errors: row.try_get("error_count")?,
        latency: latency_without_sum(row, requests)?,
    })
}

pub fn error_code_aggregate(row: &PgRow) -> Result<ErrorCodeAggregate, sqlx::Error> {
    Ok(ErrorCodeAggregate {
        error_code: row.try_get("error_code")?,
        count: row.try_get("count")?,
    })
}

pub fn wake_signal_bucket(row: &PgRow) -> Result<WakeSignalBucket, sqlx::Error> {
    Ok(WakeSignalBucket {
        bucket_start: row.try_get("bucket_start")?,
        count: row.try_get("count")?,
    })
}

pub fn backend_aggregate(row: &PgRow) -> Result<BackendAggregate, sqlx::Error> {
    let requests: i64 = row.try_get("request_count")?;
    Ok(BackendAggregate {
        service: row.try_get("service")?,
        requests,
        errors: row.try_get("error_count")?,
        latency: latency(row, requests)?,
    })
}

pub fn cache_aggregate(row: &PgRow) -> Result<CacheAggregate, sqlx::Error> {
    Ok(CacheAggregate {
        namespace: row.try_get("namespace")?,
        hits: row.try_get("hits")?,
        misses: row.try_get("misses")?,
    })
}

pub fn route_aggregate(row: &PgRow) -> Result<RouteAggregate, sqlx::Error> {
    let requests: i64 = row.try_get("request_count")?;
    Ok(RouteAggregate {
        route_pattern: row.try_get("route_pattern")?,
        method: row.try_get("method")?,
        requests,
        server_errors: row.try_get("error_count")?,
        latency: latency(row, requests)?,
    })
}
