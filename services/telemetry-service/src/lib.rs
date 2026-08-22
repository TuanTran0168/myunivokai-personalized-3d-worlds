//! telemetry-service — the one process in this repository that is not written
//! in Go.
//!
//! It consumes one aggregated rollup envelope per minute from the gateway,
//! stores it through whichever sink is configured, and answers admin queries
//! over the same one it just wrote. It never sees a raw per-request event and
//! never talks to any service but NATS.
//!
//! # Why this is a library crate with a two-line binary
//!
//! `src/main.rs` is a shell over this crate rather than the service itself.
//! That is the standard Rust split and it buys two concrete things here:
//! integration tests under `tests/` are separate crates that can only reach a
//! *library*, and `cargo doc` produces a browsable map of the layering below.
//! A service whose logic lives in `main.rs` can be tested only through its
//! process.
//!
//! # The layering
//!
//! Read top to bottom; each layer may call the one under it and never the
//! reverse. It mirrors `services/analytics-service`'s Go packages one for one,
//! because a reader who knows that service should not have to learn a second
//! architecture to read this one.
//!
//! | Layer | Module | Knows about | Never knows about |
//! | --- | --- | --- | --- |
//! | Composition | [`runtime`] | everything | — |
//! | Transport | [`messaging`], [`http`] | sinks, envelopes | SQL, percentiles |
//! | Destination | [`sink`] | services, exporters | NATS, transactions |
//! | Application | [`service`] | repositories, domain | SQL, NATS, sinks |
//! | Storage | [`repository`] | domain, sqlx | responses, percentiles |
//! | Domain | [`domain`] | itself | I/O of any kind |
//!
//! Two modules sit outside the stack on purpose: [`error`] is shared by every
//! layer because a failure crosses all of them, and [`testing`] exists so a
//! unit test and an integration test build the same fixtures the same way.
//!
//! # Where the SQL is, and why there is no ORM
//!
//! Every statement lives in [`repository::postgres::statements`]. This
//! service's write path adds two arrays elementwise inside an `ON CONFLICT`
//! clause and its read path is `SUM(...) FILTER (WHERE ...)` over grouped time
//! buckets — neither is expressible in an ActiveRecord-style API, so SeaORM or
//! Diesel would call their raw-SQL escape hatch for every one of them and
//! leave an entity layer as decoration. `sqlx` is the ecosystem's answer for
//! exactly this case. The full reasoning, and what would change the answer, is
//! in `notes/be/rust-service-architecture.md`.

pub mod config;
pub mod domain;
pub mod error;
pub mod http;
pub mod messaging;
pub mod observability;
pub mod repository;
pub mod retention;
pub mod runtime;
pub mod service;
pub mod sink;
pub mod testing;

pub use config::{Config, SinkName};
pub use error::{Error, Result};
pub use runtime::Application;
