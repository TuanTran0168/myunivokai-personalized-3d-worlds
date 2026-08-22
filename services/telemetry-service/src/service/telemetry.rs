//! `TelemetryService` — the read and write policy, over a repository trait.

use std::sync::Arc;

use myunivokai_contracts::{
    HttpRollupEnvelope, TelemetryComparison, TelemetryDelta, TelemetryFunnelStage,
    TelemetryOverviewQueryData, TelemetryOverviewResponseData, TelemetryRouteListQueryData,
    TelemetryRouteListResponseData, TelemetrySinkDescriptor, TELEMETRY_FUNNEL_STAGE_ACCEPTED,
    TELEMETRY_FUNNEL_STAGE_RECEIVED, TELEMETRY_FUNNEL_STAGE_SERVED,
};
use time::OffsetDateTime;

use crate::domain::{HttpTotals, IngestOutcome, QueryWindow, RollupBatch, StatusClassCount};
use crate::error::Result;
use crate::repository::RollupRepository;
use crate::service::mapping::percentage_of;

/// How many error codes the overview carries. The gateway declares well under
/// a dozen; ten is enough to see every one that matters and short enough that
/// a rare code cannot push a common one off a screen.
const ERROR_CODE_TOP_LIMIT: i64 = 10;

/// 4xx. The funnel subtracts this class and the server-error class in turn,
/// which is only well defined because the two are disjoint.
const CLIENT_ERROR_STATUS_CLASS: u8 = 4;

pub struct TelemetryService {
    repository: Arc<dyn RollupRepository>,
    retention_days: i64,
}

impl TelemetryService {
    pub fn new(repository: Arc<dyn RollupRepository>, retention_days: i64) -> Self {
        Self {
            repository,
            retention_days,
        }
    }

    /// Translates one envelope into the storage model and hands it to the
    /// repository. The translation is [`RollupBatch::from_envelope`]; the
    /// transaction is the repository's. This method exists so that neither of
    /// them has to know about the other.
    pub async fn ingest(&self, envelope: &HttpRollupEnvelope) -> Result<IngestOutcome> {
        let batch = RollupBatch::from_envelope(envelope)?;
        tracing::debug!(
            message_id = %batch.message_id,
            rows = batch.row_count(),
            "storing a telemetry rollup"
        );
        self.repository.record_batch(&batch).await
    }

