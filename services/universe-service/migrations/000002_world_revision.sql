-- +goose Up
-- Every mutation to a world bumps `revision` in the same transaction that
-- performs the mutation. It does two jobs that are otherwise both awkward:
--
--   1. Outbox message-id uniqueness. The existing convention is
--      `<jobID>:<stage>`, but mutations have no job id and repeat. Naming a
--      message `<world_id>:variant-selected:<variant_id>` breaks on a real
--      sequence — select A, select B, select A again: the third insert
--      collides with the first, ON CONFLICT DO NOTHING drops it, and the
--      analytics read model is left showing B. `<world_id>:rev:<n>` cannot
--      collide.
--
--   2. Conflict resolution in the projection. `UPDATE ... WHERE revision <
--      excluded.revision` is correct under JetStream reorderings; comparing
--      wall-clock timestamps written by two different services is not.
--
-- ADD COLUMN with a non-volatile DEFAULT is metadata-only on PostgreSQL 11+,
-- so this does not rewrite the table on an already-deployed database.
-- See notes/vision/analytics-service-plan.md#design-decision-a-revision-column-on-worlds.
ALTER TABLE worlds ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE worlds DROP COLUMN IF EXISTS revision;
