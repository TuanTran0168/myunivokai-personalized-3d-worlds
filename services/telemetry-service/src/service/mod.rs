//! The application layer: every decision this service makes that is not
//! storage and not transport.
//!
//! It mirrors `services/analytics-service/internal/services` exactly — a type
//! holding a repository, answering the questions the handlers ask, computing
//! nothing the database could compute and everything the database should not.
//! What lives here specifically:
//!
//! - which percentile is reported, and that it is labelled as interpolated
//! - what "error rate" means (5xx, not 4xx) once the repository has counted
//! - how eight separate reads become one overview response
//! - how long data is kept
//!
//! What does not live here: SQL, NATS, HTTP, and the sink switch.
//!
//! It is two files, split by what makes each of them change. [`telemetry`] is
//! the policy above, and changes when a rule does; [`mapping`] turns domain
//! aggregates into the wire types, and changes when `myunivokai-contracts`
//! does. Keeping them together meant a 90-line `overview` in which four lines
//! of policy were hidden among the field-by-field copying.

pub mod mapping;
pub mod telemetry;

pub use telemetry::TelemetryService;
