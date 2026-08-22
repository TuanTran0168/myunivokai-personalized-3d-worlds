//! The sink that stores rollups in this repository's own schema.
//!
//! Deliberately thin. Everything it appears to do is done by
//! [`TelemetryService`] one layer down; what it adds is the descriptor — the
//! one fact the service layer has no opinion about, because "which destination
//! am I" is a deployment question rather than a business one.

use std::sync::Arc;

use async_trait::async_trait;
use myunivokai_contracts::{
    HttpRollupEnvelope, TelemetryOverviewQueryData, TelemetryOverviewResponseData,
    TelemetryRouteListQueryData, TelemetryRouteListResponseData, TelemetrySinkDescriptor,
    TELEMETRY_SINK_POSTGRES,
};
use time::OffsetDateTime;

use super::TelemetrySink;
use crate::domain::IngestOutcome;
use crate::error::Result;
use crate::repository::postgres::PostgresRollupRepository;
use crate::service::TelemetryService;

pub struct PostgresSink {
    service: TelemetryService,
    /// Held so shutdown can close the pool. The service holds the same
    /// repository as a trait object and cannot close it — closing a pool is a
    /// property of this concrete adapter, not of "storage".
    repository: Arc<PostgresRollupRepository>,
}

impl PostgresSink {
    pub fn new(repository: Arc<PostgresRollupRepository>, retention_days: i64) -> Self {
        Self {
            service: TelemetryService::new(repository.clone(), retention_days),
            repository,
        }
    }
}

#[async_trait]
impl TelemetrySink for PostgresSink {
    fn descriptor(&self) -> TelemetrySinkDescriptor {
        TelemetrySinkDescriptor {
            sink: TELEMETRY_SINK_POSTGRES.to_owned(),
            charts_available: true,
            dashboard_url: String::new(),
        }
    }

    async fn write_rollup(&self, envelope: &HttpRollupEnvelope) -> Result<IngestOutcome> {
        self.service.ingest(envelope).await
    }

    async fn overview(
        &self,
        query: &TelemetryOverviewQueryData,
        now: OffsetDateTime,
    ) -> Result<TelemetryOverviewResponseData> {
        self.service.overview(query, self.descriptor(), now).await
    }

    async fn routes(
        &self,
        query: &TelemetryRouteListQueryData,
        now: OffsetDateTime,
    ) -> Result<TelemetryRouteListResponseData> {
        self.service.routes(query, self.descriptor(), now).await
    }

    async fn prune(&self, now: OffsetDateTime) -> Result<u64> {
        self.service.prune(now).await
    }

    async fn shutdown(&self) {
        self.repository.close().await;
    }
}
