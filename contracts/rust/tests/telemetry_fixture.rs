//! The drift guard.
//!
//! This test decodes the exact file
//! `contracts/go/contracts_telemetry_rollup_test.go` decodes. Two languages,
//! one fixture, one CI failure if they disagree — which is the whole
//! mitigation for keeping a hand-maintained Rust mirror of `contracts/go`.
//! Adding a field on one side and forgetting the other fails here, not in a
//! deployed service.
//!
//! `include_str!` rather than a runtime read: the path is resolved relative to
//! this source file at compile time, so the test cannot pass by silently
//! finding nothing when the fixture moves.

use myunivokai_contracts::{
    telemetry_rollup_message_id, Envelope, HttpRollupData, TELEMETRY_HISTOGRAM_BUCKET_COUNT,
};
use time::macros::datetime;

const TELEMETRY_ROLLUP_FIXTURE: &str =
    include_str!("../../fixtures/telemetry-http-rollup-event.v1.json");

fn decode_fixture() -> Envelope<HttpRollupData> {
    serde_json::from_str(TELEMETRY_ROLLUP_FIXTURE).expect("the shared rollup fixture must decode")
}

#[test]
fn the_shared_fixture_decodes_into_the_rust_contract() {
    let envelope = decode_fixture();
    envelope.validate().expect("envelope is valid");
    envelope.data.validate().expect("rollup data is valid");

    let expected_bucket_start = datetime!(2026-08-13 09:14:00 UTC);
    assert_eq!(envelope.data.bucket_start, expected_bucket_start);
    assert_eq!(envelope.data.bucket_duration_ms, 60_000);
    assert_eq!(
        envelope.job_id,
        telemetry_rollup_message_id(&envelope.data.instance_id, expected_bucket_start),
        "the envelope's jobId must be the {{instance, bucket start}} message id"
    );

    assert_eq!(envelope.data.buckets.len(), 4);
    assert_eq!(envelope.data.nats_backend_buckets.len(), 3);
    assert_eq!(envelope.data.cache_buckets.len(), 3);
}

#[test]
fn the_fixture_keys_on_route_templates_rather_than_paths() {
    let envelope = decode_fixture();
    let world_get = &envelope.data.buckets[1];
    assert_eq!(world_get.route_pattern, "/api/universe/worlds/{worldID}");
    assert_eq!(world_get.request_count, 34);
    assert_eq!(world_get.duration_max_ms, 128);

    // No bucket key anywhere may carry an identifier. A digit run long enough
    // to be a ULID in a route pattern means somebody switched to
    // request.URL.Path, which is the single failure that ends this pipeline.
    for bucket in &envelope.data.buckets {
        assert!(
            !bucket
                .route_pattern
                .split('/')
                .any(|segment| segment.len() > 20 && !segment.starts_with('{')),
            "route pattern looks like a raw path: {}",
            bucket.route_pattern
        );
    }
}

#[test]
fn the_fixture_carries_all_three_concerns_in_one_envelope() {
    let envelope = decode_fixture();
    assert_eq!(envelope.data.buckets[2].error_codes["SERVICE_WAKING"], 3);
    assert_eq!(envelope.data.nats_backend_buckets[0].service, "universe");
    assert_eq!(envelope.data.nats_backend_buckets[0].error_count, 3);
    assert_eq!(envelope.data.cache_buckets[0].namespace, "job:v1");
    assert_eq!(envelope.data.cache_buckets[0].hits, 21);
}

#[test]
fn every_fixture_histogram_sums_to_its_request_count() {
    let envelope = decode_fixture();
    for (index, bucket) in envelope.data.buckets.iter().enumerate() {
        assert_eq!(
            bucket.histogram.len(),
            TELEMETRY_HISTOGRAM_BUCKET_COUNT,
            "buckets.{index} histogram width changed"
        );
        assert_eq!(
            bucket.histogram.iter().sum::<i64>(),
            bucket.request_count,
            "buckets.{index} histogram does not sum to its request count"
        );
    }
    for (index, bucket) in envelope.data.nats_backend_buckets.iter().enumerate() {
        assert_eq!(
            bucket.histogram.iter().sum::<i64>(),
            bucket.request_count,
            "natsBackendBuckets.{index} histogram does not sum to its request count"
        );
    }
}

