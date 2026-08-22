package repositories

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func (store *MemoryStore) CreateRefreshToken(_ context.Context, token RefreshToken) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, exists := store.refreshTokenIDByHash[token.TokenHash]; exists {
		return ErrConflict
	}
	if token.ID == "" {
		token.ID = uuid.NewString()
	}
	token.CreatedAt = time.Now().UTC()
	store.refreshTokensByID[token.ID] = token
	store.refreshTokenIDByHash[token.TokenHash] = token.ID
	return nil
}

func (store *MemoryStore) GetRefreshTokenByHash(_ context.Context, tokenHash string) (RefreshToken, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	tokenID, found := store.refreshTokenIDByHash[tokenHash]
	if !found {
		return RefreshToken{}, ErrNotFound
	}
	return store.refreshTokensByID[tokenID], nil
}

func (store *MemoryStore) MarkRefreshTokenUsed(_ context.Context, tokenID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	token, found := store.refreshTokensByID[tokenID]
	if !found {
		return ErrNotFound
	}
	usedAt := time.Now().UTC()
	token.UsedAt = &usedAt
	store.refreshTokensByID[tokenID] = token
	return nil
}

func (store *MemoryStore) RevokeRefreshTokenFamily(_ context.Context, familyID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC()
	for id, token := range store.refreshTokensByID {
		if token.FamilyID == familyID && token.RevokedAt == nil {
			token.RevokedAt = &now
			store.refreshTokensByID[id] = token
		}
	}
	return nil
}

func (store *MemoryStore) RevokeAllRefreshTokensForAccount(_ context.Context, accountID string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	now := time.Now().UTC()
	for id, token := range store.refreshTokensByID {
		if token.AccountID == accountID && token.RevokedAt == nil {
			token.RevokedAt = &now
			store.refreshTokensByID[id] = token
		}
	}
	return nil
}
