-- +goose Up
-- Ownership arrives as two nullable columns and rewrites no existing row.
--
-- Nullable on purpose, twice over: every world in production today was made
-- anonymously and must stay valid, and anonymous creation is not being removed
-- — it is the product's entire first impression. There is deliberately no
-- backfill either: a world made before this migration is anonymous and
-- unclaimable for ever, because nobody can prove they made it.
--
-- No REFERENCES clause, and not by omission: accounts live in another database
-- on another host, so the foreign key cannot exist. The Ed25519 signature the
-- gateway verified before it put this id on the command is the existence
-- proof.
--
-- ADD COLUMN with no default is metadata-only on PostgreSQL 11+, so this does
-- not rewrite the table on an already-deployed database.
-- See agent-system/plans/architecture/end-user-identity-and-ownership.md#62-schema--the-three-family-services.
ALTER TABLE worlds ADD COLUMN owner_account_id UUID;

-- WHICH anonymous visitor made this world, cleared when they claim it.
-- `owner_account_id IS NULL` already answers "is this world anonymous?" — this
-- column answers a question nothing else in the schema can, and two promises
-- depend on it. The daily quota counts against it, because before login there
-- is no other per-visitor handle. And the claim is provable by it, because a
-- world id travels in a share URL and so proves nothing about who made it.
ALTER TABLE worlds ADD COLUMN anonymous_id UUID;

-- Both indexes are partial, because both columns are NULL on every row that
-- exists today and on every world made without signing in afterwards.
CREATE INDEX idx_worlds_owner_account_id ON worlds (owner_account_id)
  WHERE owner_account_id IS NOT NULL;

-- The claim's own WHERE clause, in the order it reads it: the unclaimed worlds
-- belonging to one visitor.
CREATE INDEX idx_worlds_anonymous_id ON worlds (anonymous_id)
  WHERE anonymous_id IS NOT NULL AND owner_account_id IS NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_worlds_anonymous_id;
DROP INDEX IF EXISTS idx_worlds_owner_account_id;
ALTER TABLE worlds DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE worlds DROP COLUMN IF EXISTS owner_account_id;
