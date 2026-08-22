package main

import (
	"os"

	"github.com/myunivokai/myunivokai/services/analytics-service/internal/config"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/db"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load analytics service configuration")
	}
	databaseURL := cfg.DatabaseDirectURL
	if databaseURL == "" {
		databaseURL = cfg.DatabaseURL
	}
	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "migrations"
	}
	if err := db.Migrate(databaseURL, migrationsDir); err != nil {
		log.Fatal().Err(err).Msg("run migrations")
	}
	log.Info().Msg("migrations complete")
}
