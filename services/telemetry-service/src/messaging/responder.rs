//! The Core NATS request/reply responders for the two query subjects.

use std::sync::Arc;

use anyhow::Context;
use futures_util::StreamExt;
use myunivokai_contracts::{
    error_rpc_envelope, success_rpc_envelope, Envelope, RpcResponseData,
    TelemetryOverviewQueryData, TelemetryRouteListQueryData, TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT,
    TELEMETRY_ROUTE_LIST_QUERY_SUBJECT,
};
use serde::Serialize;
use time::OffsetDateTime;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::error::Error;
use crate::sink::{charts_are_elsewhere_overview, charts_are_elsewhere_routes, TelemetrySink};

/// Queue subscriptions rather than plain ones, so two instances of this
/// service during a deploy answer one caller once instead of racing two
/// replies into the same inbox.
const QUERY_QUEUE_GROUP: &str = "telemetry-service-v1";

/// The job id used when a payload could not be decoded far enough to recover
/// the caller's own. Matches analytics-service's `invalidRequestJobID`.
const INVALID_REQUEST_JOB_ID: &str = "invalid-request";

const HTTP_OK: u16 = 200;
const HTTP_BAD_REQUEST: u16 = 400;
const HTTP_GATEWAY_TIMEOUT: u16 = 504;

pub async fn spawn_query_responders(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    shutdown: watch::Receiver<bool>,
) -> anyhow::Result<Vec<JoinHandle<()>>> {
    let overview = spawn_responder(
        client.clone(),
        config.clone(),
        sink.clone(),
        shutdown.clone(),
        TELEMETRY_OVERVIEW_GET_QUERY_SUBJECT,
    )
    .await?;
    let routes = spawn_responder(
        client,
        config,
        sink,
        shutdown,
        TELEMETRY_ROUTE_LIST_QUERY_SUBJECT,
    )
    .await?;
    Ok(vec![overview, routes])
}

async fn spawn_responder(
    client: async_nats::Client,
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    mut shutdown: watch::Receiver<bool>,
    subject: &'static str,
) -> anyhow::Result<JoinHandle<()>> {
    let mut subscription = client
        .queue_subscribe(subject.to_owned(), QUERY_QUEUE_GROUP.to_owned())
        .await
        .with_context(|| format!("subscribe telemetry query {subject}"))?;
    let reply_client = client.clone();

    Ok(tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                _ = shutdown.changed() => break,
                next = subscription.next() => match next {
                    Some(message) => message,
                    None => break,
                },
            };
            let Some(reply_subject) = message.reply.clone() else {
                // A query with no reply inbox is a publisher bug, not a
                // request. Answering nowhere is the only correct response.
                tracing::warn!(subject = %message.subject, "telemetry query carried no reply subject");
                continue;
            };
            let sink = sink.clone();
            let config = config.clone();
            let reply_client = reply_client.clone();
            // Spawned so a slow query cannot hold up the next caller. The
            // deadline inside `answer` bounds how long one of these can live.
            tokio::spawn(async move {
                let payload = answer(sink, config, message).await;
                if let Err(error) = reply_client.publish(reply_subject, payload.into()).await {
                    tracing::error!(%error, "publish telemetry query reply");
                }
            });
        }
        tracing::info!(%subject, "telemetry query responder stopped");
    }))
}

/// Builds the reply bytes for one query.
///
/// Dispatch is on the subject rather than on the responder that received it,
/// so adding a third query subject is one arm here instead of another
/// parameter threaded through the spawn path.
///
/// The one structured line per query answered, at info: the Core NATS
/// equivalent of what middleware.Logging gives every HTTP service in this
/// repo for free. Subject and timing only, matching Go's own gateway request
/// log line — never the query window or the response body, neither of which
/// says anything a log needs to.
async fn answer(
    sink: Arc<dyn TelemetrySink>,
    config: Config,
    message: async_nats::Message,
) -> Vec<u8> {
    let start = std::time::Instant::now();
    let subject = message.subject.clone();
    let reply = if subject.as_str() == TELEMETRY_ROUTE_LIST_QUERY_SUBJECT {
        answer_routes(sink, config, &message.payload).await
    } else {
        answer_overview(sink, config, &message.payload).await
    };
    tracing::info!(%subject, duration_ms = start.elapsed().as_millis() as u64, "telemetry query answered");
    reply
}

