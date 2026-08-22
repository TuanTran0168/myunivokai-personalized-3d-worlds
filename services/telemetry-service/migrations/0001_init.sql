-- myunivokai_telemetry, owned entirely by telemetry-service.
--
-- Plain SQL run by sqlx::migrate!, same spirit as the goose migrations every
-- Go service here uses: a file per change, applied in order, never edited once
-- it has run anywhere.
--
-- Every rollup table below is an ACCUMULATOR, not a projection. A row is the
-- sum of every envelope that reported that bucket, which is why each upsert
-- adds rather than assigns: two gateway instances flushing the same minute are
-- two facts about that minute, and the read model has to hold their total.
-- Idempotency is inbox_messages' job, not the primary key's.

-- histogram is BIGINT[] rather than the JSONB the design sketch named. The one
-- operation this column exists for is being added to another histogram, and
-- Postgres can add two arrays elementwise inside ON CONFLICT with no helper
-- function, no read-modify-write and no lost update under concurrent writers.
-- JSONB would have needed all three. The width is fixed at 8 by the contract
-- (contracts/go/contracts_telemetry_rollup.go); a CHECK enforces it here so a
-- mismatched writer fails on the row rather than on a later percentile.

CREATE TABLE http_rollups (
  bucket_start    TIMESTAMPTZ NOT NULL,
  route_pattern   TEXT        NOT NULL,
  method          TEXT        NOT NULL,
  status_class    SMALLINT    NOT NULL,
  request_count   BIGINT      NOT NULL,
  duration_sum_ms BIGINT      NOT NULL,
  duration_max_ms BIGINT      NOT NULL,
  histogram       BIGINT[]    NOT NULL,
  PRIMARY KEY (bucket_start, route_pattern, method, status_class),
  CONSTRAINT http_rollups_histogram_width CHECK (array_length(histogram, 1) = 8)
);

-- Every read in this schema is "the last N hours", so the only index that
-- earns its write cost is the one on time, descending.
CREATE INDEX http_rollups_recent_idx ON http_rollups (bucket_start DESC);

-- error_code_rollups is flattened out of the HTTP buckets' errorCodes map. It
-- is separate rather than a column because the codes are open-ended - a new
-- one appears whenever the gateway declares one - and a column per code would
-- make that a migration.
--
-- This table is what makes the SERVICE_WAKING -> success conversion rate
-- answerable, which platform-evolution-research.md names as the only real
-- proof the wake mechanism works in production rather than in a local harness.
CREATE TABLE error_code_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  error_code   TEXT        NOT NULL,
  count        BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, error_code)
);

CREATE INDEX error_code_rollups_recent_idx ON error_code_rollups (bucket_start DESC);

-- nats_rollups answers "which backend is actually slow", which the HTTP route
-- alone cannot: a request under /api/{family}/worlds reaches universe or
-- nature depending on the family, and both wear the same route template.
CREATE TABLE nats_rollups (
  bucket_start    TIMESTAMPTZ NOT NULL,
  service         TEXT        NOT NULL,
  request_count   BIGINT      NOT NULL,
  duration_sum_ms BIGINT      NOT NULL,
  duration_max_ms BIGINT      NOT NULL,
  histogram       BIGINT[]    NOT NULL,
  error_count     BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, service),
  CONSTRAINT nats_rollups_histogram_width CHECK (array_length(histogram, 1) = 8)
);

CREATE INDEX nats_rollups_recent_idx ON nats_rollups (bucket_start DESC);

-- cache_rollups answers whether the three Redis namespaces (job:v1, world:v1,
-- share:v1) are earning their keep. Their existence is documented in
-- README.md; their hit rate has never been measured.
CREATE TABLE cache_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  namespace    TEXT        NOT NULL,
  hits         BIGINT      NOT NULL,
  misses       BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, namespace)
);

CREATE INDEX cache_rollups_recent_idx ON cache_rollups (bucket_start DESC);

-- Same idempotency shape as analytics-service's inbox table. message_id is
-- {instance, bucket start}, which is what makes a redelivery a no-op while
-- still letting two instances both report the same minute: they carry
-- different instance ids, so they are two rows here and two additions above.
CREATE TABLE inbox_messages (
  message_id   TEXT PRIMARY KEY,
  subject      TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The inbox grows one row per interval per instance forever unless it is
-- pruned with everything else, so it gets the same time index the rollups do.
CREATE INDEX inbox_messages_processed_at_idx ON inbox_messages (processed_at DESC);
