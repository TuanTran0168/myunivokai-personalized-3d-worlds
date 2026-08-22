//! The sink that forwards rollups to Grafana Cloud instead of storing them.
//!
//! It has no repository and no service layer, and that asymmetry is the point:
//! there is nothing to query, nothing to retain and nothing to delete. What it
//! gives up is the query surface — once data is pushed to Grafana, Grafana
//! owns it — so [`OtlpSink::overview`] and [`OtlpSink::routes`] answer
//! [`Error::Unsupported`], which the query responder turns into a "the charts
//! are over there" response rather than an error.
//!
//! # Why counters and not a histogram instrument
//!
//! The envelope arriving here is already aggregated: eight bucket counts, not
//! the observations that produced them. Replaying it through an OTLP histogram
//! instrument would mean inventing individual measurements to record — a
//! number that looks precise and describes nothing. Datadog documents the same
//! failure from the other direction: aggregating twice silently changes the
//! resulting percentile, which is why its client disables client-side
//! aggregation for histograms by default.
//!
//! So each bucket is exported as a counter carrying an `le` attribute, which
//! is exactly the wire shape a Prometheus histogram already has. Grafana's
//! `histogram_quantile` reads it natively, and no measurement is fabricated on
//! the way.

use std::time::Duration as StdDuration;

use async_trait::async_trait;
use myunivokai_contracts::{
    HttpRollupEnvelope, TelemetryOverviewQueryData, TelemetryOverviewResponseData,
    TelemetryRouteListQueryData, TelemetryRouteListResponseData, TelemetrySinkDescriptor,
    TELEMETRY_HISTOGRAM_BUCKET_COUNT, TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS, TELEMETRY_SINK_OTLP,
};
use opentelemetry::metrics::{Counter, MeterProvider};
use opentelemetry::KeyValue;
use opentelemetry_otlp::{MetricExporter, WithExportConfig};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::{runtime, Resource};
use time::OffsetDateTime;

use super::TelemetrySink;
use crate::config::Config;
use crate::domain::IngestOutcome;
use crate::error::{Error, Result};

const METER_NAME: &str = "myunivokai.telemetry";
const SERVICE_RESOURCE_NAME: &str = "myunivokai-telemetry";

/// How often the SDK pushes what it has accumulated. Shorter than the
/// gateway's own flush interval would export half-empty windows; much longer
/// would delay an alert past the point of being one.
const EXPORT_INTERVAL: StdDuration = StdDuration::from_secs(30);
const EXPORT_TIMEOUT: StdDuration = StdDuration::from_secs(10);

/// The label a Prometheus-shaped histogram bucket carries. The overflow bucket
/// is `+Inf`, exactly as Prometheus spells it, so `histogram_quantile` needs no
/// translation layer on the Grafana side.
const OVERFLOW_BUCKET_LABEL: &str = "+Inf";

const UNSUPPORTED_REASON: &str = "the OTLP sink pushes to Grafana, which owns the query surface";

pub struct OtlpSink {
    provider: SdkMeterProvider,
    dashboard_url: String,

    http_requests: Counter<u64>,
    http_duration_sum_ms: Counter<u64>,
    http_duration_bucket: Counter<u64>,
    http_error_codes: Counter<u64>,

    backend_requests: Counter<u64>,
    backend_duration_sum_ms: Counter<u64>,
    backend_duration_bucket: Counter<u64>,
    backend_errors: Counter<u64>,

    cache_lookups: Counter<u64>,
}

