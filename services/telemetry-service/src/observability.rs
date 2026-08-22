//! This service's own logging, which is deliberately not the thing it stores.
//!
//! Structured JSON matching what zerolog emits in every Go service here, so
//! one log drain reads the whole fleet the same way. `RUST_LOG` selects the
//! level using the `tracing` crate's own filter syntax; an absent or
//! unparseable value falls back to `info` rather than to silence, because a
//! service that logs nothing because of a typo looks exactly like one that is
//! not running.

pub fn initialise() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .init();
}
