-- +goose Up
-- The operator-changeable policy numbers: a quota ceiling, a token lifetime, a
-- lockout window. §9.3 of
-- agent-system/plans/architecture/end-user-identity-and-ownership.md is the
-- argument for the table existing at all — `.env` was absorbing product
-- behaviour, and two more variables in a 105-line file is a hiding place
-- rather than a config change.
--
-- Every row here is an OVERRIDE. The default is a named constant in
-- contracts.DeclaredSettings, and the platform must boot and behave correctly
-- against this table empty and Redis flushed — which is why nothing reads a
-- row expecting to find one. A setting whose only copy is a database row is a
-- required piece of database content with nothing declaring it, strictly worse
-- than the environment variable it replaced.
--
-- Four columns, and the absent fifth is deliberate: there is no `created_at`,
-- because the question this table is asked is always "what is the value now
-- and who set it", never "when did this key first acquire a row". The audit
-- log holds the history — one `setting_update` row per change, with the old
-- and new values — so a second timeline here would be a copy that can
-- disagree.
--
-- There is also no CHECK on the key format, even though one is expressible.
-- The scheme lives in contracts.settingKeyPattern and is enforced on every
-- write; a CHECK would be a second place to remember it, and the repository
-- already carries two of those for the world families
-- (agent-system/memory records them as the pair a new family must not forget).
-- One enforcement point, in the language that also owns the type and the
-- bounds.
CREATE TABLE system_settings (
  -- The dotted key from contracts.SettingKey — `auth.lockout.duration`, never
  -- `AUTH_LOCKOUT_DURATION`. A dot is not a legal character in a shell
  -- identifier, so a key in this column can never be mistaken for an
  -- environment variable and cannot become one by a typo, which matters
  -- because for five of the nine settings both forms exist at once on purpose.
  setting_key TEXT PRIMARY KEY,

  -- TEXT for every type. The declared type in Go decides how this is parsed,
  -- and holding an int in one column and a duration in another would make the
  -- registry's type the second opinion instead of the only one. Bounds are
  -- code: a value that no longer satisfies its declaration is ignored in
  -- favour of the default rather than trusted because it is in a database.
  setting_value TEXT NOT NULL,

  -- Who changed it last. Nullable, and ON DELETE SET NULL rather than the
  -- CASCADE account_profiles uses: a profile belongs to an account and dies
  -- with it, while a policy number belongs to the platform. Cascading here
  -- would let removing a staff account silently revert the platform's quota to
  -- its default. Decision 9 makes "deleting an account" mean disabling it, so
  -- this fires almost never — but the direction it fires in is the difference
  -- between losing an attribution and losing a policy.
  updated_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS system_settings;
