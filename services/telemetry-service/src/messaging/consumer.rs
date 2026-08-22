//! The durable JetStream consumer that ingests one rollup envelope per flush.

use std::sync::Arc;

use anyhow::Context;
use futures_util::StreamExt;
use myunivokai_contracts::{
    Envelope, HttpRollupData, EVENTS_STREAM, TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT,
};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::domain::IngestOutcome;
use crate::sink::TelemetrySink;

/// This service's own durable consumer on `MYUNIVOKAI_EVENTS`. It is one more
/// consumer on a stream that already declares `max_consumers: -1`, and every
/// other consumer on it uses an explicit filter subject, so none of them can
/// see or affect another.
const EVENTS_DURABLE_NAME: &str = "telemetry-events-v1";

/// Unlike analytics-service, the filter is one literal subject rather than a
/// wildcard. This service is the read model for exactly one kind of event, and
/// a wildcard would hand it every world change in the platform to acknowledge
/// and throw away.
const EVENTS_FILTER_SUBJECT: &str = TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT;

/// Subscribes the durable consumer and returns the task draining it.
///
/// `max_deliver: -1` mirrors dna-service's results consumer, and for the same
/// reason: a write that fails is a transient database problem, and dropping
/// the envelope would leave a permanent hole in the rollups with nothing to
/// replay from once the stream's 7-day retention passes.
pub async fn spawn_rollup_consumer(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<JoinHandle<()>> {
    let jetstream = async_nats::jetstream::new(client);
    let stream = jetstream
        .get_stream(EVENTS_STREAM)
        .await
        .with_context(|| format!("open the {EVENTS_STREAM} stream"))?;
    let consumer = stream
        .get_or_create_consumer(
            EVENTS_DURABLE_NAME,
            async_nats::jetstream::consumer::pull::Config {
                durable_name: Some(EVENTS_DURABLE_NAME.to_owned()),
                filter_subject: EVENTS_FILTER_SUBJECT.to_owned(),
                ack_policy: async_nats::jetstream::consumer::AckPolicy::Explicit,
                ack_wait: config.consumer_ack_wait,
                max_deliver: -1,
                max_ack_pending: config.consumer_maximum_ack_pending,
                ..Default::default()
            },
        )
        .await
        .context("create the telemetry durable consumer")?;

    let mut messages = consumer
        .messages()
        .await
        .context("start draining the telemetry consumer")?;

    Ok(tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                _ = shutdown.changed() => break,
                next = messages.next() => match next {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => {
                        tracing::error!(%error, "fetch telemetry rollups");
                        continue;
                    }
                    None => break,
                },
            };
            handle_rollup(&sink, &config, message).await;
        }
        tracing::info!("telemetry rollup consumer stopped");
    }))
}

/// One delivery.
///
/// The ack/nak decision comes from [`crate::error::Error::is_retryable`]
/// rather than from a match written here, so the consumer and the service
/// layer cannot disagree about which failures are worth another attempt.
async fn handle_rollup(
    sink: &Arc<dyn TelemetrySink>,
    config: &Config,
    message: async_nats::jetstream::Message,
) {
    let envelope: Envelope<HttpRollupData> = match serde_json::from_slice(&message.payload) {
        Ok(envelope) => envelope,
        Err(error) => {
            // Acknowledged rather than redelivered forever. A payload this
            // service cannot decode will not become decodable on the fourth
            // attempt, and leaving it unacked blocks every envelope behind it.
            tracing::error!(%error, subject = %message.subject, "discard undecodable telemetry rollup");
            acknowledge(&message).await;
            return;
        }
    };

    match sink.write_rollup(&envelope).await {
        Ok(outcome) => {
            // info, not debug: this is the one line that answers "is anything
            // moving" for this service, the same question middleware.Logging
            // answers for api-gateway on every HTTP request. Left at debug it
            // was invisible under the default RUST_LOG=info this service ships
            // with, which is indistinguishable from the service doing nothing.
            match outcome {
                IngestOutcome::Stored => tracing::info!(
                    bucket_start = %envelope.data.bucket_start,
                    http_buckets = envelope.data.buckets.len(),
                    "telemetry rollup stored"
                ),
                IngestOutcome::AlreadyStored => tracing::info!(
                    bucket_start = %envelope.data.bucket_start,
                    instance_id = %envelope.data.instance_id,
                    "duplicate delivery already stored"
                ),
            }
            acknowledge(&message).await;
        }
        Err(error) if error.is_retryable() => {
            // Negatively acknowledged with a delay so the same failure does
            // not spin. The message stays on the stream, which is the whole
            // point of publishing it through JetStream in the first place.
            tracing::error!(%error, "store telemetry rollup; retrying");
            if let Err(nak_error) = message
                .ack_with(async_nats::jetstream::AckKind::Nak(Some(
                    config.consumer_retry_delay,
                )))
                .await
            {
                tracing::error!(error = %nak_error, "negatively acknowledge telemetry rollup");
            }
        }
        Err(error) => {
            // A malformed envelope will fail identically forever. Acking it
            // loses one interval; naking it blocks every interval behind it.
            tracing::error!(%error, subject = %message.subject, "discard unstorable telemetry rollup");
            acknowledge(&message).await;
        }
    }
}

async fn acknowledge(message: &async_nats::jetstream::Message) {
    if let Err(error) = message.ack().await {
        tracing::error!(%error, "acknowledge telemetry rollup");
    }
}
