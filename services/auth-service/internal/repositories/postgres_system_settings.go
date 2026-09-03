package repositories

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// ListSystemSettings returns every row, ORPHANS INCLUDED — a row whose key has
// since left contracts.DeclaredSettings comes back like any other. §9.3 leaves
// such a row in place rather than deleting it, deliberately unlike
// SyncPermissions' `DELETE FROM permissions WHERE NOT (codename = ANY($1))`, so
// the settings screen can show it as unknown and removing it stays somebody's
// decision. Filtering it out here would make that decision quietly for them.
//
// Ordered by key so the screen's grouping is stable across reads; the registry
// decides the order of DECLARED settings, and this ordering is what puts the
// orphans somewhere predictable.
func (store *PostgresStore) ListSystemSettings(ctx context.Context) ([]SystemSetting, error) {
	rows, err := store.pool.Query(ctx, `SELECT setting_key, setting_value, updated_by_account_id::text, updated_at
		FROM system_settings ORDER BY setting_key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	settings := make([]SystemSetting, 0)
	for rows.Next() {
		var setting SystemSetting
		var settingKey string
		if err := rows.Scan(&settingKey, &setting.Value, &setting.UpdatedByAccountID, &setting.UpdatedAt); err != nil {
			return nil, err
		}
		setting.Key = contracts.SettingKey(settingKey)
		settings = append(settings, setting)
	}
	return settings, rows.Err()
}

// GetSystemSetting returns ErrNotFound when no row overrides the key, which is
// the normal case rather than a failure: every setting has a compiled-in
// default and a fresh environment has no rows at all.
func (store *PostgresStore) GetSystemSetting(ctx context.Context, key contracts.SettingKey) (SystemSetting, error) {
	var setting SystemSetting
	var settingKey string
	err := store.pool.QueryRow(ctx, `SELECT setting_key, setting_value, updated_by_account_id::text, updated_at
		FROM system_settings WHERE setting_key = $1`, string(key),
	).Scan(&settingKey, &setting.Value, &setting.UpdatedByAccountID, &setting.UpdatedAt)
	if err != nil {
		return SystemSetting{}, mapNotFound(err)
	}
	setting.Key = contracts.SettingKey(settingKey)
	return setting, nil
}

// UpsertSystemSetting writes one row and reports the value it replaced, which
// is the "from" half of the audit line `<key>: <old> -> <new>`. An empty
// previousValue with no error means there was no row, so the value being
// replaced is the compiled-in default — the caller names it, because only the
// service layer knows the registry.
//
// Two statements in a transaction rather than one clever one. `RETURNING`
// hands back the row as it now IS, and the ways to get the prior value in a
// single statement — a subquery inside RETURNING, or `RETURNING OLD.*`, which
// needs a Postgres version this repository cannot check — are semantics no test
// here could verify: there is no Postgres in CI, so SQL that is only probably
// right is SQL that ships wrong.
//
// The one thing this ordering does not close: two staff members changing the
// same setting in the same instant can both read the same prior value, so one
// audit row would say it replaced a value the other had already replaced. The
// stored value is still correct — last write wins and both audit rows name the
// value they wrote — and the alternative is locking machinery for a collision
// between two people on one form.
func (store *PostgresStore) UpsertSystemSetting(ctx context.Context, key contracts.SettingKey, value, actorAccountID string) (previousValue string, err error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer transaction.Rollback(ctx)

	err = transaction.QueryRow(ctx, `SELECT setting_value FROM system_settings WHERE setting_key = $1`, string(key)).Scan(&previousValue)
	if err != nil {
		if mapNotFound(err) != ErrNotFound {
			return "", err
		}
		previousValue = ""
	}

	if _, err := transaction.Exec(ctx, `INSERT INTO system_settings (setting_key, setting_value, updated_by_account_id, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (setting_key) DO UPDATE SET
			setting_value = EXCLUDED.setting_value,
			updated_by_account_id = EXCLUDED.updated_by_account_id,
			updated_at = NOW()`, string(key), value, actorAccountID); err != nil {
		return "", mapConstraintViolation(err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return "", err
	}
	return previousValue, nil
}
