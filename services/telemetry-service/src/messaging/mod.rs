//! The transport layer: NATS in, NATS out, and nothing else.
//!
//! It mirrors `services/analytics-service/internal/messaging` plus that
//! service's `internal/handlers` — the runtime owns connection lifecycle and
//! subscription registration, the handlers decode an envelope, call the sink
//! and encode a reply. No business decision is made in this module; the only
//! judgement it exercises is ack versus nak, which is a transport question.
//!
//! What is absent is as deliberate as what is here: this service publishes no
//! subject except the caller's reply inbox, and its NATS user grants nothing
//! else.

pub mod connection;
pub mod consumer;
pub mod responder;

pub use connection::connect;
pub use consumer::spawn_rollup_consumer;
pub use responder::spawn_query_responders;
