//! End-to-end over the layers that hold the logic: an envelope goes in
//! through the same path the consumer uses, and the responses the admin app
//! renders come back out.
//!
//! This is an integration test in Cargo's sense — a separate crate that can
//! only see `telemetry_service`'s public API — which is exactly what makes it
//! worth having: if a layer stops being reachable from outside, this file
//! stops compiling. The storage is [`InMemoryRollupRepository`], so it runs in
//! milliseconds with no container; what it does NOT prove is that the SQL is
//! correct, and `src/repository/postgres/statements.rs` says so in its own
//! tests.

use std::sync::Arc;

use myunivokai_contracts::{TelemetryOverviewQueryData, TelemetryRouteListQueryData};
use telemetry_service::domain::IngestOutcome;
use telemetry_service::repository::memory::InMemoryRollupRepository;
use telemetry_service::service::TelemetryService;
use telemetry_service::sink::{charts_are_elsewhere_overview, charts_are_elsewhere_routes};
use telemetry_service::testing::{backend_bucket, cache_bucket, rollup_envelope_with, TestBucket};
use time::macros::datetime;
use time::OffsetDateTime;

const RETENTION_DAYS: i64 = 90;

fn postgres_descriptor() -> myunivokai_contracts::TelemetrySinkDescriptor {
    myunivokai_contracts::TelemetrySinkDescriptor {
        sink: myunivokai_contracts::TELEMETRY_SINK_POSTGRES.to_owned(),
        charts_available: true,
        dashboard_url: String::new(),
    }
}

fn otlp_descriptor() -> myunivokai_contracts::TelemetrySinkDescriptor {
    myunivokai_contracts::TelemetrySinkDescriptor {
        sink: myunivokai_contracts::TELEMETRY_SINK_OTLP.to_owned(),
        charts_available: false,
        dashboard_url: "https://grafana.example.net/d/myunivokai".to_owned(),
    }
}

fn now() -> OffsetDateTime {
    datetime!(2026-08-13 10:00:00 UTC)
}

fn service() -> TelemetryService {
    TelemetryService::new(Arc::new(InMemoryRollupRepository::new()), RETENTION_DAYS)
}

/// One realistic minute: three route buckets, two backends and all three cache
/// namespaces, exactly as a gateway flush carries them.
async fn ingest_one_realistic_minute(service: &TelemetryService, instance: &str) {
    let envelope = rollup_envelope_with(
        instance,
        datetime!(2026-08-13 09:14:00 UTC),
        &[
            TestBucket::successful("/api/universe/worlds/{worldID}", 34, 1190, 128),
            TestBucket::successful("/api/universe/worlds", 12, 4820, 910).with_method("POST"),
            TestBucket::with_status("/api/universe/worlds/{worldID}", 5, 3, 96, 41)
                .with_error_code("SERVICE_WAKING", 3),
        ],
        &[
            backend_bucket("universe", 49, 5210, 880, 3),
            backend_bucket("dna", 12, 3600, 940, 0),
        ],
        &[
            cache_bucket("job:v1", 21, 6),
            cache_bucket("world:v1", 30, 4),
            cache_bucket("share:v1", 0, 2),
        ],
    );
    assert_eq!(
        service.ingest(&envelope).await.expect("ingest"),
        IngestOutcome::Stored
    );
}

#[tokio::test]
async fn one_flush_answers_every_question_the_telemetry_screen_asks() {
    let service = service();
    ingest_one_realistic_minute(&service, "instance-a").await;

    let overview = service
        .overview(
            &TelemetryOverviewQueryData { hours: 24 },
            postgres_descriptor(),
            now(),
        )
        .await
        .expect("overview");

    assert_eq!(overview.total_requests, 49);
    assert_eq!(overview.error_requests, 3);
    assert_eq!(overview.error_rate_percent, 6.12);
    assert!(
        overview.percentile_is_interpolated,
        "the screen is required to state that the p95 is an interpolation"
    );
    assert_eq!(overview.slowest_duration_ms, 910);

    // Every status class present is reported, even though only 5xx counts
    // toward the rate above.
    assert_eq!(overview.status_mix.len(), 2);

    // The three concerns that ride in one envelope all landed.
    assert_eq!(overview.backends.len(), 2);
    let universe = overview
        .backends
        .iter()
        .find(|backend| backend.service == "universe")
        .expect("the universe backend");
    assert_eq!(universe.request_count, 49);
    assert_eq!(universe.error_count, 3);
    assert_eq!(universe.average_duration_ms, 106);

    assert_eq!(overview.cache.len(), 3);
    let job_cache = overview
        .cache
        .iter()
        .find(|namespace| namespace.namespace == "job:v1")
        .expect("the job cache namespace");
    assert_eq!(job_cache.hit_rate_percent, 77.78);
    let share_cache = overview
        .cache
        .iter()
        .find(|namespace| namespace.namespace == "share:v1")
        .expect("the share cache namespace");
    assert_eq!(
        share_cache.hit_rate_percent, 0.0,
        "a namespace that only ever missed must read as zero, not as absent"
    );

    // The wake-conversion signal, which is the question this whole table
    // exists to make answerable.
    assert_eq!(overview.wake_signals.len(), 1);
    assert_eq!(overview.wake_signals[0].request_count, 3);
    assert_eq!(overview.error_code_top[0].error_code, "SERVICE_WAKING");
    assert_eq!(overview.error_code_top[0].count, 3);

    assert_eq!(
        overview.oldest_bucket_start,
        Some(datetime!(2026-08-13 09:14:00 UTC)),
        "the screen must be able to say how far back the data actually goes"
    );
}

