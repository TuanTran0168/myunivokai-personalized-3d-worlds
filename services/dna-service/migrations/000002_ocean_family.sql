-- +goose Up
-- generation_jobs.family was constrained to ('universe', 'nature') in the
-- initial migration, written before the ocean family existed. contracts.go
-- has treated "ocean" as valid since WorldFamilyOcean was added, and every
-- Go layer above the database accepts it — only this CHECK never learned
-- about it, so every ocean DNA generation job fails to insert with
-- generation_jobs_family_check and the job the caller polls for was never
-- written.
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_family_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_family_check
  CHECK (family IN ('universe', 'nature', 'ocean'));

-- +goose Down
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_family_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_family_check
  CHECK (family IN ('universe', 'nature'));