async fn answer_overview(sink: Arc<dyn TelemetrySink>, config: Config, payload: &[u8]) -> Vec<u8> {
    let envelope: Envelope<TelemetryOverviewQueryData> = match decode_query(payload) {
        Ok(envelope) => envelope,
        Err(reply) => return reply,
    };
    let job_id = envelope.job_id.clone();
    let query = envelope.data;
    let now = OffsetDateTime::now_utc();

    match tokio::time::timeout(config.query_timeout, sink.overview(&query, now)).await {
        Ok(Ok(response)) => encode_success(&job_id, &response),
        Ok(Err(Error::Unsupported(reason))) => {
            // Not an error on the wire. A missing chart has to read as "look
            // elsewhere", never as a broken screen.
            tracing::debug!(%reason, "answering an overview query from a sink that stores nothing");
            encode_success(
                &job_id,
                &charts_are_elsewhere_overview(sink.descriptor(), &query, now),
            )
        }
        Ok(Err(error)) => encode_failure(&job_id, &error),
        Err(_) => encode_timeout(&job_id),
    }
}

async fn answer_routes(sink: Arc<dyn TelemetrySink>, config: Config, payload: &[u8]) -> Vec<u8> {
    let envelope: Envelope<TelemetryRouteListQueryData> = match decode_query(payload) {
        Ok(envelope) => envelope,
        Err(reply) => return reply,
    };
    let job_id = envelope.job_id.clone();
    let query = envelope.data;
    let now = OffsetDateTime::now_utc();

    match tokio::time::timeout(config.query_timeout, sink.routes(&query, now)).await {
        Ok(Ok(response)) => encode_success(&job_id, &response),
        Ok(Err(Error::Unsupported(reason))) => {
            tracing::debug!(%reason, "answering a route query from a sink that stores nothing");
            encode_success(
                &job_id,
                &charts_are_elsewhere_routes(sink.descriptor(), &query, now),
            )
        }
        Ok(Err(error)) => encode_failure(&job_id, &error),
        Err(_) => encode_timeout(&job_id),
    }
}

fn decode_query<DataType: serde::de::DeserializeOwned>(
    payload: &[u8],
) -> std::result::Result<Envelope<DataType>, Vec<u8>> {
    match serde_json::from_slice::<Envelope<DataType>>(payload) {
        Ok(envelope) => match envelope.validate() {
            Ok(()) => Ok(envelope),
            Err(reason) => Err(encode_envelope(&error_rpc_envelope(
                INVALID_REQUEST_JOB_ID,
                OffsetDateTime::now_utc(),
                HTTP_BAD_REQUEST,
                "INVALID_ENVELOPE",
                reason,
            ))),
        },
        Err(_) => Err(encode_envelope(&error_rpc_envelope(
            INVALID_REQUEST_JOB_ID,
            OffsetDateTime::now_utc(),
            HTTP_BAD_REQUEST,
            "INVALID_PAYLOAD",
            "The telemetry query payload could not be decoded.",
        ))),
    }
}

fn encode_success<PayloadType: Serialize>(job_id: &str, payload: &PayloadType) -> Vec<u8> {
    match success_rpc_envelope(job_id, OffsetDateTime::now_utc(), HTTP_OK, payload) {
        Ok(envelope) => encode_envelope(&envelope),
        Err(error) => encode_failure(job_id, &Error::Encoding(error)),
    }
}

