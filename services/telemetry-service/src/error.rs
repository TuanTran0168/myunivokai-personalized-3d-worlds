//! The service's error type, and the one place a failure is turned into
//! something a caller may see.
//!
//! Rust's split between `thiserror` and `anyhow` is a real convention rather
//! than taste, and this crate follows it: **library code returns a typed error
//! a caller can match on; application code returns `anyhow::Error`, which
//! carries context for a human and is never matched on.** Everything under
//! `domain`, `repository`, `service` and `sink` returns [`Error`]; `main.rs`
//! and `runtime.rs` return `anyhow::Result` because nothing above them makes a
//! decision from the failure - the process either starts or exits.
//!
//! [`Error::describe`] is the equivalent of `analytics-service`'s
//! `describeQueryError`: one function mapping every failure to the status,
//! code and sentence a caller receives, so no two handlers can disagree about
//! what a missing row means.

/// The crate-wide result alias. `Result<T>` reads as "this can fail the way
/// this service fails", which is the point of the alias existing.
pub type Result<ValueType> = std::result::Result<ValueType, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The sink stores nothing locally, so a range query has no answer here.
    ///
    /// This is an error at the trait boundary and deliberately NOT an error on
    /// the wire: the query responder turns it into a successful response whose
    /// `chartsAvailable` is false and whose `dashboardUrl` says where to look.
    /// A missing chart must read as "look elsewhere", never as a broken
    /// screen.
    #[error("this sink cannot answer range queries: {0}")]
    Unsupported(&'static str),

    /// A rollup envelope that decoded but cannot be stored - a bucket with no
    /// route, a status class outside 1..5, a negative counter. Rejected rather
    /// than clamped: a corrupt counter silently added to a total is worse than
    /// a dropped message, because nothing downstream can tell it happened.
    #[error("rollup envelope is not valid: {0}")]
    InvalidRollup(String),

    /// Anything the database refused. The underlying `sqlx::Error` is kept for
    /// the log and never shown to a caller.
    #[error("telemetry storage failed: {0}")]
    Storage(#[from] sqlx::Error),

    /// A response that could not be encoded. Practically unreachable, and
    /// still typed rather than unwrapped: a panic inside a NATS responder
    /// leaves the caller waiting on an inbox that will never answer, which the
    /// gateway cannot tell apart from a sleeping service.
    #[error("could not encode a telemetry response: {0}")]
    Encoding(#[from] serde_json::Error),

    /// The metrics exporter refused a push.
    #[error("could not export telemetry metrics: {0}")]
    Export(String),
}

/// What a caller is told. Mirrors the shape every Go service here already
/// answers with, so one gateway relay handles all of them identically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorDescription {
    pub status_code: u16,
    pub code: &'static str,
    /// Deliberately a fixed sentence rather than the error's own text. A
    /// storage failure's message can name a column, a constraint or a host,
    /// and none of that belongs in a response to the admin app.
    pub message: &'static str,
}

impl Error {
    pub fn describe(&self) -> ErrorDescription {
        match self {
            // Never reaches a caller as an error - the responder converts it
            // into a 200 that says where the charts are. It is described here
            // anyway so that a future caller which forgets to convert fails
            // honestly instead of reporting an internal error.
            Error::Unsupported(_) => ErrorDescription {
                status_code: 501,
                code: "SINK_UNSUPPORTED",
                message: "This telemetry sink does not store data locally.",
            },
            Error::InvalidRollup(_) => ErrorDescription {
                status_code: 400,
                code: "INVALID_PAYLOAD",
                message: "The telemetry rollup payload could not be accepted.",
            },
            Error::Storage(_) | Error::Encoding(_) | Error::Export(_) => ErrorDescription {
                status_code: 500,
                code: "INTERNAL_ERROR",
                message: "The telemetry query could not be completed.",
            },
        }
    }

    /// Whether redelivering the message could plausibly succeed.
    ///
    /// This is what decides ack versus nak in the consumer, and getting it
    /// backwards is expensive in both directions: naking a permanently broken
    /// envelope blocks every message behind it forever, while acking a
    /// transient database failure loses an interval that would have stored
    /// fine a second later.
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Storage(_) => true,
            Error::Export(_) => true,
            Error::Unsupported(_) | Error::InvalidRollup(_) | Error::Encoding(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_storage_failure_never_leaks_its_detail_to_a_caller() {
        let error = Error::Storage(sqlx::Error::RowNotFound);
        let description = error.describe();
        assert_eq!(description.status_code, 500);
        assert_eq!(description.code, "INTERNAL_ERROR");
        assert!(
            !description.message.to_lowercase().contains("row"),
            "the public message repeated the driver's own wording: {}",
            description.message
        );
    }

    #[test]
    fn a_malformed_envelope_is_the_callers_problem_not_a_server_error() {
        let error = Error::InvalidRollup("buckets.0.routePattern is required".to_owned());
        assert_eq!(error.describe().status_code, 400);
    }

    // Retryability is what decides ack versus nak, and both mistakes are
    // expensive: a nak on a permanently broken envelope blocks the stream, an
    // ack on a transient failure loses an interval.
    #[test]
    fn only_failures_that_could_succeed_on_a_retry_are_retryable() {
        assert!(Error::Storage(sqlx::Error::PoolTimedOut).is_retryable());
        assert!(Error::Export("exporter refused".to_owned()).is_retryable());
        assert!(!Error::InvalidRollup("no route".to_owned()).is_retryable());
        assert!(!Error::Unsupported("otlp stores nothing").is_retryable());
    }
}