impl OtlpSink {
    /// Authentication is supplied through the standard
    /// `OTEL_EXPORTER_OTLP_HEADERS` environment variable rather than a setting
    /// of our own. Grafana Cloud's instructions are already written in those
    /// terms, and re-spelling them as `TELEMETRY_*` would mean an operator
    /// translating a copy-pasteable snippet by hand.
    pub fn connect(config: &Config) -> anyhow::Result<Self> {
        let exporter = MetricExporter::builder()
            .with_tonic()
            .with_endpoint(config.otlp_endpoint.clone())
            .with_timeout(EXPORT_TIMEOUT)
            .build()?;
        let reader = PeriodicReader::builder(exporter, runtime::Tokio)
            .with_interval(EXPORT_INTERVAL)
            .build();
        let provider = SdkMeterProvider::builder()
            .with_reader(reader)
            .with_resource(Resource::new(vec![KeyValue::new(
                "service.name",
                SERVICE_RESOURCE_NAME,
            )]))
            .build();
        let meter = provider.meter(METER_NAME);

        Ok(Self {
            http_requests: meter
                .u64_counter("myunivokai.http.server.requests")
                .with_description("Requests the gateway served, by route template and status class")
                .build(),
            http_duration_sum_ms: meter
                .u64_counter("myunivokai.http.server.duration.sum")
                .with_unit("ms")
                .with_description("Total time spent serving requests, by route template")
                .build(),
            http_duration_bucket: meter
                .u64_counter("myunivokai.http.server.duration.bucket")
                .with_description(
                    "Cumulative latency buckets, carrying a Prometheus-style le label",
                )
                .build(),
            http_error_codes: meter
                .u64_counter("myunivokai.http.server.errors")
                .with_description("Gateway error codes, by route template")
                .build(),
            backend_requests: meter
                .u64_counter("myunivokai.nats.client.requests")
                .with_description("Request/reply round trips the gateway made, by backend service")
                .build(),
            backend_duration_sum_ms: meter
                .u64_counter("myunivokai.nats.client.duration.sum")
                .with_unit("ms")
                .with_description("Total round-trip time, by backend service")
                .build(),
            backend_duration_bucket: meter
                .u64_counter("myunivokai.nats.client.duration.bucket")
                .with_description("Cumulative round-trip buckets, carrying an le label")
                .build(),
            backend_errors: meter
                .u64_counter("myunivokai.nats.client.errors")
                .with_description("Round trips that failed, including no-responders and timeouts")
                .build(),
            cache_lookups: meter
                .u64_counter("myunivokai.cache.lookups")
                .with_description("Redis cache reads, by namespace and outcome")
                .build(),
            provider,
            dashboard_url: config.dashboard_url.clone(),
        })
    }
}

/// `le` label values, computed from the contract's own edges so the two cannot
/// describe different buckets.
fn bucket_label(index: usize) -> String {
    match TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS.get(index) {
        Some(upper_bound) => upper_bound.to_string(),
        None => OVERFLOW_BUCKET_LABEL.to_owned(),
    }
}

/// Counters take `u64` and every value here is a count, but the contract's
/// integers are signed. A negative would mean a corrupt envelope, and clamping
/// keeps one bad message from wrapping a counter that can only go up.
fn as_counter_value(value: i64) -> u64 {
    value.max(0) as u64
}

#[async_trait]
impl TelemetrySink for OtlpSink {
    fn descriptor(&self) -> TelemetrySinkDescriptor {
        TelemetrySinkDescriptor {
            sink: TELEMETRY_SINK_OTLP.to_owned(),
            charts_available: false,
            dashboard_url: self.dashboard_url.clone(),
        }
    }

