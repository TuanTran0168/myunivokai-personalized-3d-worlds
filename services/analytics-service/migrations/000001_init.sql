-- +goose Up
-- The analytics read model. Three tables and no more.
--
-- There is deliberately NO outbox_messages table here: analytics-service
-- consumes events, writes this database and answers queries — it publishes
-- nothing and calls no other service. A reviewer who finds an outbox in this
-- schema should treat it as a design violation, not an omission. See
-- notes/plans/services/analytics-service-plan.md#analytics-schema.

-- world_projections is a second copy of production data, so its columns are
-- an allow list rather than a mirror: no raw input, no generated profile, no
-- quote, no scene config, no share slug. `nickname` is the only user-entered
-- value and is here so an admin table has a human label.
CREATE TABLE world_projections (
  world_id UUID PRIMARY KEY,
  family TEXT NOT NULL,
  profile_id UUID NOT NULL,
  dna_version_id UUID NOT NULL,
  source_job_id TEXT NOT NULL,
  -- revision is what makes the upsert safe under JetStream's duplicate and
  -- out-of-order delivery: a projection only moves forward.
  revision INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  archetype TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  mood TEXT NOT NULL,
  world_style TEXT NOT NULL,
  favorite_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  trait_creativity INTEGER NOT NULL DEFAULT 0,
  trait_discipline INTEGER NOT NULL DEFAULT 0,
  trait_curiosity INTEGER NOT NULL DEFAULT 0,
  trait_energy INTEGER NOT NULL DEFAULT 0,
  trait_focus INTEGER NOT NULL DEFAULT 0,
  variant_count INTEGER NOT NULL DEFAULT 1,
  selected_variant_no INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  world_created_at TIMESTAMPTZ NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- job_projections is what makes failure rate and end-to-end duration
-- answerable in one query. created_at and completed_at come from envelope
-- timestamps stamped by the publishing service, never from a clock here —
-- a job spans three services and only the envelope is common to all of them.
CREATE TABLE job_projections (
  job_id TEXT PRIMARY KEY,
  family TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  world_id UUID,
  profile_id UUID,
  dna_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Copied verbatim from the family migrations. JetStream guarantees duplicate
-- delivery; this is what makes it a non-event.
CREATE TABLE inbox_messages (
  message_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  job_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One composite index per (filter, keyset) pair the query layer actually
-- issues. Pagination is keyset, never OFFSET, so every page after the first
-- costs the same as the first — which is the whole reason the list queries
-- can stay inside the 2500ms request/reply deadline as the table grows.
CREATE INDEX idx_world_projections_keyset ON world_projections(world_created_at DESC, world_id DESC);
CREATE INDEX idx_world_projections_family_keyset ON world_projections(family, world_created_at DESC, world_id DESC);
CREATE INDEX idx_world_projections_published_keyset ON world_projections(world_created_at DESC, world_id DESC) WHERE is_published;
CREATE INDEX idx_world_projections_archetype ON world_projections(archetype);
CREATE INDEX idx_world_projections_world_style ON world_projections(world_style);
CREATE INDEX idx_world_projections_mood ON world_projections(mood);

CREATE INDEX idx_job_projections_keyset ON job_projections(created_at DESC, job_id DESC);
CREATE INDEX idx_job_projections_status_keyset ON job_projections(status, created_at DESC, job_id DESC);
CREATE INDEX idx_job_projections_family_keyset ON job_projections(family, created_at DESC, job_id DESC);
CREATE INDEX idx_job_projections_error_code ON job_projections(error_code) WHERE error_code <> '';

-- +goose Down
DROP TABLE IF EXISTS inbox_messages;
DROP TABLE IF EXISTS job_projections;
DROP TABLE IF EXISTS world_projections;
