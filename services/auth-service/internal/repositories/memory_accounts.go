package repositories

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func (store *MemoryStore) CreateAccount(_ context.Context, params CreateAccountParams) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	email := strings.ToLower(strings.TrimSpace(params.Email))
	if _, exists := store.accountIDByEmail[email]; exists {
		return Account{}, ErrConflict
	}
	now := time.Now().UTC()
	account := Account{
		ID:                  uuid.NewString(),
		Email:               email,
		Name:                params.Name,
		PasswordHash:        params.PasswordHash,
		Kind:                params.Kind,
		IsSuperAdmin:        params.IsSuperAdmin,
		TokenVersion:        1,
		ForcePasswordChange: params.ForcePasswordChange,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	store.accountsByID[account.ID] = account
	store.accountIDByEmail[email] = account.ID
	return account, nil
}

// UpdateAccount mirrors PostgresStore's UpdateAccount, including the
// unique-email conflict PostgresStore gets for free from its column
// constraint.
func (store *MemoryStore) UpdateAccount(_ context.Context, accountID, email, name string) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return Account{}, ErrNotFound
	}
	normalized := strings.ToLower(strings.TrimSpace(email))
	if existingID, exists := store.accountIDByEmail[normalized]; exists && existingID != accountID {
		return Account{}, ErrConflict
	}
	delete(store.accountIDByEmail, account.Email)
	account.Email = normalized
	account.Name = name
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	store.accountIDByEmail[normalized] = accountID
	return account, nil
}

func (store *MemoryStore) GetAccountByEmail(_ context.Context, email string) (Account, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	accountID, found := store.accountIDByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !found {
		return Account{}, ErrNotFound
	}
	return store.accountsByID[accountID], nil
}

func (store *MemoryStore) GetAccountByID(_ context.Context, accountID string) (Account, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return Account{}, ErrNotFound
	}
	return account, nil
}

// ListAccounts mirrors PostgresStore's created_at DESC, id DESC keyset order
// (cursor.go) so tests exercise the same pagination behavior production
// sees. Search mirrors PostgresStore's case-insensitive email-or-name
// substring match.
func (store *MemoryStore) ListAccounts(_ context.Context, cursor string, pageSize int, search string, kind contracts.AccountKind) ([]Account, string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	needle := strings.ToLower(strings.TrimSpace(search))
	all := make([]Account, 0, len(store.accountsByID))
	for _, account := range store.accountsByID {
		if needle != "" && !strings.Contains(strings.ToLower(account.Email), needle) && !strings.Contains(strings.ToLower(account.Name), needle) {
			continue
		}
		// Mirrors PostgresStore's equality predicate, including that an empty
		// kind means every kind. Applied BEFORE pagination, like the search
		// above, because a filter applied after would page over the unfiltered
		// set and return short pages - the exact defect that made this a
		// server-side filter rather than a client-side one.
		if kind != "" && account.Kind != kind {
			continue
		}
		all = append(all, account)
	}
	sort.Slice(all, func(i, j int) bool {
		if !all[i].CreatedAt.Equal(all[j].CreatedAt) {
			return all[i].CreatedAt.After(all[j].CreatedAt)
		}
		return all[i].ID > all[j].ID
	})

	startIndex := 0
	if cursor != "" {
		cursorTime, cursorID, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		for index, account := range all {
			if account.CreatedAt.Before(cursorTime) || (account.CreatedAt.Equal(cursorTime) && account.ID < cursorID) {
				startIndex = index
				break
			}
			startIndex = index + 1
		}
	}

	remaining := all[startIndex:]
	var nextCursor string
	if len(remaining) > pageSize {
		last := remaining[pageSize-1]
		nextCursor = encodeCursor(last.CreatedAt, last.ID)
		remaining = remaining[:pageSize]
	}
	return remaining, nextCursor, nil
}

// CreateInvite writes an account with no password and grants the given
// roles, matching PostgresStore's CreateInvite.
func (store *MemoryStore) CreateInvite(_ context.Context, params InviteAccountParams) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	email := strings.ToLower(strings.TrimSpace(params.Email))
	if _, exists := store.accountIDByEmail[email]; exists {
		return Account{}, ErrConflict
	}
	now := time.Now().UTC()
	invitedAt := now
	expiresAt := params.InviteExpiresAt
	account := Account{
		ID:              uuid.NewString(),
		Email:           email,
		Kind:            contracts.AccountKindStaff,
		TokenVersion:    1,
		InvitedAt:       &invitedAt,
		InviteExpiresAt: &expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	store.accountsByID[account.ID] = account
	store.accountIDByEmail[email] = account.ID
	store.accountIDByInviteTokenHash[params.InviteTokenHash] = account.ID
	if store.accountRoleIDs[account.ID] == nil {
		store.accountRoleIDs[account.ID] = map[string]struct{}{}
	}
	for _, roleID := range params.RoleIDs {
		store.accountRoleIDs[account.ID][roleID] = struct{}{}
	}
	return account, nil
}

func (store *MemoryStore) GetAccountByInviteTokenHash(_ context.Context, tokenHash string) (Account, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	accountID, found := store.accountIDByInviteTokenHash[tokenHash]
	if !found {
		return Account{}, ErrNotFound
	}
	return store.accountsByID[accountID], nil
}

// AcceptInvite sets the account's first password and clears the invite
// state, matching PostgresStore's AcceptInvite.
func (store *MemoryStore) AcceptInvite(_ context.Context, accountID, passwordHash string) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return Account{}, ErrNotFound
	}
	account.PasswordHash = passwordHash
	account.InvitedAt = nil
	account.InviteExpiresAt = nil
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	for tokenHash, mappedAccountID := range store.accountIDByInviteTokenHash {
		if mappedAccountID == accountID {
			delete(store.accountIDByInviteTokenHash, tokenHash)
		}
	}
	return account, nil
}

func (store *MemoryStore) AccountRolesAndPermissions(_ context.Context, accountID string) ([]string, []string, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	roleNames := make([]string, 0)
	permissionSet := map[string]struct{}{}
	for roleID := range store.accountRoleIDs[accountID] {
		role, found := store.roles[roleID]
		if !found {
			continue
		}
		roleNames = append(roleNames, role.name)
		for codename := range role.permissionCodenames {
			permissionSet[codename] = struct{}{}
		}
	}
	permissions := make([]string, 0, len(permissionSet))
	for codename := range permissionSet {
		permissions = append(permissions, codename)
	}
	return roleNames, permissions, nil
}

func (store *MemoryStore) CountSuperAdmins(_ context.Context) (int, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	count := 0
	for _, account := range store.accountsByID {
		if account.IsSuperAdmin && !account.Disabled {
			count++
		}
	}
	return count, nil
}

func (store *MemoryStore) RecordFailedLoginAttempt(_ context.Context, accountID string, lockThreshold int, lockDuration time.Duration) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.FailedAttempts++
	if account.FailedAttempts >= lockThreshold {
		lockedUntil := time.Now().UTC().Add(lockDuration)
		account.LockedUntil = &lockedUntil
	}
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}

func (store *MemoryStore) ResetFailedLoginAttempts(_ context.Context, accountID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.FailedAttempts = 0
	account.LockedUntil = nil
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}

func (store *MemoryStore) BumpTokenVersion(_ context.Context, accountID string) (int, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return 0, ErrNotFound
	}
	account.TokenVersion++
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return account.TokenVersion, nil
}

func (store *MemoryStore) SetAccountDisabled(_ context.Context, accountID string, disabled bool) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return ErrNotFound
	}
	account.Disabled = disabled
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return nil
}
