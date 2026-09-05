package main

import (
	"os"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/shared/family-platform/go/config"
	"github.com/myunivokai/myunivokai/shared/family-platform/go/db"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg, err := config.Load(contracts.WorldFamilyUniverse)
	if err != nil {
		log.Fatal().Err(err).Msg("load universe service configuration")
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
