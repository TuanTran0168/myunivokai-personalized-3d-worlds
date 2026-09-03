package repositories

import (
	"context"
	"fmt"
	"strings"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func (store *PostgresStore) CreateAccount(ctx context.Context, params CreateAccountParams) (Account, error) {
	var account Account
	account.Email = params.Email
	account.Name = params.Name
	account.PasswordHash = params.PasswordHash
	account.Kind = params.Kind
	account.IsSuperAdmin = params.IsSuperAdmin
	account.ForcePasswordChange = params.ForcePasswordChange
	err := store.pool.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, kind, is_super_admin, force_password_change)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id::text, disabled, token_version, failed_attempts, created_at, updated_at`,
		params.Email, params.Name, params.PasswordHash, string(params.Kind), params.IsSuperAdmin, params.ForcePasswordChange,
	).Scan(&account.ID, &account.Disabled, &account.TokenVersion, &account.FailedAttempts, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		return Account{}, mapConstraintViolation(err)
	}
	return account, nil
}

// UpdateAccount relies on GetAccountByID's own not-found handling for a
// nonexistent accountID: the UPDATE simply affects zero rows, and the
// following read reports ErrNotFound the same way SetAccountDisabled's
// unchecked Exec already does elsewhere in this file.
func (store *PostgresStore) UpdateAccount(ctx context.Context, accountID, email, name string) (Account, error) {
	if _, err := store.pool.Exec(ctx, `UPDATE accounts SET email = $2, name = $3, updated_at = NOW() WHERE id = $1`, accountID, email, name); err != nil {
		return Account{}, mapConstraintViolation(err)
	}
	return store.GetAccountByID(ctx, accountID)
}

func (store *PostgresStore) GetAccountByEmail(ctx context.Context, email string) (Account, error) {
	return store.scanAccount(ctx, `email=$1`, email)
}

func (store *PostgresStore) GetAccountByID(ctx context.Context, accountID string) (Account, error) {
	return store.scanAccount(ctx, `id=$1`, accountID)
}

func (store *PostgresStore) scanAccount(ctx context.Context, predicate, value string) (Account, error) {
	var account Account
	var kind string
	// password_hash is NULL for an invited account that has not yet accepted
	// (migrations/000002_invite_flow.sql) - scanned through a pointer and
	// normalized to "" so every other call site keeps treating PasswordHash
	// as a plain string.
	var passwordHash *string
	err := store.pool.QueryRow(ctx, `SELECT id::text, email, name, password_hash, kind, is_super_admin, disabled, token_version,
			failed_attempts, locked_until, force_password_change, invited_at, invite_expires_at, created_at, updated_at
		FROM accounts WHERE `+predicate, value,
	).Scan(&account.ID, &account.Email, &account.Name, &passwordHash, &kind, &account.IsSuperAdmin, &account.Disabled,
		&account.TokenVersion, &account.FailedAttempts, &account.LockedUntil, &account.ForcePasswordChange,
		&account.InvitedAt, &account.InviteExpiresAt, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		return Account{}, mapNotFound(err)
	}
	if passwordHash != nil {
		account.PasswordHash = *passwordHash
	}
	account.Kind = contracts.AccountKind(kind)
	return account, nil
}

// ListAccounts orders created_at DESC, id DESC (see cursor.go) and fetches
// one extra row to detect whether a next page exists without a second
// COUNT query. Search, when non-empty, matches email or name
// case-insensitively as a substring — accounts are staff-scale, not
// user-scale, so a plain ILIKE needs no trigram index to stay fast.
func (store *PostgresStore) ListAccounts(ctx context.Context, cursor string, pageSize int, search string, kind contracts.AccountKind) ([]Account, string, error) {
	const selectColumns = `id::text, email, name, password_hash, kind, is_super_admin, disabled, token_version,
			failed_attempts, locked_until, force_password_change, invited_at, invite_expires_at, created_at, updated_at`

	conditions := []string{"TRUE"}
	arguments := []any{}
	if strings.TrimSpace(search) != "" {
		arguments = append(arguments, "%"+strings.TrimSpace(search)+"%")
		conditions = append(conditions, fmt.Sprintf("(email ILIKE $%d OR name ILIKE $%d)", len(arguments), len(arguments)))
	}
	// An equality match on an indexed-by-nothing column, which is correct at
	// this scale: accounts are staff-scale plus however many end users exist,
	// and the same reasoning the search's plain ILIKE already relies on
	// applies. If the end-user table ever outgrows that, the index goes in
	// with the measurement that justified it.
	if strings.TrimSpace(string(kind)) != "" {
		arguments = append(arguments, string(kind))
		conditions = append(conditions, fmt.Sprintf("kind = $%d", len(arguments)))
	}

	pageArguments := append([]any(nil), arguments...)
	if cursor != "" {
		cursorTime, cursorID, decodeErr := decodeCursor(cursor)
		if decodeErr != nil {
			return nil, "", decodeErr
		}
		pageArguments = append(pageArguments, cursorTime, cursorID)
		conditions = append(conditions, fmt.Sprintf("(created_at, id) < ($%d, $%d::uuid)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	rows, err := store.pool.Query(ctx, `SELECT `+selectColumns+`
		FROM accounts WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY created_at DESC, id DESC LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	accounts := make([]Account, 0, pageSize)
	for rows.Next() {
		var account Account
		var kind string
		var passwordHash *string
		if err := rows.Scan(&account.ID, &account.Email, &account.Name, &passwordHash, &kind, &account.IsSuperAdmin, &account.Disabled,
			&account.TokenVersion, &account.FailedAttempts, &account.LockedUntil, &account.ForcePasswordChange,
			&account.InvitedAt, &account.InviteExpiresAt, &account.CreatedAt, &account.UpdatedAt); err != nil {
			return nil, "", err
		}
		if passwordHash != nil {
			account.PasswordHash = *passwordHash
		}
		account.Kind = contracts.AccountKind(kind)
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	var nextCursor string
	if len(accounts) > pageSize {
		last := accounts[pageSize-1]
		nextCursor = encodeCursor(last.CreatedAt, last.ID)
		accounts = accounts[:pageSize]
	}
	return accounts, nextCursor, nil
}

// CreateInvite writes an account with no password (migrations/000002_invite_flow.sql's
// check constraint requires the invite columns to be set instead) and grants
// the given roles in the same transaction, so an invite never exists
// role-less for an observer racing the two writes.
func (store *PostgresStore) CreateInvite(ctx context.Context, params InviteAccountParams) (Account, error) {
	transaction, err := store.pool.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer transaction.Rollback(ctx)

	var account Account
	// Set from the literal the INSERT below writes, because that INSERT does
	// not return it. Without this the returned Account carries an empty Kind,
	// and an empty Kind is exactly the value contracts.AudienceForAccountKind
	// resolves to the admin audience by fallback - correct here by luck, and a
	// trap for the next caller that reads Kind off this result.
	account.Kind = contracts.AccountKindStaff
	err = transaction.QueryRow(ctx, `INSERT INTO accounts (email, kind, invited_at, invite_token_hash, invite_expires_at)
			VALUES ($1, 'staff', NOW(), $2, $3)
		RETURNING id::text, disabled, token_version, failed_attempts, force_password_change, invited_at, invite_expires_at, created_at, updated_at`,
		params.Email, params.InviteTokenHash, params.InviteExpiresAt,
	).Scan(&account.ID, &account.Disabled, &account.TokenVersion, &account.FailedAttempts, &account.ForcePasswordChange,
		&account.InvitedAt, &account.InviteExpiresAt, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		return Account{}, mapConstraintViolation(err)
	}
	account.Email = params.Email
	account.Kind = contracts.AccountKindStaff

	for _, roleID := range params.RoleIDs {
		if _, err := transaction.Exec(ctx, `INSERT INTO account_roles (account_id, role_id) VALUES ($1, $2::uuid)`, account.ID, roleID); err != nil {
			return Account{}, mapConstraintViolation(err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return Account{}, err
	}
	return account, nil
}

func (store *PostgresStore) GetAccountByInviteTokenHash(ctx context.Context, tokenHash string) (Account, error) {
	return store.scanAccount(ctx, `invite_token_hash=$1`, tokenHash)
}

// AcceptInvite sets the account's first password and clears the invite
// columns in one statement, satisfying the password-or-invite check
// constraint at every point in between.
func (store *PostgresStore) AcceptInvite(ctx context.Context, accountID, passwordHash string) (Account, error) {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET password_hash = $2, invited_at = NULL, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = NOW()
		WHERE id = $1`, accountID, passwordHash)
	if err != nil {
		return Account{}, mapNotFound(err)
	}
	return store.GetAccountByID(ctx, accountID)
}

func (store *PostgresStore) AccountRolesAndPermissions(ctx context.Context, accountID string) ([]string, []string, error) {
	roleRows, err := store.pool.Query(ctx, `SELECT r.name FROM roles r
		JOIN account_roles ar ON ar.role_id = r.id WHERE ar.account_id = $1 ORDER BY r.name`, accountID)
	if err != nil {
		return nil, nil, err
	}
	defer roleRows.Close()
	roles := make([]string, 0)
	for roleRows.Next() {
		var roleName string
		if err := roleRows.Scan(&roleName); err != nil {
			return nil, nil, err
		}
		roles = append(roles, roleName)
	}
	if err := roleRows.Err(); err != nil {
		return nil, nil, err
	}

	permissionRows, err := store.pool.Query(ctx, `SELECT DISTINCT p.codename FROM permissions p
		JOIN role_permissions rp ON rp.permission_id = p.id
		JOIN account_roles ar ON ar.role_id = rp.role_id
		WHERE ar.account_id = $1 ORDER BY p.codename`, accountID)
	if err != nil {
		return nil, nil, err
	}
	defer permissionRows.Close()
	permissions := make([]string, 0)
	for permissionRows.Next() {
		var codename string
		if err := permissionRows.Scan(&codename); err != nil {
			return nil, nil, err
		}
		permissions = append(permissions, codename)
	}
	if err := permissionRows.Err(); err != nil {
		return nil, nil, err
	}
	return roles, permissions, nil
}

func (store *PostgresStore) CountSuperAdmins(ctx context.Context) (int, error) {
	var count int
	err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM accounts WHERE is_super_admin AND NOT disabled`).Scan(&count)
	return count, err
}

func (store *PostgresStore) RecordFailedLoginAttempt(ctx context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET
			failed_attempts = failed_attempts + 1,
			locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + make_interval(secs => $3) ELSE locked_until END,
			updated_at = NOW()
		WHERE id = $1`, accountID, lockThreshold, lockDuration.Seconds())
	return err
}

func (store *PostgresStore) ResetFailedLoginAttempts(ctx context.Context, accountID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`, accountID)
	return err
}

func (store *PostgresStore) BumpTokenVersion(ctx context.Context, accountID string) (int, error) {
	var tokenVersion int
	err := store.pool.QueryRow(ctx, `UPDATE accounts SET token_version = token_version + 1, updated_at = NOW()
		WHERE id = $1 RETURNING token_version`, accountID).Scan(&tokenVersion)
	if err != nil {
		return 0, mapNotFound(err)
	}
	return tokenVersion, nil
}

func (store *PostgresStore) SetAccountDisabled(ctx context.Context, accountID string, disabled bool) error {
	_, err := store.pool.Exec(ctx, `UPDATE accounts SET disabled = $2, updated_at = NOW() WHERE id = $1`, accountID, disabled)
	return err
}
