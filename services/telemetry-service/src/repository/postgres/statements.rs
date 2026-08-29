//! Every SQL statement this service runs, in one file.
//!
//! They are `&'static str` constants rather than strings built at call time,
//! and the eight histogram columns come from a macro expanding to a literal
//! that `concat!` folds in at compile time. Both choices exist for the same
//! reason: a query assembled at runtime is a query a reviewer has to execute
//! in their head, and one built by `format!` is one nobody can grep for.
//!
//! # Why there is no ORM here
//!
//! This service's write path adds two arrays elementwise inside an
//! `ON CONFLICT` clause, and its read path is `SUM(...) FILTER (WHERE ...)`
//! over grouped time buckets. Neither is expressible in an ActiveRecord-style
//! API - SeaORM and Diesel would both end up calling their raw-SQL escape
//! hatch for every statement below, leaving the entity layer as decoration
//! that still has to be kept in step with the schema. `sqlx` is the
//! ecosystem's answer for exactly this case: a driver and a type-safe binder,
//! with the SQL left as SQL. See notes/knowledge/backend/rust-service-architecture.md.

/// Expands to a string literal, which is what lets `concat!` fold it into the
/// constants below at compile time.
///
/// `SUM` over a `BIGINT` column widens to `numeric` in Postgres, which this
/// service has no arbitrary-precision decimal type to receive - hence the cast
/// back on every one of them.
macro_rules! histogram_sum_columns {
    () => {
        "
    COALESCE(SUM(histogram[1]), 0)::BIGINT AS histogram_1,
    COALESCE(SUM(histogram[2]), 0)::BIGINT AS histogram_2,
    COALESCE(SUM(histogram[3]), 0)::BIGINT AS histogram_3,
    COALESCE(SUM(histogram[4]), 0)::BIGINT AS histogram_4,
    COALESCE(SUM(histogram[5]), 0)::BIGINT AS histogram_5,
    COALESCE(SUM(histogram[6]), 0)::BIGINT AS histogram_6,
    COALESCE(SUM(histogram[7]), 0)::BIGINT AS histogram_7,
    COALESCE(SUM(histogram[8]), 0)::BIGINT AS histogram_8"
    };
}

// ---------------------------------------------------------------- write path

pub const INSERT_INBOX: &str = "
INSERT INTO inbox_messages (message_id, subject)
VALUES ($1, $2)
ON CONFLICT (message_id) DO NOTHING";

/// The histogram is summed elementwise inside the conflict clause, which is
/// what makes two gateway instances reporting the same minute add up instead
/// of one overwriting the other. `duration_max_ms` takes the greater of the
/// two, because a maximum is not additive.
///
/// Every assignment reads `table.column + EXCLUDED.column` rather than plain
/// `EXCLUDED.column`. That is the difference between an accumulator and a
/// last-writer-wins projection, and getting it wrong loses data silently.
pub const UPSERT_HTTP_ROLLUP: &str = "
INSERT INTO http_rollups
    (bucket_start, route_pattern, method, status_class, request_count, duration_sum_ms, duration_max_ms, histogram)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (bucket_start, route_pattern, method, status_class) DO UPDATE SET
    request_count   = http_rollups.request_count + EXCLUDED.request_count,
    duration_sum_ms = http_rollups.duration_sum_ms + EXCLUDED.duration_sum_ms,
    duration_max_ms = GREATEST(http_rollups.duration_max_ms, EXCLUDED.duration_max_ms),
    histogram       = (
        SELECT ARRAY_AGG(pair.stored + pair.incoming ORDER BY pair.position)
        FROM UNNEST(http_rollups.histogram, EXCLUDED.histogram)
             WITH ORDINALITY AS pair(stored, incoming, position)
    )";

pub const UPSERT_ERROR_CODE_ROLLUP: &str = "
INSERT INTO error_code_rollups (bucket_start, error_code, count)
VALUES ($1, $2, $3)
ON CONFLICT (bucket_start, error_code) DO UPDATE SET
    count = error_code_rollups.count + EXCLUDED.count";

pub const UPSERT_NATS_ROLLUP: &str = "
INSERT INTO nats_rollups
    (bucket_start, service, request_count, duration_sum_ms, duration_max_ms, histogram, error_count)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (bucket_start, service) DO UPDATE SET
    request_count   = nats_rollups.request_count + EXCLUDED.request_count,
    duration_sum_ms = nats_rollups.duration_sum_ms + EXCLUDED.duration_sum_ms,
    duration_max_ms = GREATEST(nats_rollups.duration_max_ms, EXCLUDED.duration_max_ms),
    error_count     = nats_rollups.error_count + EXCLUDED.error_count,
    histogram       = (
        SELECT ARRAY_AGG(pair.stored + pair.incoming ORDER BY pair.position)
        FROM UNNEST(nats_rollups.histogram, EXCLUDED.histogram)
             WITH ORDINALITY AS pair(stored, incoming, position)
    )";

