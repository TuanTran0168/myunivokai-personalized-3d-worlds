-- +goose Up
-- The account's own page: who they are, and the defaults the create-world
-- form is filled from.
--
-- One row per account, created on first save rather than at signup, so an
-- account that never opens the page costs no row. Reads answer with an empty
-- profile when the row is absent — see AccountProfile in
-- internal/services/account_profile_service.go for why that is not a 404.
--
-- ON DELETE CASCADE because a profile is not a fact about the world, it is
-- display data belonging to one account. Decision 9 makes "deleting an
-- account" mean disabling it, so this cascade fires only if a row is ever
-- genuinely removed — and if that day comes, a stranded profile keyed to a
-- vanished account is not something anything would know how to read.
--
-- There is deliberately NO nickname column. The nickname the create form is
-- pre-filled with IS accounts.name: one name, in one place, so the header
-- menu and the form can never greet the same person differently. It is
-- projected into AccountProfileData.CreationDefaults.Nickname on read.
CREATE TABLE account_profiles (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

  -- Identity the person chose to record about themselves. Both blank by
  -- default and neither is verified, inferred or read to decide anything.
  full_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'female', 'male', 'non_binary', 'other', 'prefer_not_to_say')),

  -- The create-world form's fields, held as a draft. Every one is optional:
  -- a profile is saveable long before it is a complete world, which is the
  -- distinction WorldInput.ValidateAsCreationDefaults exists to draw.
  --
  -- preferred_world_family and mood carry no CHECK constraint, unlike gender.
  -- The family list grows — a fourth family is a scheduled sprint — and a
  -- CHECK here would be a third place to remember, on top of the Postgres
  -- constraint in dna-service and the JetStream consumer filter that
  -- agent-system already records as the two a new family must not forget.
  -- Both are validated in Go against the contracts vocabulary instead.
  preferred_world_family TEXT NOT NULL DEFAULT '',
  preferred_world_style TEXT NOT NULL DEFAULT '',
  primary_role TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  challenge TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',

  -- JSONB rather than TEXT[]: these three are read and written whole, never
  -- queried by element, and JSONB is what every other list in this codebase
  -- already crosses the wire as.
  interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  traits JSONB NOT NULL DEFAULT '[]'::jsonb,
  favorite_colors JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- The create page's toggle. Stored on the account rather than in one
  -- browser so it follows the person to their next device. It governs the
  -- world-preference fields only: the display name fills the Nickname field
  -- either way, because a name is not a preference to opt into.
  autofill_create_form BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS account_profiles;
