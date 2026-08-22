-- +goose Up
-- Accounts had no display name — only email, which doubles as the sign-in
-- identifier. Optional and blank by default: existing rows and every
-- invite/create path that predates this column stay valid with no backfill.
ALTER TABLE accounts ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE accounts DROP COLUMN IF EXISTS name;