    /// Assembles the Telemetry screen's top half from eight reads.
    ///
    /// They are eight statements rather than one join because they group
    /// differently — by nothing, by status class, by bucket, by error code, by
    /// service, by namespace — and a single query producing all of them would
    /// be a cross join nobody could read or explain the cost of.
    pub async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
        descriptor: TelemetrySinkDescriptor,
        now: OffsetDateTime,
    ) -> Result<TelemetryOverviewResponseData> {
        let window = QueryWindow::from_hours(query.hours);
        let since = window.since(now);

        let totals = self.repository.http_totals(since).await?;
        let status_mix = self.repository.status_mix(since).await?;
        let volume_buckets = self.repository.volume_buckets(since).await?;
        let hourly_buckets = self.repository.hourly_buckets(since).await?;
        let hour_of_day = self.repository.hour_of_day(since).await?;
        let error_codes = self
            .repository
            .top_error_codes(since, ERROR_CODE_TOP_LIMIT)
            .await?;
        let backends = self.repository.backend_aggregates(since).await?;
        let cache = self.repository.cache_aggregates(since).await?;
        let wake_signals = self.repository.wake_signals(since).await?;
        let oldest_bucket_start = self.repository.oldest_bucket_start().await?;

        let (previous_start, previous_end) = window.previous(now);
        let previous_totals = self
            .repository
            .http_totals_between(previous_start, previous_end)
            .await?;

        // Computed before the arrays are consumed by the mapping below.
        let traffic_funnel = traffic_funnel(&totals, &status_mix);
        let peak_hour = hourly_buckets
            .iter()
            .copied()
            .max_by_key(|bucket| bucket.requests)
            .filter(|bucket| bucket.requests > 0)
            .map(Into::into);

        Ok(TelemetryOverviewResponseData {
            sink: descriptor,
            hours: window.hours(),
            generated_at: now,
            total_requests: totals.requests,
            error_requests: totals.server_errors,
            error_rate_percent: percentage_of(totals.server_errors, totals.requests),
            average_duration_ms: totals.latency.average_ms(),
            p50_duration_ms: totals.latency.p50_ms(),
            p95_duration_ms: totals.latency.p95_ms(),
            slowest_duration_ms: totals.latency.slowest_ms(),
            // Always true when this service answered from its own storage. The
            // admin UI is required to render it next to the number: a p95 that
            // looks exact and is not is worse than no p95.
            percentile_is_interpolated: true,
            status_mix: status_mix.into_iter().map(Into::into).collect(),
            volume_points: volume_buckets.into_iter().map(Into::into).collect(),
            hourly_points: hourly_buckets.into_iter().map(Into::into).collect(),
            peak_hour,
            hour_of_day: hour_of_day.into_iter().map(Into::into).collect(),
            comparison: comparison(previous_start, &totals, &previous_totals),
            traffic_funnel,
            error_code_top: error_codes.into_iter().map(Into::into).collect(),
            backends: backends.into_iter().map(Into::into).collect(),
            cache: cache.into_iter().map(Into::into).collect(),
            wake_signals: wake_signals.into_iter().map(Into::into).collect(),
            oldest_bucket_start,
        })
    }

    pub async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
        descriptor: TelemetrySinkDescriptor,
        now: OffsetDateTime,
    ) -> Result<TelemetryRouteListResponseData> {
        let window = QueryWindow::from_hours(query.hours);
        let routes = self.repository.route_aggregates(window.since(now)).await?;

        Ok(TelemetryRouteListResponseData {
            sink: descriptor,
            hours: window.hours(),
            generated_at: now,
            percentile_is_interpolated: true,
            routes: routes.into_iter().map(Into::into).collect(),
        })
    }

    /// Deletes everything past the retention window. There is no
    /// rollup-of-rollups anywhere in this service: a bucket is already one
    /// minute wide, so the only thing old data becomes is deleted.
    pub async fn prune(&self, now: OffsetDateTime) -> Result<u64> {
        let cutoff = now - time::Duration::days(self.retention_days);
        self.repository.delete_before(cutoff).await
    }
}

/// One measure against its predecessor, or `None` when there is no honest
/// comparison to make.
///
/// The `None` is the whole point of this function. A window whose predecessor
/// holds nothing at all — the service was asleep, or the platform was deployed
/// this morning — has no baseline, and "+100%" rendered against nothing is a
/// trend that never happened. Returning `Option` makes the screen say "no
/// comparable data" instead of inventing one.
fn comparison(
    previous_start: OffsetDateTime,
    current: &HttpTotals,
    previous: &HttpTotals,
) -> Option<TelemetryComparison> {
    if previous.requests == 0 {
        return None;
    }
    Some(TelemetryComparison {
        previous_window_start: previous_start,
        requests: delta(current.requests, previous.requests),
        // The error COUNT, not the rate. Two rates subtract into a
        // percentage-POINT difference, and reporting that as a percent change
        // is the most common way a card like this ends up lying: 1% to 2% is
        // "+1 point", and calling it "+100%" is true of the ratio and useless
        // as a signal.
        errors: delta(current.server_errors, previous.server_errors),
        p95_duration_ms: delta(current.latency.p95_ms(), previous.latency.p95_ms()),
    })
}

fn delta(current: i64, previous: i64) -> TelemetryDelta {
    TelemetryDelta {
        current,
        previous,
        // A previous value of zero has no percentage — the change is infinite,
        // and 0.0 with `has_baseline: true` is the honest encoding of "it went
        // from nothing to something", which the admin app renders as "new"
        // rather than as a number.
        change_percent: if previous == 0 {
            0.0
        } else {
            let ratio = (current - previous) as f64 * 100.0 / previous as f64;
            (ratio * 100.0).round() / 100.0
        },
        has_baseline: previous != 0,
    }
}