pub const UPSERT_CACHE_ROLLUP: &str = "
INSERT INTO cache_rollups (bucket_start, namespace, hits, misses)
VALUES ($1, $2, $3, $4)
ON CONFLICT (bucket_start, namespace) DO UPDATE SET
    hits   = cache_rollups.hits + EXCLUDED.hits,
    misses = cache_rollups.misses + EXCLUDED.misses";

// ----------------------------------------------------------------- read path

pub const SELECT_TOTALS: &str = concat!(
    "
SELECT
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1"
);

/// The same shape as [`SELECT_TOTALS`] over a half-open interval, which is what
/// the "versus the previous window" comparison reads.
///
/// Half-open — `>= $1 AND < $2` — so two adjacent windows partition the
/// timeline: a bucket exactly on the boundary belongs to one of them, never to
/// both. A closed upper bound here would double-count one minute in sixty and
/// make every comparison quietly optimistic.
pub const SELECT_TOTALS_BETWEEN: &str = concat!(
    "
SELECT
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $3), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1 AND bucket_start < $2"
);

/// Minute rows folded into hours by the database rather than by this process.
///
/// `date_trunc` on a `timestamptz` needs a zone to truncate in, and it is
/// stated rather than inherited: without the explicit `'UTC'` the answer would
/// depend on the session's `TimeZone` setting, so the same window would produce
/// different hour boundaries on two connections.
pub const SELECT_HOURLY_BUCKETS: &str = concat!(
    "
SELECT
    date_trunc('hour', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY 1
ORDER BY 1"
);

/// Traffic by hour of day, summed across every day in the window — "when is
/// this platform reliably busy", which the timeline cannot answer.
pub const SELECT_HOUR_OF_DAY: &str = concat!(
    "
SELECT
    EXTRACT(HOUR FROM bucket_start AT TIME ZONE 'UTC')::SMALLINT AS hour_of_day,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY 1
ORDER BY 1"
);

pub const SELECT_STATUS_MIX: &str = "
SELECT status_class, COALESCE(SUM(request_count), 0)::BIGINT AS request_count
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY status_class
ORDER BY status_class";

pub const SELECT_VOLUME_BUCKETS: &str = concat!(
    "
SELECT
    bucket_start,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY bucket_start
ORDER BY bucket_start"
);

pub const SELECT_TOP_ERROR_CODES: &str = "
SELECT error_code, COALESCE(SUM(count), 0)::BIGINT AS count
FROM error_code_rollups
WHERE bucket_start >= $1
GROUP BY error_code
ORDER BY SUM(count) DESC, error_code
LIMIT $2";

pub const SELECT_WAKE_SIGNALS: &str = "
SELECT bucket_start, COALESCE(SUM(count), 0)::BIGINT AS count
FROM error_code_rollups
WHERE bucket_start >= $1 AND error_code = $2
GROUP BY bucket_start
ORDER BY bucket_start";

pub const SELECT_BACKENDS: &str = concat!(
    "
SELECT
    service,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(error_count), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM nats_rollups
WHERE bucket_start >= $1
GROUP BY service
ORDER BY service"
);

pub const SELECT_CACHE: &str = "
SELECT
    namespace,
    COALESCE(SUM(hits), 0)::BIGINT AS hits,
    COALESCE(SUM(misses), 0)::BIGINT AS misses
FROM cache_rollups
WHERE bucket_start >= $1
GROUP BY namespace
ORDER BY namespace";

pub const SELECT_ROUTES: &str = concat!(
    "
SELECT
    route_pattern,
    method,
    COALESCE(SUM(request_count), 0)::BIGINT AS request_count,
    COALESCE(SUM(request_count) FILTER (WHERE status_class >= $2), 0)::BIGINT AS error_count,
    COALESCE(SUM(duration_sum_ms), 0)::BIGINT AS duration_sum_ms,
    COALESCE(MAX(duration_max_ms), 0)::BIGINT AS duration_max_ms,",
    histogram_sum_columns!(),
    "
FROM http_rollups
WHERE bucket_start >= $1
GROUP BY route_pattern, method
ORDER BY SUM(request_count) DESC, route_pattern, method"
);

pub const SELECT_OLDEST_BUCKET: &str =
    "SELECT MIN(bucket_start) AS oldest_bucket_start FROM http_rollups";

// ------------------------------------------------------------------ deletion

/// Retention is a delete, not a policy document. The inbox is pruned by the
/// same cutoff: its rows are only useful for as long as JetStream could still
/// redeliver the envelope they describe, which is far shorter than the rollup
/// retention.
pub const PRUNE_STATEMENTS: [&str; 5] = [
    "DELETE FROM http_rollups WHERE bucket_start < $1",
    "DELETE FROM error_code_rollups WHERE bucket_start < $1",
    "DELETE FROM nats_rollups WHERE bucket_start < $1",
    "DELETE FROM cache_rollups WHERE bucket_start < $1",
    "DELETE FROM inbox_messages WHERE processed_at < $1",
];

#[cfg(test)]
mod tests {
    use super::*;

    const AGGREGATE_STATEMENTS: [&str; 11] = [
        SELECT_TOTALS,
        SELECT_TOTALS_BETWEEN,
        SELECT_STATUS_MIX,
        SELECT_VOLUME_BUCKETS,
        SELECT_HOURLY_BUCKETS,
        SELECT_HOUR_OF_DAY,
        SELECT_TOP_ERROR_CODES,
        SELECT_WAKE_SIGNALS,
        SELECT_BACKENDS,
        SELECT_CACHE,
        SELECT_ROUTES,
    ];

    // An uncast SUM arrives as `numeric`, which nothing in this service can
    // decode - and it fails at runtime on the first non-empty window rather
    // than at startup.
    #[test]
    fn every_selected_sum_is_cast_back_to_a_type_this_service_can_decode() {
        for statement in AGGREGATE_STATEMENTS {
            for fragment in statement.split("SUM(").skip(1) {
                // An ORDER BY may name a bare SUM(...); only the selected ones
                // have to be cast.
                let trimmed = fragment.trim_start();
                if trimmed.starts_with("count) DESC") || trimmed.starts_with("request_count) DESC")
                {
                    continue;
                }
                assert!(
                    fragment.contains("::BIGINT"),
                    "an uncast SUM would arrive as numeric:\n{statement}"
                );
            }
        }
    }

    #[test]
    fn every_histogram_query_sums_all_eight_buckets() {
        for statement in [
            SELECT_TOTALS,
            SELECT_TOTALS_BETWEEN,
            SELECT_VOLUME_BUCKETS,
            SELECT_HOURLY_BUCKETS,
            SELECT_HOUR_OF_DAY,
            SELECT_BACKENDS,
            SELECT_ROUTES,
        ] {
            for index in 1..=8 {
                assert!(
                    statement.contains(&format!("AS histogram_{index}")),
                    "histogram_{index} missing from:\n{statement}"
                );
            }
        }
    }

    // Two instances reporting the same minute are two facts. A conflict clause
    // that assigned instead of adding would silently lose one of them.
    #[test]
    fn every_conflict_clause_accumulates_rather_than_overwrites() {
        assert!(UPSERT_HTTP_ROLLUP.contains("http_rollups.request_count + EXCLUDED.request_count"));
        assert!(UPSERT_HTTP_ROLLUP.contains("GREATEST(http_rollups.duration_max_ms"));
        assert!(UPSERT_HTTP_ROLLUP.contains("pair.stored + pair.incoming"));
        assert!(UPSERT_NATS_ROLLUP.contains("nats_rollups.error_count + EXCLUDED.error_count"));
        assert!(UPSERT_NATS_ROLLUP.contains("pair.stored + pair.incoming"));
        assert!(UPSERT_CACHE_ROLLUP.contains("cache_rollups.hits + EXCLUDED.hits"));
        assert!(UPSERT_ERROR_CODE_ROLLUP.contains("error_code_rollups.count + EXCLUDED.count"));
    }

    // A time bucket truncated in the session's timezone puts the same minute in
    // a different hour on two connections, which shows up as a peak hour that
    // moves for no reason.
    #[test]
    fn every_hour_grouping_states_the_zone_it_truncates_in() {
        for statement in [SELECT_HOURLY_BUCKETS, SELECT_HOUR_OF_DAY] {
            assert!(
                statement.contains("AT TIME ZONE 'UTC'"),
                "an hour grouping that inherits the session zone:\n{statement}"
            );
        }
    }

    // Adjacent windows must partition the timeline. A closed upper bound counts
    // the boundary minute in both, which makes every comparison optimistic by
    // exactly one bucket.
    #[test]
    fn the_comparison_window_is_half_open() {
        assert!(SELECT_TOTALS_BETWEEN.contains("bucket_start >= $1 AND bucket_start < $2"));
    }

    #[test]
    fn the_inbox_insert_reports_a_redelivery_instead_of_failing_the_transaction() {
        assert!(INSERT_INBOX.contains("ON CONFLICT (message_id) DO NOTHING"));
    }

    // The inbox grows one row per interval per instance forever. It is the
    // table that grows fastest of the five, and the easiest to forget.
    #[test]
    fn retention_covers_every_table_including_the_inbox() {
        let statements = PRUNE_STATEMENTS.join(" ");
        for table in [
            "http_rollups",
            "error_code_rollups",
            "nats_rollups",
            "cache_rollups",
            "inbox_messages",
        ] {
            assert!(
                statements.contains(table),
                "{table} is never pruned and grows without bound"
            );
        }
    }
}