#[test]
fn re_encoding_the_fixture_produces_the_same_document() {
    // Round-tripping catches the drift a decode test cannot: a field this
    // struct renames, defaults or drops decodes cleanly and then disappears on
    // the way back out.
    let envelope = decode_fixture();
    let re_encoded: serde_json::Value =
        serde_json::to_value(&envelope).expect("re-encode the rollup envelope");
    let original: serde_json::Value =
        serde_json::from_str(TELEMETRY_ROLLUP_FIXTURE).expect("decode the fixture as raw JSON");
    assert_eq!(
        re_encoded, original,
        "the Rust structs did not reproduce the fixture byte-for-byte in value terms"
    );
}

/// The read-side twin, decoded by `TestTelemetryOverviewFixtureDecodesIntoTheContract`
/// in `contracts/go/contracts_telemetry_rollup_test.go`.
///
/// It matters more than the event fixture, not less. The gateway relays
/// telemetry responses as opaque bytes, so nothing in Go decodes one in
/// production — the two response mirrors could drift for months with every
/// other test still green. This file is the only thing that notices.
const TELEMETRY_OVERVIEW_FIXTURE: &str =
    include_str!("../../fixtures/responses/telemetry-overview-response.v1.json");

#[test]
fn the_overview_response_fixture_decodes_into_the_mirror() {
    let overview: myunivokai_contracts::TelemetryOverviewResponseData =
        serde_json::from_str(TELEMETRY_OVERVIEW_FIXTURE).expect("decode the overview fixture");

    assert_eq!(
        overview.sink.sink,
        myunivokai_contracts::TELEMETRY_SINK_POSTGRES
    );
    assert!(overview.sink.charts_available);
    assert_eq!(overview.p50_duration_ms, 37);
    assert_eq!(overview.p95_duration_ms, 910);
    assert!(
        overview.p50_duration_ms < overview.p95_duration_ms,
        "a p50 at or above the p95 means the two percentiles are swapped somewhere"
    );

    let comparison = overview
        .comparison
        .as_ref()
        .expect("the vs-previous-window block");
    assert_eq!(comparison.requests.current, 49);
    assert_eq!(comparison.requests.previous, 20);
    assert!(comparison.requests.has_baseline);
    assert_eq!(
        comparison.previous_window_start,
        datetime!(2026-08-11 10:00:00 UTC)
    );

    let peak = overview.peak_hour.as_ref().expect("the peak hour");
    assert_eq!(peak.request_count, 49);
    assert_eq!(overview.hour_of_day.len(), 1);
    assert_eq!(overview.hour_of_day[0].hour, 9);
    assert_eq!(overview.hourly_points.len(), 1);

    // The keys the admin app orders and colours by. A label may be reworded; a
    // key may not.
    let expected_stages = [
        myunivokai_contracts::TELEMETRY_FUNNEL_STAGE_RECEIVED,
        myunivokai_contracts::TELEMETRY_FUNNEL_STAGE_ACCEPTED,
        myunivokai_contracts::TELEMETRY_FUNNEL_STAGE_SERVED,
    ];
    assert_eq!(overview.traffic_funnel.len(), expected_stages.len());
    for (stage, expected) in overview.traffic_funnel.iter().zip(expected_stages) {
        assert_eq!(stage.stage, expected);
        assert!(
            !stage.label.is_empty(),
            "stage {expected} carries no label for a chart to print"
        );
    }
    assert_eq!(overview.traffic_funnel[0].percent_of_entry, 100.0);
    // Each stage must contain the next. Without this the shape is four
    // counters in a row claiming a containment that does not exist.
    for pair in overview.traffic_funnel.windows(2) {
        assert!(
            pair[0].count >= pair[1].count,
            "stage {} ({}) exceeds the stage it is a subset of ({})",
            pair[1].stage,
            pair[1].count,
            pair[0].count
        );
    }

    assert_eq!(overview.backends.len(), 1);
    assert_eq!(overview.backends[0].p50_duration_ms, 62);

    // Re-encoding must reproduce the same document. This is what catches a
    // field renamed on this side only: decode would tolerate it via serde's
    // default, and the round trip would not.
    let reencoded: serde_json::Value =
        serde_json::to_value(&overview).expect("re-encode the overview");
    let original: serde_json::Value =
        serde_json::from_str(TELEMETRY_OVERVIEW_FIXTURE).expect("re-read the fixture");
    assert_eq!(
        reencoded, original,
        "the mirror does not re-encode to the fixture it decoded"
    );
}
