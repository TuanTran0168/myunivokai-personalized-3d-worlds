-- +goose Up
-- How a world was built, and the limit that decided it.
--
-- On the JOB and not on the world, which is section 9.1's rule rather than a
-- convenience: the truth is owed once, to the person who hit the limit, at the
-- moment they hit it. A column on the world would follow that world for ever
-- and be visible to the friend the share link was sent to, who hit no limit at
-- all.
--
-- Both nullable with no default and no backfill. NULL is the honest value for
-- every job that already exists, and it stays the value on every FAILED job:
-- a reason says how a world was PRODUCED, and a job with no world has none to
-- give. In Postgres a CHECK is satisfied by NULL, so neither constraint below
-- touches a row that predates them.
ALTER TABLE generation_jobs ADD COLUMN generation_reason TEXT
  CHECK (generation_reason IN ('ai_generated', 'quota_exhausted', 'mock_configured', 'ai_failed_fallback'));

-- The CHECK repeats a list that also lives in Go
-- (contracts.DeclaredGenerationReasons) and in TypeScript, and repeating it is
-- the lesser of two evils here: without it a typo in a service reaches the
-- column and the web app reads a reason it has no branch for, silently. What
-- makes the repetition safe is a ratchet rather than discipline —
-- TestTheGenerationReasonCheckAdmitsEveryDeclaredReason reads the Go
-- declaration and fails if this line does not admit every value in it. That is
-- the same trap a new world family has, where the code alone compiles and the
-- family CHECK is the thing nobody edits.

-- The limit the reason above was measured against, so the sentence the web app
-- shows names the number the platform actually enforced. Without it that
-- number is a second declaration of a settings value in TypeScript, which is
-- the mistake the settings registry was moved into `contracts` to avoid.
--
-- `>= 0` and no upper bound: quota.ai.daily_limit.anonymous declares its own
-- range in Go and a value that was legal when it was written is not made
-- illegal by a later change to those bounds. What is refused here is a
-- negative limit, which is not a tighter policy but a corrupt row.
ALTER TABLE generation_jobs ADD COLUMN daily_ai_generation_limit INTEGER
  CHECK (daily_ai_generation_limit >= 0);

-- +goose Down
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS daily_ai_generation_limit;
ALTER TABLE generation_jobs DROP COLUMN IF EXISTS generation_reason;
