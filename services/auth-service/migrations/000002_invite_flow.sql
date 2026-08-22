-- +goose Up
-- Invited accounts have no password until they accept: password_hash must
-- become nullable, guarded by a constraint so a row can never end up with
-- neither a password nor a live invite - see
-- notes/sprints/sprint-04-2026-08-06/user-stories.md S4-AUTH-005.
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE accounts ADD COLUMN invited_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN invite_token_hash TEXT;
ALTER TABLE accounts ADD COLUMN invite_expires_at TIMESTAMPTZ;
ALTER TABLE accounts ADD CONSTRAINT accounts_password_or_invite_chk
  CHECK (password_hash IS NOT NULL OR (invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL));
CREATE UNIQUE INDEX idx_accounts_invite_token_hash ON accounts (invite_token_hash) WHERE invite_token_hash IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_accounts_invite_token_hash;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_password_or_invite_chk;
ALTER TABLE accounts DROP COLUMN IF EXISTS invite_expires_at;
ALTER TABLE accounts DROP COLUMN IF EXISTS invite_token_hash;
ALTER TABLE accounts DROP COLUMN IF EXISTS invited_at;
ALTER TABLE accounts ALTER COLUMN password_hash SET NOT NULL;
