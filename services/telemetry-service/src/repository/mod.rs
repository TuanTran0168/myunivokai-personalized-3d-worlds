//! The storage port, and its adapters.
//!
//! [`RollupRepository`] is a trait rather than a concrete type for one reason
//! that pays for itself immediately: the service layer above it can then be
//! tested against [`memory::InMemoryRollupRepository`] with no database, no
//! container and no fixture loading. Before this trait existed, the only tests
//! this service had asserted the *text* of its SQL - which is worth something
//! and is not the same as proving the read path assembles a correct response.
//!
//! It is also the seam the plan's own "both sinks could run at once" note
//! needs: a second storage backend is a second implementation here, not an
//! edit to anything above.

pub mod memory;
pub mod postgres;

use async_trait::async_trait;
use time::OffsetDateTime;

use crate::domain::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, HttpTotals,
    IngestOutcome, RollupBatch, RouteAggregate, StatusClassCount, VolumeBucket, WakeSignalBucket,
};
use crate::error::Result;

/// Everything this service asks of storage, in the domain's own vocabulary.
///
/// The read methods take `since` as an instant rather than a
/// [`crate::domain::QueryWindow`] because a repository has no business
/// deciding what a window means - it is handed the boundary the service
/// computed, which keeps the clock in exactly one place.
#[async_trait]
pub trait RollupRepository: Send + Sync {
    /// Writes one flush in one transaction, or reports that it was already
    /// written. Idempotency is this method's responsibility because it is the
    /// only thing that can make the inbox insert and the counter additions
    /// atomic with each other.
    async fn record_batch(&self, batch: &RollupBatch) -> Result<IngestOutcome>;

    async fn http_totals(&self, since: OffsetDateTime) -> Result<HttpTotals>;

    /// The same totals over a half-open `[since, until)` interval, which is
    /// what makes "versus the window before this one" answerable.
    ///
    /// Half-open rather than closed on both ends so that two adjacent windows
    /// partition the timeline exactly: a bucket sitting on the boundary must
    /// be counted once, and a closed interval would count it in both.
    async fn http_totals_between(
        &self,
        since: OffsetDateTime,
        until: OffsetDateTime,
    ) -> Result<HttpTotals>;

    async fn status_mix(&self, since: OffsetDateTime) -> Result<Vec<StatusClassCount>>;
    async fn volume_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>>;

    /// The same traffic rolled up to the hour.
    ///
    /// A separate query rather than a fold over [`Self::volume_buckets`]
    /// because a 7-day window is 10,080 minute rows, and summing them in this
    /// process means transferring all of them first. The database groups where
    /// the rows already are.
    async fn hourly_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>>;

    /// Traffic by hour of day, summed across every day in the window.
    async fn hour_of_day(&self, since: OffsetDateTime) -> Result<Vec<HourOfDayBucket>>;
    async fn top_error_codes(
        &self,
        since: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<ErrorCodeAggregate>>;
    async fn wake_signals(&self, since: OffsetDateTime) -> Result<Vec<WakeSignalBucket>>;
    async fn backend_aggregates(&self, since: OffsetDateTime) -> Result<Vec<BackendAggregate>>;
    async fn cache_aggregates(&self, since: OffsetDateTime) -> Result<Vec<CacheAggregate>>;
    async fn route_aggregates(&self, since: OffsetDateTime) -> Result<Vec<RouteAggregate>>;

    /// The oldest interval actually stored, which is not always the one that
    /// was asked for. A service asleep for a week has no data for most of a
    /// 24-hour window, and a chart that does not say so reads as "no traffic"
    /// rather than "no data".
    async fn oldest_bucket_start(&self) -> Result<Option<OffsetDateTime>>;

    /// Deletes everything older than the cutoff and answers how many rows
    /// went, so a sweep that quietly stops working is visible in a log line
    /// rather than only in a disk graph months later.
    async fn delete_before(&self, cutoff: OffsetDateTime) -> Result<u64>;
}
