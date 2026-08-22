//! The retention sweep, enforced on a ticker rather than described in a
//! document.
//!
//! It lives inside this process rather than in a scheduled job because a
//! scale-to-zero service has nowhere to schedule one — and because a deletion
//! that only happens while the service is awake is exactly right: nothing is
//! growing while it sleeps either.

use std::sync::Arc;

use time::OffsetDateTime;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::sink::TelemetrySink;

pub fn spawn(
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    mut shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(config.retention_sweep_interval);
        // The first tick fires immediately, which is wanted: a service that
        // wakes for two minutes every few days would otherwise never reach its
        // first sweep, and the deletion would be permanently deferred by the
        // very sleeping this whole design is built around.
        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                _ = ticker.tick() => sweep(&sink, &config).await,
            }
        }
        tracing::info!("retention sweep stopped");
    })
}

async fn sweep(sink: &Arc<dyn TelemetrySink>, config: &Config) {
    match sink.prune(OffsetDateTime::now_utc()).await {
        Ok(0) => tracing::debug!("retention sweep found nothing to delete"),
        Ok(deleted) => tracing::info!(
            deleted,
            retention_days = config.retention_days,
            "retention sweep deleted expired rollups"
        ),
        // Never fatal. Storage filling up eventually is a worse outcome than a
        // failed sweep, but refusing to consume events because a DELETE failed
        // is worse than both.
        Err(error) => tracing::error!(%error, "retention sweep failed"),
    }
}
