-- What browsers reported about themselves, which is the one thing the four
-- tables in 0001 cannot see.
--
-- Every one of those is measured at the gateway, so between them they answer
-- "what did the platform do" and none of them answers "what did the visitor
-- get". A phone that classified itself into the minimal tier, rendered at half
-- resolution and lost its WebGL context produces exactly the same HTTP rollup
-- as a desktop that rendered everything.
--
-- The primary key is the whole row minus the count, and the key space is closed
-- by the contract rather than by this schema's tolerance: three quality tiers,
-- the supported world families, and two outcomes. That is why there is no
-- overflow row and no cardinality index — the table cannot grow wider than
-- tiers x families x outcomes per minute, which is a couple of dozen rows an
-- hour at most.
--
-- family is TEXT with no CHECK on purpose. A new world family must not need a
-- migration in a service that never reasons about one; the closed set is
-- enforced by contracts.ClientRenderReportData.Validate at the gateway and by
-- HttpRollupData::validate here, both of which are code the new family's own
-- change already touches.
--
-- There is nothing in this table that identifies anybody. No world id, no
-- account id, no session id, no user agent. That is what lets an
-- unauthenticated browser POST into it, and it is a property of the schema
-- rather than of a redaction step somewhere upstream.
CREATE TABLE client_render_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  quality_tier SMALLINT    NOT NULL,
  family       TEXT        NOT NULL,
  outcome      TEXT        NOT NULL,
  count        BIGINT      NOT NULL,
  PRIMARY KEY (bucket_start, quality_tier, family, outcome)
);

-- Same index as the other four, for the same reason: every read here is "the
-- last N hours", so time descending is the only index that earns its write
-- cost.
CREATE INDEX client_render_rollups_recent_idx ON client_render_rollups (bucket_start DESC);
