//! The destination port: one small trait, adapters in their own module,
//! selected by one environment variable read once at startup.
//!
//! This is `ai.Provider`'s shape applied to a different axis, not a new one —
//! and it sits *above* the service layer rather than beside it, because
//! "where do the rollups land" is a different question from "what does a p95
//! mean". `sink::postgres` is a thin adapter over
//! [`crate::service::TelemetryService`]; `sink::otlp` has no repository at all,
//! which is exactly why the two cannot share a service.

pub mod otlp;
pub mod postgres;

use async_trait::async_trait;
use myunivokai_contracts::{
    normalize_telemetry_hours, HttpRollupEnvelope, TelemetryOverviewQueryData,
    TelemetryOverviewResponseData, TelemetryRouteListQueryData, TelemetryRouteListResponseData,
    TelemetrySinkDescriptor,
};
use time::OffsetDateTime;

use crate::domain::IngestOutcome;
use crate::error::Result;

#[async_trait]
pub trait TelemetrySink: Send + Sync {
    /// Names this sink and states whether it can be charted from, on every
    /// response rather than only on the ones that fail.
    fn descriptor(&self) -> TelemetrySinkDescriptor;

    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> Result<IngestOutcome>;

    async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
        now: OffsetDateTime,
    ) -> Result<TelemetryOverviewResponseData>;

    async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
        now: OffsetDateTime,
    ) -> Result<TelemetryRouteListResponseData>;

    /// A sink with no storage of its own answers zero rather than refusing:
    /// there is nothing to delete, which is a successful outcome.
    async fn prune(&self, _now: OffsetDateTime) -> Result<u64> {
        Ok(0)
    }

    /// Flushes anything held in memory and releases the connection. Only one
    /// sink has work to do here, which is why it is a defaulted method rather
    /// than a required one that half the implementations would leave empty.
    async fn shutdown(&self) {}
}

/// The empty answer a sink that stores nothing produces, built from its own
/// descriptor so the screen still has a sink name and a dashboard link to
/// render. Without them an empty response reads as "no traffic" rather than
/// "the data is somewhere else" — opposite conclusions.
pub fn charts_are_elsewhere_overview(
    descriptor: TelemetrySinkDescriptor,
    query: &TelemetryOverviewQueryData,
    now: OffsetDateTime,
) -> TelemetryOverviewResponseData {
    TelemetryOverviewResponseData {
        sink: descriptor,
        hours: normalize_telemetry_hours(query.hours),
        generated_at: now,
        total_requests: 0,
        error_requests: 0,
        error_rate_percent: 0.0,
        average_duration_ms: 0,
        p50_duration_ms: 0,
        p95_duration_ms: 0,
        slowest_duration_ms: 0,
        // A percentile that was never computed must not be labelled as an
        // interpolation of one.
        percentile_is_interpolated: false,
        status_mix: Vec::new(),
        volume_points: Vec::new(),
        hourly_points: Vec::new(),
        // Absent, not a zeroed bucket. "The busiest hour saw no requests" is a
        // claim about traffic; this sink is making no claim about traffic at
        // all.
        peak_hour: None,
        hour_of_day: Vec::new(),
        comparison: None,
        // Empty rather than four zeroed stages: a funnel drawn from a sink that
        // measured nothing would render as total collapse at every step.
        traffic_funnel: Vec::new(),
        error_code_top: Vec::new(),
        backends: Vec::new(),
        cache: Vec::new(),
        wake_signals: Vec::new(),
        oldest_bucket_start: None,
    }
}

pub fn charts_are_elsewhere_routes(
    descriptor: TelemetrySinkDescriptor,
    query: &TelemetryRouteListQueryData,
    now: OffsetDateTime,
) -> TelemetryRouteListResponseData {
    TelemetryRouteListResponseData {
        sink: descriptor,
        hours: normalize_telemetry_hours(query.hours),
        generated_at: now,
        percentile_is_interpolated: false,
        routes: Vec::new(),
    }
}
