-- +goose Up
-- Every variant a world has, not only the selected one.
--
-- What this makes answerable: "which variants does this world hold, and what
-- seed was each drawn from?" Neither half had an answer here — the projection
-- carried a COUNT and the SELECTED variant's seed, so a staff member looking at
-- a world could see that it had four variants and nothing about three of them.
--
-- It exists because `variant:read` exists. That codename has been declared and
-- grantable since S4-AUTH-005 with no route behind it, and a route cannot be
-- built on a read model that does not hold the data: principle 10 forbids an
-- admin read reaching a family service, which is the whole reason this service
-- exists.
--
-- A JSONB column on the projection row rather than a table of its own,
-- following favorite_colors: a world holds a handful of variants, they are only
-- ever read together with their world, and nothing joins or filters on one. A
-- 1:N table would buy a foreign key and cost a join on the one screen that
-- reads it.
--
-- Three fields per variant and no fourth. What is NOT here is
-- world_variants.config: it is large, it is derived from the DNA that
-- deliberately stays on the other side of the boundary, and no admin screen has
-- a question it answers. The seeds are the point — contracts_rarity replays the
-- rare-feature lottery from a seed, so "did this world really roll a black
-- hole" becomes checkable rather than believable.
--
-- Defaults to an empty array rather than NULL, so a projection written before
-- this column existed reads as "no variants recorded" rather than failing a
-- scan. Every such row is refilled by the next world.changed event that world
-- produces.
ALTER TABLE world_projections
  ADD COLUMN variants JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE world_projections DROP COLUMN variants;
