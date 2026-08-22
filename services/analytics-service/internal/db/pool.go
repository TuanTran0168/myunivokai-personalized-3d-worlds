package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/config"
)

// Connect builds an explicitly-configured pgx pool.
func Connect(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConns = int32(cfg.DatabaseMaximumConnections)

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