/// The one place a failure becomes a response, using [`Error::describe`] so no
/// two handlers can disagree about what a given failure means to a caller.
fn encode_failure(job_id: &str, error: &Error) -> Vec<u8> {
    let description = error.describe();
    tracing::error!(%error, code = description.code, "answer telemetry query");
    encode_envelope(&error_rpc_envelope(
        job_id,
        OffsetDateTime::now_utc(),
        description.status_code,
        description.code,
        description.message,
    ))
}

fn encode_timeout(job_id: &str) -> Vec<u8> {
    encode_envelope(&error_rpc_envelope(
        job_id,
        OffsetDateTime::now_utc(),
        HTTP_GATEWAY_TIMEOUT,
        "QUERY_TIMEOUT",
        "The telemetry query took too long. Narrow the window.",
    ))
}

/// The last resort. Serialising an RPC envelope cannot realistically fail, and
/// a caller waiting on a reply inbox must receive bytes rather than silence —
/// silence is indistinguishable from a sleeping service and would send the
/// gateway into a wake it does not need.
fn encode_envelope(envelope: &Envelope<RpcResponseData>) -> Vec<u8> {
    serde_json::to_vec(envelope).unwrap_or_else(|_| {
        br#"{"jobId":"invalid-request","timestamp":"1970-01-01T00:00:00Z","data":{"statusCode":500,"error":{"code":"INTERNAL_ERROR","message":"The telemetry response could not be encoded."}}}"#
            .to_vec()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decoded(reply: &[u8]) -> Envelope<RpcResponseData> {
        serde_json::from_slice(reply).expect("every reply must be a valid envelope")
    }

    #[test]
    fn an_undecodable_query_is_answered_rather_than_ignored() {
        let reply = decode_query::<TelemetryOverviewQueryData>(b"not json").unwrap_err();
        let envelope = decoded(&reply);
        assert_eq!(envelope.data.status_code, HTTP_BAD_REQUEST);
        assert_eq!(envelope.data.error.expect("error").code, "INVALID_PAYLOAD");
    }

    #[test]
    fn an_envelope_without_a_job_id_is_rejected_before_the_sink_is_touched() {
        let payload = br#"{"jobId":"  ","timestamp":"2026-08-13T09:15:00Z","data":{"hours":24}}"#;
        let reply = decode_query::<TelemetryOverviewQueryData>(payload).unwrap_err();
        assert_eq!(
            decoded(&reply).data.error.expect("error").code,
            "INVALID_ENVELOPE"
        );
    }

    #[test]
    fn a_valid_query_decodes_into_its_own_type() {
        let payload =
            br#"{"jobId":"request-1","timestamp":"2026-08-13T09:15:00Z","data":{"hours":12}}"#;
        let envelope = decode_query::<TelemetryOverviewQueryData>(payload).expect("decode");
        assert_eq!(envelope.job_id, "request-1");
        assert_eq!(envelope.data.hours, 12);
    }

    // The gateway relays whatever reply arrives. A timeout that produced no
    // bytes would look exactly like a sleeping service and send it into a wake
    // it does not need.
    #[test]
    fn a_timeout_still_produces_a_reply() {
        let envelope = decoded(&encode_timeout("request-1"));
        assert_eq!(envelope.data.status_code, HTTP_GATEWAY_TIMEOUT);
        assert_eq!(envelope.data.error.expect("error").code, "QUERY_TIMEOUT");
    }

    // A storage failure's own text can name a column, a constraint or a host.
    // None of that belongs in a response to the admin app.
    #[test]
    fn a_storage_failure_answers_with_a_fixed_sentence() {
        let envelope = decoded(&encode_failure(
            "request-1",
            &Error::Storage(sqlx::Error::RowNotFound),
        ));
        let error = envelope.data.error.expect("error");
        assert_eq!(envelope.data.status_code, 500);
        assert_eq!(error.code, "INTERNAL_ERROR");
        assert_eq!(error.message, "The telemetry query could not be completed.");
    }
}
