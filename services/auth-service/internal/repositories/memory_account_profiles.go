package repositories

import (
	"context"
	"time"
)

func (store *MemoryStore) GetAccountProfile(_ context.Context, accountID string) (AccountProfile, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	profile, found := store.accountProfilesByAccountID[accountID]
	if !found {
		return AccountProfile{}, ErrNotFound
	}
	return withCopiedLists(profile), nil
}

// UpsertAccountProfile mirrors the Postgres version, including the two
// behaviours a test could otherwise pass without production having: the row
// is created on first save, and created_at survives every save after that.
//
// It also refuses a profile for an account that does not exist. Postgres
// refuses it through the foreign key; a memory store that accepted it would
// let a test build a profile for a stranger and never notice.
func (store *MemoryStore) UpsertAccountProfile(_ context.Context, profile AccountProfile) (AccountProfile, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, accountExists := store.accountsByID[profile.AccountID]; !accountExists {
		return AccountProfile{}, ErrNotFound
	}
	now := time.Now().UTC()
	profile.UpdatedAt = now
	if existing, found := store.accountProfilesByAccountID[profile.AccountID]; found {
		profile.CreatedAt = existing.CreatedAt
	} else {
		profile.CreatedAt = now
	}
	stored := withCopiedLists(profile)
	store.accountProfilesByAccountID[profile.AccountID] = stored
	return withCopiedLists(stored), nil
}

func (store *MemoryStore) SetAccountDisplayName(_ context.Context, accountID, name string) (Account, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	account, found := store.accountsByID[accountID]
	if !found {
		return Account{}, ErrNotFound
	}
	account.Name = name
	account.UpdatedAt = time.Now().UTC()
	store.accountsByID[accountID] = account
	return account, nil
}

// withCopiedLists detaches the three slices, so a caller holding the returned
// profile cannot mutate what the store kept - the one way an in-process store
// can behave differently from a database without any test noticing. It also
// replaces nil with an empty slice, matching decodeStringList.
func withCopiedLists(profile AccountProfile) AccountProfile {
	profile.Interests = copyStringList(profile.Interests)
	profile.Traits = copyStringList(profile.Traits)
	profile.FavoriteColors = copyStringList(profile.FavoriteColors)
	return profile
}

func copyStringList(values []string) []string {
	copied := make([]string, len(values))
	copy(copied, values)
	return copied
}
