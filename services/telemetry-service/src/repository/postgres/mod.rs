//! The PostgreSQL adapter for [`RollupRepository`].
//!
//! It owns the pool, the transaction boundary and nothing else: no percentile
//! is computed here, no percentage, no response shape. The reason is the one
//! that makes this layer worth having at all - if the SQL decided what a p95
//! is, changing the admin app's response would mean editing a query.

pub mod rows;
pub mod statements;

use std::time::Duration;

use async_trait::async_trait;
use myunivokai_contracts::TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use time::OffsetDateTime;

use super::RollupRepository;
use crate::config::Config;
use crate::domain::{
    BackendAggregate, CacheAggregate, ErrorCodeAggregate, HourOfDayBucket, HttpTotals,
    IngestOutcome, RollupBatch, RouteAggregate, StatusClassCount, VolumeBucket, WakeSignalBucket,
};
use crate::error::Result;

/// A status class of 5 or above is what "error rate" counts. Bound as a
/// parameter rather than inlined so the one definition lives in Rust beside
/// the comment explaining it, instead of being repeated in four query strings.
const SERVER_ERROR_STATUS_CLASS: i16 = 5;

/// The gateway's own code for "the service is starting up".
const WAKE_SIGNAL_ERROR_CODE: &str = "SERVICE_WAKING";

const POOL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);
const MIGRATION_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PostgresRollupRepository {
    pool: PgPool,
}

impl PostgresRollupRepository {
    pub async fn connect(config: &Config) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(config.database_maximum_connections)
            .acquire_timeout(POOL_ACQUIRE_TIMEOUT)
            .connect(&config.database_url)
            .await?;
        Ok(Self { pool })
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }
}

/// Runs the migrations against the DIRECT url when one is supplied, because
/// Neon's pooled endpoint cannot execute DDL - the same reason every Go
/// service here carries the pair.
///
/// Unlike those services this needs no `MIGRATIONS_DIR` at runtime: `migrate!`
/// embeds the SQL files into the binary at compile time, so the container
/// cannot start with migrations that do not match its own code.
pub async fn run_migrations(config: &Config) -> anyhow::Result<()> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(MIGRATION_ACQUIRE_TIMEOUT)
        .connect(config.migration_database_url())
        .await?;
    let outcome = sqlx::migrate!("./migrations").run(&pool).await;
    pool.close().await;
    Ok(outcome?)
}