/// The request funnel: everything that arrived, the part of it that was a
/// valid request, and the part of THAT this platform actually answered.
///
/// Each stage strictly contains the next, which is the only thing that makes
/// four bars in a row a funnel. An earlier version used backend round trips
/// for the middle stages and produced 302 -> 19 -> 19 -> 302 against a real
/// window: most traffic is health checks and 404s that never reach a backend,
/// so the shape collapsed and then fully recovered. That was not a subtle
/// inaccuracy — it was a chart claiming containment that does not exist.
/// Backend fan-out is a ratio and is reported as one, beside the backends.
///
/// 4xx and 5xx are disjoint status classes, so subtracting them in turn is
/// well defined: `received - 4xx - 5xx` is exactly the 1xx/2xx/3xx responses.
fn traffic_funnel(
    totals: &HttpTotals,
    status_mix: &[StatusClassCount],
) -> Vec<TelemetryFunnelStage> {
    let client_errors: i64 = status_mix
        .iter()
        .filter(|slice| slice.status_class == CLIENT_ERROR_STATUS_CLASS)
        .map(|slice| slice.requests)
        .sum();
    let accepted = (totals.requests - client_errors).max(0);
    let served = (accepted - totals.server_errors).max(0);
    let stages = [
        (
            TELEMETRY_FUNNEL_STAGE_RECEIVED,
            "Requests received",
            totals.requests,
        ),
        (
            TELEMETRY_FUNNEL_STAGE_ACCEPTED,
            "The client asked for something real",
            accepted,
        ),
        (
            TELEMETRY_FUNNEL_STAGE_SERVED,
            "Answered without a server error",
            served,
        ),
    ];
    stages
        .into_iter()
        .map(|(stage, label, count)| TelemetryFunnelStage {
            stage: stage.to_owned(),
            label: label.to_owned(),
            count,
            percent_of_entry: percentage_of(count, totals.requests),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::memory::InMemoryRollupRepository;
    use crate::testing::{backend_bucket, rollup_envelope, rollup_envelope_with, TestBucket};
    use myunivokai_contracts::TELEMETRY_SINK_POSTGRES;
    use time::macros::datetime;

    fn descriptor() -> TelemetrySinkDescriptor {
        TelemetrySinkDescriptor {
            sink: TELEMETRY_SINK_POSTGRES.to_owned(),
            charts_available: true,
            dashboard_url: String::new(),
        }
    }

    fn service_with(repository: Arc<InMemoryRollupRepository>) -> TelemetryService {
        TelemetryService::new(repository, 90)
    }

    #[tokio::test]
    async fn a_redelivered_envelope_moves_no_counter() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository.clone());
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[TestBucket::successful("/api/universe/worlds", 10, 500, 90)],
        );

        assert_eq!(
            service.ingest(&envelope).await.expect("first delivery"),
            IngestOutcome::Stored
        );
        assert_eq!(
            service.ingest(&envelope).await.expect("redelivery"),
            IngestOutcome::AlreadyStored
        );

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(
            overview.total_requests, 10,
            "the redelivery double-counted the interval"
        );
    }

    // Two gateway instances flushing the same minute are two facts, not a
    // duplicate. This is the case the message id exists to keep apart.
    #[tokio::test]
    async fn two_instances_reporting_one_minute_are_added_together() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let bucket_start = datetime!(2026-08-13 09:14:00 UTC);
        for instance in ["instance-a", "instance-b"] {
            let envelope = rollup_envelope(
                instance,
                bucket_start,
                &[TestBucket::successful("/api/universe/worlds", 4, 200, 80)],
            );
            assert_eq!(
                service.ingest(&envelope).await.expect("ingest"),
                IngestOutcome::Stored
            );
        }

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(overview.total_requests, 8);
        assert_eq!(
            overview.volume_points.len(),
            1,
            "one minute, one chart point"
        );
    }

    // 4xx is the client's problem. Folding it in would produce an error rate
    // that never goes down.
    #[tokio::test]
    async fn the_error_rate_counts_server_errors_only() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[
                TestBucket::successful("/api/universe/worlds", 90, 900, 40),
                TestBucket::with_status("/api/universe/worlds", 4, 8, 80, 40),
                TestBucket::with_status("/api/universe/worlds", 5, 2, 20, 40)
                    .with_error_code("SERVICE_WAKING", 2),
            ],
        );
        service.ingest(&envelope).await.expect("ingest");

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");

        assert_eq!(overview.total_requests, 100);
        assert_eq!(overview.error_requests, 2);
        assert_eq!(overview.error_rate_percent, 2.0);
        assert_eq!(
            overview.status_mix.len(),
            3,
            "every class is still reported"
        );
        assert_eq!(overview.error_code_top[0].error_code, "SERVICE_WAKING");
        assert_eq!(overview.wake_signals.len(), 1);
    }

    #[tokio::test]
    async fn a_window_excludes_anything_older_than_itself() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(2),
                &[TestBucket::successful("/api/universe/worlds", 5, 50, 20)],
            ))
            .await
            .expect("recent");
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(48),
                &[TestBucket::successful("/api/universe/worlds", 7, 70, 20)],
            ))
            .await
            .expect("old");

        let recent = service
            .overview(&TelemetryOverviewQueryData { hours: 6 }, descriptor(), now)
            .await
            .expect("overview");
        assert_eq!(recent.total_requests, 5);
        assert_eq!(recent.hours, 6);

        let wider = service
            .overview(&TelemetryOverviewQueryData { hours: 72 }, descriptor(), now)
            .await
            .expect("overview");
        assert_eq!(wider.total_requests, 12);
    }

    // A window the service silently shrank would make the screen lie about
    // what it is showing, so the clamped value is returned rather than the one
    // that was asked for.
    #[tokio::test]
    async fn an_unbounded_window_is_clamped_and_says_so() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 100_000 },
                descriptor(),
                datetime!(2026-08-13 12:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(overview.hours, 168);
    }

    #[tokio::test]
    async fn routes_are_returned_busiest_first_with_their_own_error_rate() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[
                TestBucket::successful("/api/universe/worlds/{worldID}", 40, 400, 30),
                TestBucket::successful("/api/universe/worlds", 8, 800, 300),
                TestBucket::with_status("/api/universe/worlds", 5, 2, 60, 40),
            ],
        );
        service.ingest(&envelope).await.expect("ingest");

        let listed = service
            .routes(
                &TelemetryRouteListQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("routes");

        assert_eq!(listed.routes.len(), 2);
        assert_eq!(
            listed.routes[0].route_pattern,
            "/api/universe/worlds/{worldID}"
        );
        assert_eq!(listed.routes[0].request_count, 40);
        assert_eq!(listed.routes[0].error_rate_percent, 0.0);
        assert_eq!(listed.routes[1].request_count, 10);
        assert_eq!(listed.routes[1].error_count, 2);
        assert_eq!(listed.routes[1].error_rate_percent, 20.0);
        assert!(listed.percentile_is_interpolated);
    }

    #[tokio::test]
    async fn retention_deletes_only_what_is_past_the_window() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = TelemetryService::new(repository, 1);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(2),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect("recent");
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::days(3),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect("old");

        let deleted = service.prune(now).await.expect("prune");
        assert_eq!(deleted, 1);

        let remaining = service
            .overview(
                &TelemetryOverviewQueryData { hours: 168 },
                descriptor(),
                now,
            )
            .await
            .expect("overview");
        assert_eq!(remaining.total_requests, 1);
    }

    // "+100% vs yesterday" against a window that holds nothing is a trend that
    // never happened. Absent is the only honest answer, and it is the one the
    // screen renders as "no comparable data".
    #[tokio::test]
    async fn a_window_with_no_predecessor_reports_no_comparison_rather_than_a_fabricated_one() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        service
            .ingest(&rollup_envelope(
                "instance-a",
                now - time::Duration::hours(1),
                &[TestBucket::successful("/api/universe/worlds", 10, 500, 90)],
            ))
            .await
            .expect("ingest");

        let overview = service
            .overview(&TelemetryOverviewQueryData { hours: 6 }, descriptor(), now)
            .await
            .expect("overview");
        assert!(
            overview.comparison.is_none(),
            "a comparison was invented against an empty previous window"
        );
    }

    #[tokio::test]
    async fn the_comparison_measures_the_window_immediately_before_this_one() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let now = datetime!(2026-08-13 12:00:00 UTC);
        // This window [06:00, 12:00): 30 requests, 3 of them 5xx.
        service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-13 09:00:00 UTC),
                &[
                    TestBucket::successful("/api/universe/worlds", 27, 1350, 60),
                    TestBucket::with_status("/api/universe/worlds", 5, 3, 150, 60),
                ],
            ))
            .await
            .expect("current");
        // The previous window [00:00, 06:00): 20 requests, none failing.
        service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-13 03:00:00 UTC),
                &[TestBucket::successful("/api/universe/worlds", 20, 1000, 60)],
            ))
            .await
            .expect("previous");
        // Older still — outside both windows, and must reach neither side.
        service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-12 20:00:00 UTC),
                &[TestBucket::successful(
                    "/api/universe/worlds",
                    999,
                    9990,
                    60,
                )],
            ))
            .await
            .expect("ancient");

        let overview = service
            .overview(&TelemetryOverviewQueryData { hours: 6 }, descriptor(), now)
            .await
            .expect("overview");
        let comparison = overview.comparison.expect("a comparison");

        assert_eq!(
            comparison.previous_window_start,
            datetime!(2026-08-13 00:00:00 UTC)
        );
        assert_eq!(comparison.requests.current, 30);
        assert_eq!(
            comparison.requests.previous, 20,
            "the previous window picked up traffic from outside itself"
        );
        assert_eq!(comparison.requests.change_percent, 50.0);
        assert!(comparison.requests.has_baseline);

        // Errors compare as counts. Reporting the RATE's change here would say
        // "+infinity" for 0% becoming 10%, which is true of the ratio and
        // useless as a signal.
        assert_eq!(comparison.errors.current, 3);
        assert_eq!(comparison.errors.previous, 0);
        assert!(
            !comparison.errors.has_baseline,
            "a previous value of zero has no percentage to report"
        );
    }

    #[tokio::test]
    async fn the_peak_hour_is_the_busiest_hour_and_is_absent_when_nothing_was_served() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository.clone());
        let now = datetime!(2026-08-13 12:00:00 UTC);

        let empty = service
            .overview(&TelemetryOverviewQueryData { hours: 24 }, descriptor(), now)
            .await
            .expect("overview");
        assert!(empty.peak_hour.is_none());
        assert!(empty.hour_of_day.is_empty());

        // Two minutes inside 09:00 outweigh one busier single minute at 10:00,
        // which is exactly what an hourly rollup is for.
        for (minute, count) in [(10, 20), (40, 25)] {
            service
                .ingest(&rollup_envelope(
                    "instance-a",
                    datetime!(2026-08-13 09:00:00 UTC) + time::Duration::minutes(minute),
                    &[TestBucket::successful(
                        "/api/universe/worlds",
                        count,
                        100,
                        30,
                    )],
                ))
                .await
                .expect("ingest");
        }
        service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-13 10:30:00 UTC),
                &[TestBucket::successful("/api/universe/worlds", 30, 100, 30)],
            ))
            .await
            .expect("ingest");

        let overview = service
            .overview(&TelemetryOverviewQueryData { hours: 24 }, descriptor(), now)
            .await
            .expect("overview");
        let peak = overview.peak_hour.expect("a peak hour");
        assert_eq!(peak.bucket_start, datetime!(2026-08-13 09:00:00 UTC));
        assert_eq!(peak.request_count, 45);

        assert_eq!(overview.hourly_points.len(), 2, "three minutes, two hours");
        assert_eq!(
            overview
                .hour_of_day
                .iter()
                .map(|hour| hour.hour)
                .collect::<Vec<_>>(),
            vec![9, 10]
        );
    }

    // Every stage must contain the next. An earlier funnel put backend round
    // trips in the middle and produced 302 -> 19 -> 19 -> 302 against real
    // traffic, because health checks and 404s never reach a backend: the shape
    // collapsed and then fully recovered, claiming a containment that does not
    // exist. This test is that bug.
    #[tokio::test]
    async fn every_funnel_stage_contains_the_next() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope_with(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[
                TestBucket::successful("/api/universe/worlds", 60, 900, 60),
                // 4xx: a 404 sweep, which never reaches a backend and is not
                // this platform's failure.
                TestBucket::with_status("/api/universe/worlds", 4, 30, 300, 60),
                TestBucket::with_status("/api/universe/worlds", 5, 10, 100, 60),
            ],
            // Only a handful of requests touched a backend. This is the shape
            // that broke the old funnel.
            &[backend_bucket("universe", 12, 400, 60, 1)],
            &[],
        );
        service.ingest(&envelope).await.expect("ingest");

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");

        let counts: Vec<i64> = overview
            .traffic_funnel
            .iter()
            .map(|stage| stage.count)
            .collect();
        assert_eq!(counts, vec![100, 70, 60], "received - 4xx - 5xx");
        for pair in counts.windows(2) {
            assert!(
                pair[0] >= pair[1],
                "a funnel stage grew: {} then {}",
                pair[0],
                pair[1]
            );
        }
        assert_eq!(overview.traffic_funnel[0].percent_of_entry, 100.0);
        assert_eq!(overview.traffic_funnel[2].percent_of_entry, 60.0);
        assert!(
            overview
                .traffic_funnel
                .iter()
                .all(|stage| stage.percent_of_entry <= 100.0),
            "no stage may exceed the entry it is a subset of"
        );
    }

    // A window with no traffic must not divide by its own entry count.
    #[tokio::test]
    async fn an_empty_funnel_reports_zeroes_rather_than_dividing_by_nothing() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert_eq!(overview.traffic_funnel.len(), 3);
        for stage in &overview.traffic_funnel {
            assert_eq!(stage.count, 0);
            assert_eq!(stage.percent_of_entry, 0.0);
        }
    }

    #[tokio::test]
    async fn the_median_and_the_tail_are_reported_together() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        let service = service_with(repository);
        let envelope = rollup_envelope(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            // 90 fast requests and 10 slow ones: the median sits in the fast
            // bucket, the p95 in the slow one.
            &[TestBucket::with_histogram(
                "/api/universe/worlds",
                2,
                100,
                4_000,
                900,
                [0, 90, 0, 0, 0, 0, 10, 0],
            )],
        );
        service.ingest(&envelope).await.expect("ingest");

        let overview = service
            .overview(
                &TelemetryOverviewQueryData { hours: 24 },
                descriptor(),
                datetime!(2026-08-13 10:00:00 UTC),
            )
            .await
            .expect("overview");
        assert!(
            overview.p50_duration_ms < overview.p95_duration_ms,
            "p50 {} is not below p95 {}",
            overview.p50_duration_ms,
            overview.p95_duration_ms
        );
        assert!(overview.p95_duration_ms <= overview.slowest_duration_ms);
    }

    #[tokio::test]
    async fn a_storage_failure_reaches_the_caller_as_a_retryable_error() {
        let repository = Arc::new(InMemoryRollupRepository::new());
        repository.fail_next_call("database unreachable");
        let service = service_with(repository);

        let error = service
            .ingest(&rollup_envelope(
                "instance-a",
                datetime!(2026-08-13 09:14:00 UTC),
                &[TestBucket::successful("/api/universe/worlds", 1, 10, 10)],
            ))
            .await
            .expect_err("must fail");

        assert!(
            error.is_retryable(),
            "a database blip must be naked, not acked"
        );
        assert_eq!(error.describe().status_code, 500);
    }
}