#[tokio::test]
async fn the_route_table_groups_by_template_and_method_not_by_status() {
    let service = service();
    ingest_one_realistic_minute(&service, "instance-a").await;

    let listed = service
        .routes(
            &TelemetryRouteListQueryData { hours: 24 },
            postgres_descriptor(),
            now(),
        )
        .await
        .expect("routes");

    assert_eq!(
        listed.routes.len(),
        2,
        "2xx and 5xx on one route are one row"
    );

    let world_get = &listed.routes[0];
    assert_eq!(world_get.route_pattern, "/api/universe/worlds/{worldID}");
    assert_eq!(world_get.method, "GET");
    assert_eq!(world_get.request_count, 37);
    assert_eq!(world_get.error_count, 3);
    assert_eq!(world_get.error_rate_percent, 8.11);

    let world_create = &listed.routes[1];
    assert_eq!(world_create.method, "POST");
    assert_eq!(world_create.request_count, 12);
    assert_eq!(world_create.error_rate_percent, 0.0);

    // No bucket key may carry an identifier. This is the rule the whole
    // pipeline lives or dies on.
    for route in &listed.routes {
        assert!(
            !route
                .route_pattern
                .split('/')
                .any(|segment| segment.len() > 20 && !segment.starts_with('{')),
            "a raw path reached the route table: {}",
            route.route_pattern
        );
    }
}

// JetStream redelivers on any ack it does not see, and every write in this
// service adds. Without the inbox, one redelivery doubles a minute with
// nothing afterwards able to tell.
#[tokio::test]
async fn redelivering_the_same_flush_five_times_changes_nothing() {
    let service = service();
    for attempt in 0..5 {
        let envelope = rollup_envelope_with(
            "instance-a",
            datetime!(2026-08-13 09:14:00 UTC),
            &[TestBucket::successful("/api/universe/worlds", 10, 500, 90)],
            &[],
            &[],
        );
        let outcome = service.ingest(&envelope).await.expect("ingest");
        if attempt == 0 {
            assert_eq!(outcome, IngestOutcome::Stored);
        } else {
            assert_eq!(outcome, IngestOutcome::AlreadyStored);
        }
    }

    let overview = service
        .overview(
            &TelemetryOverviewQueryData { hours: 24 },
            postgres_descriptor(),
            now(),
        )
        .await
        .expect("overview");
    assert_eq!(overview.total_requests, 10);
}

#[tokio::test]
async fn two_gateway_instances_flushing_one_minute_are_added_not_deduplicated() {
    let service = service();
    ingest_one_realistic_minute(&service, "instance-a").await;
    ingest_one_realistic_minute(&service, "instance-b").await;

    let overview = service
        .overview(
            &TelemetryOverviewQueryData { hours: 24 },
            postgres_descriptor(),
            now(),
        )
        .await
        .expect("overview");

    assert_eq!(overview.total_requests, 98);
    assert_eq!(
        overview.volume_points.len(),
        1,
        "two instances reporting one minute is one point on the chart"
    );
    assert_eq!(overview.volume_points[0].request_count, 98);
}

// With TELEMETRY_SINK=otlp every array is legitimately empty. An empty chart
// reads as "the platform served no traffic"; this response has to read as "the
// data is somewhere else", which is the opposite conclusion.
#[test]
fn a_sink_that_stores_nothing_still_names_itself_and_its_dashboard() {
    let overview = charts_are_elsewhere_overview(
        otlp_descriptor(),
        &TelemetryOverviewQueryData { hours: 0 },
        now(),
    );
    assert_eq!(overview.sink.sink, "otlp");
    assert!(!overview.sink.charts_available);
    assert_eq!(
        overview.sink.dashboard_url,
        "https://grafana.example.net/d/myunivokai"
    );
    assert_eq!(
        overview.hours, 24,
        "an absent window still becomes the default"
    );
    assert!(overview.volume_points.is_empty());
    assert!(
        !overview.percentile_is_interpolated,
        "a percentile that was never computed must not be labelled as an interpolation"
    );

    let routes = charts_are_elsewhere_routes(
        otlp_descriptor(),
        &TelemetryRouteListQueryData { hours: 12 },
        now(),
    );
    assert_eq!(routes.hours, 12);
    assert!(routes.routes.is_empty());
}
