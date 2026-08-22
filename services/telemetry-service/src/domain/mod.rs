//! The domain layer: the types this service reasons about, and nothing else.
//!
//! Nothing here performs I/O, opens a connection, reads a clock it was not
//! handed, or knows that PostgreSQL exists. That is the whole rule, and it is
//! what makes every unit test in this module run in microseconds with no
//! container behind it.
//!
//! It is deliberately NOT the same as `myunivokai-contracts`. That crate is
//! the wire shape, shared with the Go gateway and frozen by a fixture; these
//! are the storage and aggregate shapes this service works in. Keeping them
//! apart is what lets the schema change without touching the wire, and the
//! wire change without rewriting the schema - [`rollup::RollupBatch`] is the
//! one place the two meet, and it is a function with a name rather than a
//! `#[serde]` attribute doing it invisibly.

pub mod aggregate;
pub mod latency;
pub mod rollup;
pub mod window;

pub use aggregate::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, HttpTotals,
    RouteAggregate, StatusClassCount, VolumeBucket, WakeSignalBucket,
};
pub use latency::LatencySummary;
pub use rollup::{
    CacheRollupRow, ErrorCodeRollupRow, HttpRollupRow, IngestOutcome, NatsRollupRow, RollupBatch,
};
pub use window::QueryWindow;
