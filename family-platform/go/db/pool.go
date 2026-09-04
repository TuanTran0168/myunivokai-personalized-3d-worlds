// Package db opens the PostgreSQL connections every family service uses and
// runs its migrations. Each family still owns its own database and its own
// migration files; what is shared here is only how they are reached.
package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/myunivokai/myunivokai/family-platform/go/config"
)

// Connect builds an explicitly-configured pgx pool. Returns (nil, nil) when no
// DATABASE_URL is set, which callers treat as "use the in-memory store".
func Connect(ctx context.Context, serviceConfig config.Config) (*pgxpool.Pool, error) {
	if serviceConfig.DatabaseURL == "" {
		return nil, nil
	}
	poolConfig, err := pgxpool.ParseConfig(serviceConfig.DatabaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConns = int32(serviceConfig.DatabaseMaximumConnections)

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
