//! Composition: the one place that knows every layer exists.
//!
//! This is the "wire it all up" module every layered service needs, and
//! keeping it as a named type rather than a long `main` has a specific payoff:
//! [`Application::start`] is callable from a test, so "does this service
//! actually come up against a real broker and a real database" is a test
//! somebody can write rather than a thing only Docker knows.
//!
//! It is also the only module that reads a clock at startup, chooses a sink,
//! or spawns a task. Everything below it is handed what it needs.

use std::sync::Arc;

use anyhow::Context;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::{Config, SinkName};
use crate::repository::postgres::{run_migrations, PostgresRollupRepository};
use crate::sink::otlp::OtlpSink;
use crate::sink::postgres::PostgresSink;
use crate::sink::TelemetrySink;
use crate::{http, messaging, retention};

pub struct Application {
    config: Config,
    sink: Arc<dyn TelemetrySink>,
    client: async_nats::Client,
    shutdown_sender: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}

impl Application {
    /// Builds every layer in dependency order and starts serving.
    ///
    /// The health port binds first, before the database or the broker is
    /// reached, so a cold start has an inbound HTTP target while the rest is
    /// still connecting. Everything after that is fail-fast: a sink that
    /// cannot be built stops the process, because a telemetry service running
    /// with the wrong destination looks identical to a working one right up
    /// until somebody opens the screen.
    pub async fn start(config: Config) -> anyhow::Result<Self> {
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let mut tasks = Vec::new();

        tasks.push(tokio::spawn({
            let receiver = shutdown_receiver.clone();
            let port = config.health_port;
            async move {
                if let Err(error) = http::health::serve(port, receiver).await {
                    tracing::error!(%error, "telemetry health server failed");
                }
            }
        }));

        let sink = build_sink(&config).await?;
        let client = messaging::connect(&config).await?;

        tasks.push(
            messaging::spawn_rollup_consumer(
                client.clone(),
                config.clone(),
                sink.clone(),
                shutdown_receiver.clone(),
            )
            .await
            .context("start the telemetry rollup consumer")?,
        );
        tasks.extend(
            messaging::spawn_query_responders(
                client.clone(),
                config.clone(),
                sink.clone(),
                shutdown_receiver.clone(),
            )
            .await
            .context("start the telemetry query responders")?,
        );
        tasks.push(retention::spawn(
            config.clone(),
            sink.clone(),
            shutdown_receiver,
        ));

        Ok(Self {
            config,
            sink,
            client,
            shutdown_sender,
            tasks,
        })
    }

    /// Signals every task, waits for them within the configured budget, then
    /// releases the sink and the connection.
    ///
    /// The wait is bounded because a task blocked on an unreachable broker
    /// must not turn a stop into a kill: the host sends SIGKILL after its own
    /// grace period, and exiting cleanly first is the difference between a
    /// clean consumer checkpoint and a redelivery on the next boot.
    pub async fn shutdown(self) {
        let _ = self.shutdown_sender.send(true);
        let _ = tokio::time::timeout(self.config.shutdown_timeout, async {
            for task in self.tasks {
                let _ = task.await;
            }
        })
        .await;
        self.sink.shutdown().await;
        let _ = self.client.flush().await;
    }
}

/// The switch, read once, exactly where `AI_PROVIDER` and
/// `SERVICE_WAKE_PLATFORM` are read in their own services. Everything past
/// this line is written against the trait and never against a concrete sink.
async fn build_sink(config: &Config) -> anyhow::Result<Arc<dyn TelemetrySink>> {
    match config.sink {
        SinkName::Postgres => {
            // Migrations run before the pool that serves traffic is opened, so
            // a schema change that fails stops the process instead of
            // producing a service that answers every query with an error.
            run_migrations(config).await?;
            tracing::info!("telemetry database migrations complete");
            let repository = Arc::new(PostgresRollupRepository::connect(config).await?);
            Ok(Arc::new(PostgresSink::new(
                repository,
                config.retention_days,
            )))
        }
        SinkName::Otlp => Ok(Arc::new(OtlpSink::connect(config)?)),
    }
}

/// Blocks until the host asks this process to stop.
///
/// SIGTERM is what a container runtime sends; Ctrl-C is what a developer
/// sends. Handling only one of them means a graceful shutdown that works in
/// exactly one of the two places it is needed.
pub async fn wait_for_shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(error) => {
                    tracing::error!(%error, "install the SIGTERM handler");
                    let _ = interrupt.await;
                    return;
                }
            };
        tokio::select! {
            _ = interrupt => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = interrupt.await;
    }
}
