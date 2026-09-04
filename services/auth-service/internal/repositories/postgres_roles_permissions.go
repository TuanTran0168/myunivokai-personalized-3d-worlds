package repositories

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// SyncPermissions makes the permissions table a projection of code, exactly
// as Django's Permission rows are generated from migrations. Unknown rows
// (declared in a past version, removed since) are pruned so the table never
// grants something no route checks - see
// agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
func (store *PostgresStore) SyncPermissions(ctx context.Context, definitions []PermissionDefinition) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	knownCodenames := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		knownCodenames = append(knownCodenames, string(definition.Codename))
		if _, err := transaction.Exec(ctx, `INSERT INTO permissions (codename, description, audience, is_system)
				VALUES ($1,$2,$3,TRUE)
			ON CONFLICT (codename) DO UPDATE SET description = EXCLUDED.description, audience = EXCLUDED.audience`,
			string(definition.Codename), definition.Description, string(definition.Audience),
		); err != nil {
			return err
		}
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM permissions WHERE NOT (codename = ANY($1::text[]))`, knownCodenames); err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

// EnsureSystemRole creates or updates a system-owned role (is_system = TRUE)
// with exactly the given permission set. Called at startup for basic_user;
// safe to call every time the process boots because it is idempotent.
func (store *PostgresStore) EnsureSystemRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) error {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	var roleID string
	err = transaction.QueryRow(ctx, `INSERT INTO roles (name, description, audience, is_system)
			VALUES ($1,$2,$3,TRUE)
		ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
		RETURNING id::text`, name, description, string(audience)).Scan(&roleID)
	if err != nil {
		return err
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, codename := range permissionCodenames {
		if _, err := transaction.Exec(ctx, `INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, id FROM permissions WHERE codename = $2`, roleID, codename); err != nil {
			return err
		}
	}
	return transaction.Commit(ctx)
}

const selectRoleColumns = `r.id::text, r.name, r.description, r.audience, r.is_system,
		COALESCE(array_agg(p.codename ORDER BY p.codename) FILTER (WHERE p.codename IS NOT NULL), '{}')
	FROM roles r
	LEFT JOIN role_permissions rp ON rp.role_id = r.id
	LEFT JOIN permissions p ON p.id = rp.permission_id`

func scanRole(row interface {
	Scan(dest ...any) error
}) (Role, error) {
	var role Role
	var description *string
	var audience string
	var permissionCodenames []string
	if err := row.Scan(&role.ID, &role.Name, &description, &audience, &role.IsSystem, &permissionCodenames); err != nil {
		return Role{}, mapNotFound(err)
	}
	if description != nil {
		role.Description = *description
	}
	role.Audience = contracts.AccountAudience(audience)
	role.PermissionCodenames = permissionCodenames
	return role, nil
}

func (store *PostgresStore) ListRoles(ctx context.Context) ([]Role, error) {
	rows, err := store.pool.Query(ctx, `SELECT `+selectRoleColumns+` GROUP BY r.id ORDER BY r.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := make([]Role, 0)
	for rows.Next() {
		role, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (store *PostgresStore) GetRoleByID(ctx context.Context, roleID string) (Role, error) {
	return scanRole(store.pool.QueryRow(ctx, `SELECT `+selectRoleColumns+` WHERE r.id = $1 GROUP BY r.id`, roleID))
}

// CreateRole never creates a system role (is_system is always FALSE here) —
// system roles exist only via EnsureSystemRole at startup, code-owned, not
// staff-composed. See agent-system/plans/services/auth-and-admin-plan.md#amended--dynamic-modelled-on-django-auth.
func (store *PostgresStore) CreateRole(ctx context.Context, name, description string, audience contracts.AccountAudience, permissionCodenames []string) (Role, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return Role{}, err
	}
	defer transaction.Rollback(ctx)
	var roleID string
	if err := transaction.QueryRow(ctx, `INSERT INTO roles (name, description, audience, is_system)
			VALUES ($1,$2,$3,FALSE) RETURNING id::text`, name, description, string(audience),
	).Scan(&roleID); err != nil {
		return Role{}, mapConstraintViolation(err)
	}
	for _, codename := range permissionCodenames {
		if _, err := transaction.Exec(ctx, `INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, id FROM permissions WHERE codename = $2`, roleID, codename); err != nil {
			return Role{}, mapConstraintViolation(err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return Role{}, err
	}
	return store.GetRoleByID(ctx, roleID)
}

func (store *PostgresStore) UpdateRole(ctx context.Context, roleID, description string, permissionCodenames []string) (Role, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return Role{}, err
	}
	defer transaction.Rollback(ctx)
	if _, err := transaction.Exec(ctx, `UPDATE roles SET description = $2, updated_at = NOW() WHERE id = $1`, roleID, description); err != nil {
		return Role{}, err
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
		return Role{}, err
	}
	for _, codename := range permissionCodenames {
		if _, err := transaction.Exec(ctx, `INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, id FROM permissions WHERE codename = $2`, roleID, codename); err != nil {
			return Role{}, mapConstraintViolation(err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return Role{}, err
	}
	return store.GetRoleByID(ctx, roleID)
}

func (store *PostgresStore) DeleteRole(ctx context.Context, roleID string) error {
	tag, err := store.pool.Exec(ctx, `DELETE FROM roles WHERE id = $1`, roleID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (store *PostgresStore) CountAccountsWithRole(ctx context.Context, roleID string) (int, error) {
	var count int
	err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM account_roles WHERE role_id = $1`, roleID).Scan(&count)
	return count, err
}

// AssignRole refuses any account whose kind is not staff - see
// ErrRoleNotGrantableToAccountKind.
//
// Two statements rather than one clever INSERT ... SELECT, deliberately: with
// ON CONFLICT DO NOTHING, "zero rows affected" would mean both "already
// assigned" and "not a staff account", and a guard that cannot tell its own
// refusal from a no-op is not a guard. Role assignment is a low-volume staff
// action, so the extra read costs nothing worth the ambiguity.
func (store *PostgresStore) AssignRole(ctx context.Context, accountID, roleID string) error {
	var kind string
	if err := store.pool.QueryRow(ctx, `SELECT kind FROM accounts WHERE id = $1`, accountID).Scan(&kind); err != nil {
		return mapNotFound(err)
	}
	if contracts.AccountKind(kind) != contracts.AccountKindStaff {
		return ErrRoleNotGrantableToAccountKind
	}
	_, err := store.pool.Exec(ctx, `INSERT INTO account_roles (account_id, role_id) VALUES ($1,$2)
		ON CONFLICT (account_id, role_id) DO NOTHING`, accountID, roleID)
	return mapConstraintViolation(err)
}

func (store *PostgresStore) RevokeRole(ctx context.Context, accountID, roleID string) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM account_roles WHERE account_id = $1 AND role_id = $2`, accountID, roleID)
	return err
}

func (store *PostgresStore) AccountPermissionsExcludingRole(ctx context.Context, accountID, excludeRoleID string) ([]string, error) {
	rows, err := store.pool.Query(ctx, `SELECT DISTINCT p.codename FROM permissions p
		JOIN role_permissions rp ON rp.permission_id = p.id
		JOIN account_roles ar ON ar.role_id = rp.role_id
		WHERE ar.account_id = $1 AND ar.role_id != $2::uuid`, accountID, excludeRoleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	permissions := make([]string, 0)
	for rows.Next() {
		var codename string
		if err := rows.Scan(&codename); err != nil {
			return nil, err
		}
		permissions = append(permissions, codename)
	}
	return permissions, rows.Err()
}

func (store *PostgresStore) ListPermissions(ctx context.Context) ([]Permission, error) {
	rows, err := store.pool.Query(ctx, `SELECT codename, description, audience FROM permissions ORDER BY codename`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	permissions := make([]Permission, 0)
	for rows.Next() {
		var permission Permission
		var codename, audience string
		if err := rows.Scan(&codename, &permission.Description, &audience); err != nil {
			return nil, err
		}
		permission.Codename = contracts.PermissionCode(codename)
		permission.Audience = contracts.AccountAudience(audience)
		permissions = append(permissions, permission)
	}
	return permissions, rows.Err()
}
