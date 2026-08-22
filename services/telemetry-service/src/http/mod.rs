//! The HTTP surface, which is one route and exists for one reason.
//!
//! A Render free instance wakes only on inbound HTTP, and this service is
//! otherwise a pure NATS consumer that receives none. Everything a caller
//! actually asks of this service arrives over NATS; nothing in this module
//! will ever grow a business route, because adding one would put a second,
//! unauthenticated door on a service whose only door today is the gateway.

pub mod health;
