package db

import (
	"database/sql"
	"errors"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Migrate(databaseURL, migrationsDir string) error {
	if databaseURL == "" {
		return errors.New("database url is required for migrations")
	}
	conn, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer conn.Close()
	return goose.Up(conn, migrationsDir)
}
