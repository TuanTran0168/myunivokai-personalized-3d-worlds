//! The binary: read the configuration, start the application, wait, stop.
//!
//! Everything else is in the library crate beside it — see `lib.rs` for the
//! layering. Keeping `main` this short is what makes the service testable
//! without a process, and it is why a reader looking for behaviour never has
//! to start here.

use anyhow::Context;
use telemetry_service::{observability, runtime, Application, Config};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    observability::initialise();

    // Deliberately fatal, the same way every Go service here refuses to start
    // on an unusable configuration. A telemetry service that starts with the
    // wrong sink looks identical to one that is working, right up until
    // somebody opens the screen and finds nothing.
    let config = Config::load()
        .map_err(anyhow::Error::msg)
        .context("load telemetry service configuration")?;
    tracing::info!(
        sink = config.sink.as_str(),
        environment = %config.app_environment,
        "telemetry service starting"
    );

    let application = Application::start(config).await?;
    tracing::info!("telemetry service ready");

    runtime::wait_for_shutdown_signal().await;
    tracing::info!("telemetry service stopping");
    application.shutdown().await;
    tracing::info!("telemetry service stopped");
    Ok(())
}
