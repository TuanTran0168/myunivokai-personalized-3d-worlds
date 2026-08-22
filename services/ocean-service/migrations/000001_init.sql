-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_job_id TEXT NOT NULL UNIQUE,
  profile_id UUID NOT NULL,
  dna_version_id UUID NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT,
  visual_intent JSONB NOT NULL,
  dna_snapshot JSONB NOT NULL,
  archetype TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  quote TEXT NOT NULL,
  selected_variant_id UUID,
  -- revision ships in the FIRST migration here, unlike universe-service and
  -- nature-service, which added it later as 000002 once analytics-service
  -- existed. It does two jobs:
  --
  --   1. Outbox message-id uniqueness. Mutations have no job id and repeat, so
  --      `<world_id>:variant-selected:<variant_id>` breaks on select A, select
  --      B, select A again — the third insert collides with the first and the
  --      read model is left showing B. `<world_id>:rev:<n>` cannot collide.
  --   2. Conflict resolution in the projection. `UPDATE ... WHERE revision <
  --      excluded.revision` is correct under JetStream reorderings; comparing
  --      wall-clock timestamps written by two different services is not.
  --
  -- See notes/vision/analytics-service-plan.md#design-decision-a-revision-column-on-worlds.
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE world_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  variant_no INTEGER NOT NULL,
  seed TEXT NOT NULL,
  config JSONB NOT NULL,
  thumbnail_url TEXT,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(world_id, variant_no),
  UNIQUE(world_id, seed)
);

ALTER TABLE worlds
  ADD CONSTRAINT worlds_selected_variant_fk
  FOREIGN KEY (selected_variant_id) REFERENCES world_variants(id) ON DELETE SET NULL;

CREATE TABLE world_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL UNIQUE REFERENCES worlds(id) ON DELETE CASCADE,
  share_slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inbox_messages (
  message_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  job_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX idx_worlds_profile_id ON worlds(profile_id);
CREATE INDEX idx_worlds_created_at ON worlds(created_at DESC);
CREATE INDEX idx_world_variants_world_id ON world_variants(world_id);
CREATE INDEX idx_world_shares_share_slug ON world_shares(share_slug);
CREATE INDEX idx_outbox_messages_pending ON outbox_messages(created_at) WHERE published_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS outbox_messages;
DROP TABLE IF EXISTS inbox_messages;
DROP TABLE IF EXISTS world_shares;
ALTER TABLE worlds DROP CONSTRAINT IF EXISTS worlds_selected_variant_fk;
DROP TABLE IF EXISTS world_variants;
DROP TABLE IF EXISTS worlds;
