-- +goose Up
-- The same two columns the family services gain, on the row that links a
-- person to everything they made. `dna-service` needs them for two things no
-- family service can do: it is the only service that knows WHICH FAMILIES a
-- visitor used, which is what narrows the claim's fan-out to those, and it is
-- where the account's own world list is read from.
--
-- Nullable, no REFERENCES, no backfill, for the same reasons recorded in
-- services/universe-service/migrations/000003_world_ownership.sql.
ALTER TABLE profiles ADD COLUMN owner_account_id UUID;
ALTER TABLE profiles ADD COLUMN anonymous_id UUID;

CREATE INDEX idx_profiles_owner_account_id ON profiles (owner_account_id)
  WHERE owner_account_id IS NOT NULL;

-- Not in the plan's §6.3, which gives the family tables both indexes and this
-- table only the owner one. The claim's predicate is identical on both
-- (`anonymous_id = $1 AND owner_account_id IS NULL`) and `profiles` gains a row
-- for every world ever created, so leaving it out means a sequential scan over
-- the largest table in this database on every single signup.
CREATE INDEX idx_profiles_anonymous_id ON profiles (anonymous_id)
  WHERE anonymous_id IS NOT NULL AND owner_account_id IS NULL;

-- The only query the visitor-facing world list runs: newest-first keyset over
-- one profile's jobs that actually produced a world. `job_id` breaks the tie,
-- so a page boundary is stable when two jobs share a timestamp — which they
-- can, because `created_at` is written by the same statement for a retry.
CREATE INDEX idx_generation_jobs_world_keyset
  ON generation_jobs (profile_id, created_at DESC, job_id DESC)
  WHERE world_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_generation_jobs_world_keyset;
DROP INDEX IF EXISTS idx_profiles_anonymous_id;
DROP INDEX IF EXISTS idx_profiles_owner_account_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS owner_account_id;
