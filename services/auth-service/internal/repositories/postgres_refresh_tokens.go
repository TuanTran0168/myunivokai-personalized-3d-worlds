package repositories

import "context"

func (store *PostgresStore) RevokeAllRefreshTokensForAccount(ctx context.Context, accountID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE account_id = $1 AND revoked_at IS NULL`, accountID)
	return err
}

func (store *PostgresStore) CreateRefreshToken(ctx context.Context, token RefreshToken) error {
	_, err := store.pool.Exec(ctx, `INSERT INTO refresh_tokens (id, account_id, family_id, token_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5)`, token.ID, token.AccountID, token.FamilyID, token.TokenHash, token.ExpiresAt)
	return mapConstraintViolation(err)
}

func (store *PostgresStore) GetRefreshTokenByHash(ctx context.Context, tokenHash string) (RefreshToken, error) {
	var token RefreshToken
	err := store.pool.QueryRow(ctx, `SELECT id::text, account_id::text, family_id::text, token_hash, used_at, revoked_at, expires_at, created_at
		FROM refresh_tokens WHERE token_hash = $1`, tokenHash,
	).Scan(&token.ID, &token.AccountID, &token.FamilyID, &token.TokenHash, &token.UsedAt, &token.RevokedAt, &token.ExpiresAt, &token.CreatedAt)
	if err != nil {
		return RefreshToken{}, mapNotFound(err)
	}
	return token, nil
}

func (store *PostgresStore) MarkRefreshTokenUsed(ctx context.Context, tokenID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1`, tokenID)
	return err
}

func (store *PostgresStore) RevokeRefreshTokenFamily(ctx context.Context, familyID string) error {
	_, err := store.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL`, familyID)
	return err
}
