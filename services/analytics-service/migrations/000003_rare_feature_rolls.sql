-- +goose Up
-- What this migration makes answerable: "the black hole is tuned to 40% — how
-- often does it ACTUALLY come up, and which worlds got one?"
--
-- Neither half of that question had an answer before. A rare feature is never
-- stored: the renderer re-derives it on every draw from the selected variant's
-- seed, and that seed had no column here at all. Reading 40% back out of the
-- config would answer a different question — what the generator was aimed at,
-- not what it hit.

-- The seed itself, added to the projection's allow list. It is a generated
-- base32 identifier this platform minted, not anything a person typed, so it
-- widens the data boundary by a machine value and no user content — see
-- notes/plans/services/analytics-service-plan.md#data-boundary.
--
-- DEFAULT '' rather than NULL: a world projected before this shipped has no
-- seed, and empty is the honest reading of "we cannot replay this one". The
-- rarity panel counts those separately instead of hiding them in a denominator.
ALTER TABLE world_projections ADD COLUMN variant_seed TEXT NOT NULL DEFAULT '';

-- One row per (world, lottery it entered). A side table rather than columns on
-- world_projections because the number of lotteries is a product decision that
-- will keep changing, and because it turns the whole rarity panel into a single
-- GROUP BY joined against the catalogue instead of SQL generated per feature.
--
-- What is stored is the RAW DRAW, not "did it hit". A draw depends only on the
-- seed and stays true forever; whether it hit depends on a probability that
-- gets re-tuned. Storing the draw means re-tuning the black hole from 40% to
-- 20% re-derives the whole of history on the next query rather than stranding
-- every row already written.
CREATE TABLE world_rare_rolls (
  -- ON DELETE CASCADE: these rows are meaningless without their world, and
  -- world_projections is the only thing that ever creates them.
  world_id    UUID NOT NULL REFERENCES world_projections(world_id) ON DELETE CASCADE,
  -- A key from contracts.RarityCatalogue. Deliberately not an enum: adding a
  -- rare feature is a frontend product change, and a database type that had to
  -- move with it would make a migration the price of a new species.
  feature_key TEXT NOT NULL,
  roll        DOUBLE PRECISION NOT NULL,
  -- The second draw, for features that pick a variety. NULL for the ones that
  -- do not have varieties — not 0, which is a legitimate draw that would
  -- select the first species.
  species_roll DOUBLE PRECISION,
  PRIMARY KEY (world_id, feature_key)
);

-- The panel's own query: every world's roll for one feature, filtered by the
-- family and window on world_projections. Leading with feature_key because the
-- aggregate groups by it and the drill-through filters on it; world_id is the
-- join key and comes second.
CREATE INDEX world_rare_rolls_by_feature_idx ON world_rare_rolls (feature_key, roll);

-- +goose Down
DROP INDEX world_rare_rolls_by_feature_idx;
DROP TABLE world_rare_rolls;
ALTER TABLE world_projections DROP COLUMN variant_seed;