    /// There is no inbox here, and there cannot be one: this sink owns no
    /// storage to remember a message in. A redelivery therefore double-counts,
    /// which is why the outcome is always `Stored` rather than a claim this
    /// sink cannot support. JetStream's own deduplication window — keyed on
    /// the same `Nats-Msg-Id` the gateway sets — is the only guard on this
    /// path, and it is bounded by that window rather than by retention.
    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> Result<IngestOutcome> {
        let data = &envelope.data;
        let instance = KeyValue::new("service.instance.id", data.instance_id.clone());

        for bucket in &data.buckets {
            let dimensions = [
                instance.clone(),
                KeyValue::new("http.route", bucket.route_pattern.clone()),
                KeyValue::new("http.request.method", bucket.method.clone()),
                KeyValue::new("http.response.status_class", i64::from(bucket.status_class)),
            ];
            self.http_requests
                .add(as_counter_value(bucket.request_count), &dimensions);
            self.http_duration_sum_ms
                .add(as_counter_value(bucket.duration_sum_ms), &dimensions);
            for index in 0..TELEMETRY_HISTOGRAM_BUCKET_COUNT {
                let mut bucket_dimensions = dimensions.to_vec();
                bucket_dimensions.push(KeyValue::new("le", bucket_label(index)));
                self.http_duration_bucket.add(
                    as_counter_value(bucket.histogram[index]),
                    &bucket_dimensions,
                );
            }
            for (error_code, count) in &bucket.error_codes {
                let mut error_dimensions = dimensions.to_vec();
                error_dimensions.push(KeyValue::new("error.code", error_code.clone()));
                self.http_error_codes
                    .add(as_counter_value(*count), &error_dimensions);
            }
        }

        for bucket in &data.nats_backend_buckets {
            let dimensions = [
                instance.clone(),
                KeyValue::new("myunivokai.backend.service", bucket.service.clone()),
            ];
            self.backend_requests
                .add(as_counter_value(bucket.request_count), &dimensions);
            self.backend_duration_sum_ms
                .add(as_counter_value(bucket.duration_sum_ms), &dimensions);
            self.backend_errors
                .add(as_counter_value(bucket.error_count), &dimensions);
            for index in 0..TELEMETRY_HISTOGRAM_BUCKET_COUNT {
                let mut bucket_dimensions = dimensions.to_vec();
                bucket_dimensions.push(KeyValue::new("le", bucket_label(index)));
                self.backend_duration_bucket.add(
                    as_counter_value(bucket.histogram[index]),
                    &bucket_dimensions,
                );
            }
        }

        for bucket in &data.cache_buckets {
            let namespace = KeyValue::new("myunivokai.cache.namespace", bucket.namespace.clone());
            self.cache_lookups.add(
                as_counter_value(bucket.hits),
                &[
                    instance.clone(),
                    namespace.clone(),
                    KeyValue::new("cache.result", "hit"),
                ],
            );
            self.cache_lookups.add(
                as_counter_value(bucket.misses),
                &[
                    instance.clone(),
                    namespace,
                    KeyValue::new("cache.result", "miss"),
                ],
            );
        }

        Ok(IngestOutcome::Stored)
    }

    async fn overview(
        &self,
        _query: &TelemetryOverviewQueryData,
        _now: OffsetDateTime,
    ) -> Result<TelemetryOverviewResponseData> {
        Err(Error::Unsupported(UNSUPPORTED_REASON))
    }

    async fn routes(
        &self,
        _query: &TelemetryRouteListQueryData,
        _now: OffsetDateTime,
    ) -> Result<TelemetryRouteListResponseData> {
        Err(Error::Unsupported(UNSUPPORTED_REASON))
    }

    /// Pushes whatever has accumulated and stops the exporter, so the last
    /// envelope this process acknowledged is not lost between the ack and the
    /// process exiting.
    async fn shutdown(&self) {
        if let Err(error) = self.provider.force_flush() {
            tracing::warn!(%error, "flush pending OTLP metrics");
        }
        if let Err(error) = self.provider.shutdown() {
            tracing::warn!(%error, "shut down the OTLP exporter");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The le labels have to describe the same edges the contract does, or a
    // quantile computed in Grafana answers a different question than the one
    // computed by the postgres sink.
    #[test]
    fn bucket_labels_mirror_the_contracts_own_edges() {
        assert_eq!(bucket_label(0), "5");
        assert_eq!(bucket_label(6), "1000");
        assert_eq!(
            bucket_label(TELEMETRY_HISTOGRAM_BUCKET_COUNT - 1),
            OVERFLOW_BUCKET_LABEL
        );
        for (index, upper_bound) in TELEMETRY_HISTOGRAM_UPPER_BOUNDS_MS.iter().enumerate() {
            assert_eq!(bucket_label(index), upper_bound.to_string());
        }
    }

    #[test]
    fn a_negative_count_cannot_wrap_a_monotonic_counter() {
        assert_eq!(as_counter_value(12), 12);
        assert_eq!(as_counter_value(0), 0);
        assert_eq!(as_counter_value(-1), 0);
        assert_eq!(as_counter_value(i64::MIN), 0);
    }
}
