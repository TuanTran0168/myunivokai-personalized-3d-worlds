//! Mirrors the generic parts of `contracts/go/contracts.go`: the envelope
//! every message on this platform is wrapped in, and the request/reply
//! response shape every query answers with.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

pub const SCHEMA_VERSION_V1: &str = "1.0";

pub const COMMANDS_STREAM: &str = "MYUNIVOKAI_COMMANDS";
pub const EVENTS_STREAM: &str = "MYUNIVOKAI_EVENTS";

/// The three top-level fields every message carries, and deliberately nothing
/// more — `contracts/schemas/message-envelope.schema.json` sets
/// `additionalProperties: false`, so a fourth field is a contract violation
/// rather than an extension point.
///
/// `timestamp` is serialised as RFC 3339 because that is what Go's
/// `time.Time` marshals to. Nothing here reads a clock: an envelope is
/// constructed by whoever has a reason to stamp it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope<DataType> {
    pub job_id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub timestamp: OffsetDateTime,
    pub data: DataType,
}

impl<DataType> Envelope<DataType> {
    pub fn new(job_id: impl Into<String>, timestamp: OffsetDateTime, data: DataType) -> Self {
        Self {
            job_id: job_id.into(),
            timestamp,
            data,
        }
    }

    /// Mirrors Go's `Envelope.Validate`: an envelope with no job id or no
    /// timestamp cannot be correlated with anything, which makes it worse than
    /// no message at all.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.job_id.trim().is_empty() {
            return Err("jobId is required");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDetail {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<ValidationDetail>,
}

/// Mirrors `contracts.RPCResponseData`. `payload` is a `serde_json::Value`
/// rather than a typed body for the same reason Go uses `json.RawMessage`: the
/// transport does not know, and must not need to know, which query it is
/// carrying an answer for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcResponseData {
    pub status_code: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// Mirrors `contracts.SuccessRPCEnvelope`.
pub fn success_rpc_envelope<PayloadType: Serialize>(
    job_id: impl Into<String>,
    timestamp: OffsetDateTime,
    status_code: u16,
    payload: &PayloadType,
) -> Result<Envelope<RpcResponseData>, serde_json::Error> {
    Ok(Envelope::new(
        job_id,
        timestamp,
        RpcResponseData {
            status_code,
            payload: Some(serde_json::to_value(payload)?),
            error: None,
        },
    ))
}

/// Mirrors `contracts.ErrorRPCEnvelope`. It cannot fail, because a caller that
/// is already reporting an error must never be handed a second one.
pub fn error_rpc_envelope(
    job_id: impl Into<String>,
    timestamp: OffsetDateTime,
    status_code: u16,
    code: impl Into<String>,
    message: impl Into<String>,
) -> Envelope<RpcResponseData> {
    Envelope::new(
        job_id,
        timestamp,
        RpcResponseData {
            status_code,
            payload: None,
            error: Some(RpcError {
                code: code.into(),
                message: message.into(),
                details: Vec::new(),
            }),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn envelope_round_trips_through_the_three_wire_fields() {
        let envelope = Envelope::new(
            "01K0EXAMPLE000000000000021",
            datetime!(2026-08-13 09:15:00 UTC),
            serde_json::json!({ "hello": "world" }),
        );
        let encoded = serde_json::to_value(&envelope).expect("encode envelope");
        let object = encoded.as_object().expect("envelope encodes to an object");
        assert_eq!(
            object.len(),
            3,
            "the envelope schema forbids a fourth top-level field"
        );
        assert_eq!(object["jobId"], "01K0EXAMPLE000000000000021");
        assert_eq!(object["timestamp"], "2026-08-13T09:15:00Z");

        let decoded: Envelope<serde_json::Value> =
            serde_json::from_value(encoded).expect("decode envelope");
        assert_eq!(decoded, envelope);
    }

    #[test]
    fn an_envelope_without_a_job_id_is_rejected() {
        let envelope = Envelope::new("   ", datetime!(2026-08-13 09:15:00 UTC), 1);
        assert!(envelope.validate().is_err());
    }

    #[test]
    fn a_success_envelope_carries_a_payload_and_no_error() {
        let envelope = success_rpc_envelope(
            "job",
            datetime!(2026-08-13 09:15:00 UTC),
            200,
            &serde_json::json!({ "routes": [] }),
        )
        .expect("encode payload");
        assert_eq!(envelope.data.status_code, 200);
        assert!(envelope.data.error.is_none());
        assert!(envelope.data.payload.is_some());
    }

    #[test]
    fn an_error_envelope_omits_the_payload_entirely() {
        let envelope = error_rpc_envelope(
            "job",
            datetime!(2026-08-13 09:15:00 UTC),
            503,
            "SINK_UNSUPPORTED",
            "This sink cannot answer range queries.",
        );
        let encoded = serde_json::to_value(&envelope).expect("encode envelope");
        assert!(encoded["data"].get("payload").is_none());
        assert_eq!(encoded["data"]["error"]["code"], "SINK_UNSUPPORTED");
    }
}
