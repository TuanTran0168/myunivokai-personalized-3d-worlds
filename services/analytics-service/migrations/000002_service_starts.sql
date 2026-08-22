-- +goose Up
-- service_starts is the one table in this database that is NOT a projection.
--
-- Every other table here is derived: world_projections and job_projections
-- mirror rows that also exist in a family or dna database, so this database
-- can in principle be dropped and rebuilt from the event stream. These rows
-- cannot. A process announcing its own start is a primary observation that
-- exists nowhere else, and once the stream's retention window passes there is
-- nothing to replay it from.
--
-- Anyone writing a "drop and rebuild analytics" runbook must exclude this
-- table. It is recorded here rather than in a separate store because the
-- admin console is the one place these are read, and a second database for a
-- few dozen rows a day would cost more than it explains.
CREATE TABLE service_starts (
  -- Generated per boot by the starting process, so it is unique across every
  -- service without coordination. It is also what distinguishes one process
  -- running for a week from seven crash-restarts.
  instance_id   TEXT PRIMARY KEY,
  service       TEXT        NOT NULL,
  version       TEXT        NOT NULL DEFAULT 'unknown',
  boot_duration_ms INTEGER  NOT NULL DEFAULT 0,
  -- From the envelope the publisher stamped, never a clock here: the row is
  -- written whenever analytics happens to be awake, which on a scale-to-zero
  -- host can be hours after the start it describes.
  started_at    TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matches the only two queries: newest-first across everything, and
-- newest-first for one service. Keyset on (started_at, instance_id) like
-- every other list in this database.
CREATE INDEX service_starts_keyset_idx
  ON service_starts (started_at DESC, instance_id DESC);
CREATE INDEX service_starts_by_service_idx
  ON service_starts (service, started_at DESC, instance_id DESC);

-- +goose Down
DROP INDEX service_starts_by_service_idx;
DROP INDEX service_starts_keyset_idx;
DROP TABLE service_starts;
