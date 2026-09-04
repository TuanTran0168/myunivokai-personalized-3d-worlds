package repositories

import (
	"context"
	"sort"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func (store *MemoryStore) ListSystemSettings(_ context.Context) ([]SystemSetting, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	settings := make([]SystemSetting, 0, len(store.systemSettingsByKey))
	for _, setting := range store.systemSettingsByKey {
		settings = append(settings, setting)
	}
	// Sorted for the same reason the Postgres statement carries ORDER BY: a
	// store whose list order is a map's iteration order would make the
	// settings screen's own order untestable, and Go randomises that order
	// specifically so nobody depends on it by accident.
	sort.Slice(settings, func(first, second int) bool { return settings[first].Key < settings[second].Key })
	return settings, nil
}

func (store *MemoryStore) GetSystemSetting(_ context.Context, key contracts.SettingKey) (SystemSetting, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	setting, found := store.systemSettingsByKey[key]
	if !found {
		return SystemSetting{}, ErrNotFound
	}
	return setting, nil
}

// UpsertSystemSetting mirrors the Postgres version, including the one
// behaviour a test would otherwise pass without production having: the value
// it REPLACED comes back, and an absent row reports an empty string rather
// than the default — naming the default is the service's job, because only it
// holds the registry.
//
// It does not refuse an unknown actor account, unlike UpsertAccountProfile.
// The column is ON DELETE SET NULL rather than a required parent: a policy
// number outlives the staff member who set it, so an actor that cannot be
// resolved costs an attribution and never a setting.
func (store *MemoryStore) UpsertSystemSetting(_ context.Context, key contracts.SettingKey, value, actorAccountID string) (string, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	previousValue := ""
	if existing, found := store.systemSettingsByKey[key]; found {
		previousValue = existing.Value
	}
	actor := actorAccountID
	store.systemSettingsByKey[key] = SystemSetting{
		Key: key, Value: value, UpdatedByAccountID: &actor, UpdatedAt: time.Now().UTC(),
	}
	return previousValue, nil
}