#[async_trait]
impl RollupRepository for PostgresRollupRepository {
    /// One transaction per envelope, inbox row first.
    ///
    /// Writing the inbox row first and abandoning the transaction when it
    /// conflicts is what makes a redelivery a no-op rather than a double
    /// count: every accumulation below adds, so applying one envelope twice
    /// would silently double an interval with nothing to detect it afterwards.
    async fn record_batch(&self, batch: &RollupBatch) -> Result<IngestOutcome> {
        let mut transaction = self.pool.begin().await?;

        let inserted = sqlx::query(statements::INSERT_INBOX)
            .bind(batch.message_id.as_str())
            .bind(TELEMETRY_HTTP_ROLLUP_EVENT_SUBJECT)
            .execute(&mut *transaction)
            .await?
            .rows_affected();
        if inserted == 0 {
            transaction.rollback().await?;
            return Ok(IngestOutcome::AlreadyStored);
        }

        for row in &batch.http {
            sqlx::query(statements::UPSERT_HTTP_ROLLUP)
                .bind(batch.bucket_start)
                .bind(row.route_pattern.as_str())
                .bind(row.method.as_str())
                .bind(row.status_class)
                .bind(row.request_count)
                .bind(row.duration_sum_ms)
                .bind(row.duration_max_ms)
                .bind(row.histogram.to_vec())
                .execute(&mut *transaction)
                .await?;
        }

        for row in &batch.error_codes {
            sqlx::query(statements::UPSERT_ERROR_CODE_ROLLUP)
                .bind(batch.bucket_start)
                .bind(row.error_code.as_str())
                .bind(row.count)
                .execute(&mut *transaction)
                .await?;
        }

        for row in &batch.nats {
            sqlx::query(statements::UPSERT_NATS_ROLLUP)
                .bind(batch.bucket_start)
                .bind(row.service.as_str())
                .bind(row.request_count)
                .bind(row.duration_sum_ms)
                .bind(row.duration_max_ms)
                .bind(row.histogram.to_vec())
                .bind(row.error_count)
                .execute(&mut *transaction)
                .await?;
        }

        for row in &batch.cache {
            sqlx::query(statements::UPSERT_CACHE_ROLLUP)
                .bind(batch.bucket_start)
                .bind(row.namespace.as_str())
                .bind(row.hits)
                .bind(row.misses)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(IngestOutcome::Stored)
    }

    async fn http_totals(&self, since: OffsetDateTime) -> Result<HttpTotals> {
        let row = sqlx::query(statements::SELECT_TOTALS)
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_one(&self.pool)
            .await?;
        Ok(rows::http_totals(&row)?)
    }

    async fn http_totals_between(
        &self,
        since: OffsetDateTime,
        until: OffsetDateTime,
    ) -> Result<HttpTotals> {
        let row = sqlx::query(statements::SELECT_TOTALS_BETWEEN)
            .bind(since)
            .bind(until)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_one(&self.pool)
            .await?;
        Ok(rows::http_totals(&row)?)
    }

    async fn status_mix(&self, since: OffsetDateTime) -> Result<Vec<StatusClassCount>> {
        let fetched = sqlx::query(statements::SELECT_STATUS_MIX)
            .bind(since)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::status_class_count)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn volume_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>> {
        let fetched = sqlx::query(statements::SELECT_VOLUME_BUCKETS)
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::volume_bucket)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn hourly_buckets(&self, since: OffsetDateTime) -> Result<Vec<VolumeBucket>> {
        let fetched = sqlx::query(statements::SELECT_HOURLY_BUCKETS)
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::volume_bucket)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn hour_of_day(&self, since: OffsetDateTime) -> Result<Vec<HourOfDayBucket>> {
        let fetched = sqlx::query(statements::SELECT_HOUR_OF_DAY)
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::hour_of_day_bucket)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn top_error_codes(
        &self,
        since: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<ErrorCodeAggregate>> {
        let fetched = sqlx::query(statements::SELECT_TOP_ERROR_CODES)
            .bind(since)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::error_code_aggregate)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn wake_signals(&self, since: OffsetDateTime) -> Result<Vec<WakeSignalBucket>> {
        let fetched = sqlx::query(statements::SELECT_WAKE_SIGNALS)
            .bind(since)
            .bind(WAKE_SIGNAL_ERROR_CODE)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::wake_signal_bucket)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn backend_aggregates(&self, since: OffsetDateTime) -> Result<Vec<BackendAggregate>> {
        let fetched = sqlx::query(statements::SELECT_BACKENDS)
            .bind(since)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::backend_aggregate)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn cache_aggregates(&self, since: OffsetDateTime) -> Result<Vec<CacheAggregate>> {
        let fetched = sqlx::query(statements::SELECT_CACHE)
            .bind(since)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::cache_aggregate)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn route_aggregates(&self, since: OffsetDateTime) -> Result<Vec<RouteAggregate>> {
        let fetched = sqlx::query(statements::SELECT_ROUTES)
            .bind(since)
            .bind(SERVER_ERROR_STATUS_CLASS)
            .fetch_all(&self.pool)
            .await?;
        Ok(fetched
            .iter()
            .map(rows::route_aggregate)
            .collect::<std::result::Result<Vec<_>, sqlx::Error>>()?)
    }

    async fn oldest_bucket_start(&self) -> Result<Option<OffsetDateTime>> {
        let row = sqlx::query(statements::SELECT_OLDEST_BUCKET)
            .fetch_one(&self.pool)
            .await?;
        Ok(sqlx::Row::try_get(&row, "oldest_bucket_start")?)
    }

    async fn delete_before(&self, cutoff: OffsetDateTime) -> Result<u64> {
        let mut deleted = 0;
        for statement in statements::PRUNE_STATEMENTS {
            deleted += sqlx::query(statement)
                .bind(cutoff)
                .execute(&self.pool)
                .await?
                .rows_affected();
        }
        Ok(deleted)
    }
}
