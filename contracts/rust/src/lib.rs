//! The Rust half of this repository's message contracts.
//!
//! Every type here mirrors one in `contracts/go`, which remains the source of
//! truth for the Go services. This crate is a hand-maintained parallel copy —
//! the cost `notes/vision/rust-adoption-research.md` named plainly before any
//! Rust was written — and the mitigation is not documentation but a test:
//! `tests/telemetry_fixture.rs` decodes the exact same
//! `contracts/fixtures/*.json` file the Go suite validates in CI. If a fixture
//! changes and a struct here does not, that test fails, not a production
//! decode.
//!
//! Naming follows Rust conventions rather than transliterating Go's. Go's
//! `RPCError` is `RpcError` here and `HTTPRollupData` is `HttpRollupData`,
//! because `clippy` and every Rust reader expect an acronym to be cased that
//! way. The JSON on the wire is identical either way, which is the only thing
//! both languages have to agree on.

mod envelope;
mod telemetry;

pub use envelope::{
    error_rpc_envelope, success_rpc_envelope, Envelope, RpcError, RpcResponseData,
    ValidationDetail, COMMANDS_STREAM, EVENTS_STREAM, SCHEMA_VERSION_V1,
};
pub use telemetry::{
    normalize_telemetry_hours, percentile_from_histogram, status_class_of,
    telemetry_histogram_index_of, telemetry_rollup_message_id, CacheBucket, HttpRollupBucket,
    HttpRollupData, HttpRollupEnvelope, NatsBackendBucket, TelemetryBackendSummary,
    TelemetryCacheSummary, TelemetryComparison, TelemetryDelta, TelemetryErrorCodeCount,
    TelemetryFunnelStage, TelemetryHistogram, TelemetryHourBucket, TelemetryOverviewQueryData,
    TelemetryOverviewResponseData, TelemetryRouteListQueryData, TelemetryRouteListResponseData,
    TelemetryRouteSummary, TelemetrySinkDescriptor, TelemetryStatusClassCount,
    TelemetryVolumePoint, TELEMETRY_DEFAULT_HOURS, TELEMETRY_FUNNEL_STAGE_ACCEPTED,
    TELEMETRY_FUNNEL_STAGE_RECEIVED, TELEMETRY_FUNNEL_STAGE_SERVED,
    TELEMETRY_HISTOGRAM_BUCKET_COUNT, TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS,
    TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT, TELEMETRY_MAXIMUM_HOURS, TELEMETRY_MEDIAN_PERCENTILE,
    TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT, TELEMETRY_ROUTE_LIST_QUERY_SUBJECT, TELEMETRY_SINK_OTLP,
    TELEMETRY_SINK_POSTGRES, TELEMETRY_STATUS_CLASS_MAXIMUM, TELEMETRY_STATUS_CLASS_MINIMUM,
};
