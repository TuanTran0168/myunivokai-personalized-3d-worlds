//! What a read returns from storage, before anything turns it into a wire
//! response.
//!
//! These sit between the repository and the service on purpose. If the
//! repository returned `myunivokai_contracts` types directly, the SQL layer
//! would be the thing deciding what a percentage is called and whether a
//! percentile is interpolated - and changing the admin app's response shape
//! would mean editing a query. Here, a repository answers in this vocabulary
//! and the service translates once.

use time::OffsetDateTime;

use super::latency::LatencySummary;

/// Everything the window totals to, across every route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HttpTotals {
    pub requests: i64,
    /// 5xx only. A 404 or a validation failure is the client's problem, and
    /// folding it in would produce an error rate that never goes down.
    pub server_errors: i64,
    pub latency: LatencySummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusClassCount {
    pub status_class: u8,
    pub requests: i64,
}

/// One time bucket of the volume chart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VolumeBucket {
    pub bucket_start: OffsetDateTime,
    pub requests: i64,
    pub server_errors: i64,
    pub latency: LatencySummary,
}

/// One hour of the day, summed across every day in the window.
///
/// Deliberately not the same type as [`VolumeBucket`]. A volume bucket sits at
/// an instant on a timeline; this sits at an hour that recurs, and the two
/// answer different questions - "when was it busy" versus "when is it always
/// busy". Sharing one type would let a chart plot one where the other belongs
/// and still compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HourOfDayBucket {
    /// 0-23, UTC.
    pub hour: u8,
    pub requests: i64,
    pub server_errors: i64,
    pub latency: LatencySummary,
}

/// One row of the per-route table, keyed on the chi TEMPLATE and the method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteAggregate {
    pub route_pattern: String,
    pub method: String,
    pub requests: i64,
    pub server_errors: i64,
    pub latency: LatencySummary,
}

/// One backend service's round-trip summary. This is the question end-to-end
/// response time cannot answer: `/api/{family}/worlds` reaches universe or
/// nature depending on the family, and both wear the same route template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendAggregate {
    pub service: String,
    pub requests: i64,
    /// Includes no-responders and deadline exceeded, which are the two
    /// failures a sleeping service actually produces.
    pub errors: i64,
    pub latency: LatencySummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheAggregate {
    pub namespace: String,
    pub hits: i64,
    pub misses: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorCodeAggregate {
    pub error_code: String,
    pub count: i64,
}

/// SERVICE_WAKING responses in one time bucket - the closest this schema gets
/// to a wake-conversion rate. An approximation joined on time proximity, not a
/// per-request causal trace, and the admin UI is required to say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WakeSignalBucket {
    pub bucket_start: OffsetDateTime,
    pub count: i64,
}
