// Package repositories holds every SQL statement auth-service runs.
//
// PostgresStore is one struct implementing Store, matching the convention
// universe-service, nature-service and dna-service already use — not a
// separate repository type per aggregate. What IS split, across this file
// and postgres_accounts.go / postgres_refresh_tokens.go /
// postgres_roles_permissions.go / postgres_audit.go, is which methods live
// in which file: accounts, refresh tokens, roles/permissions and audit
// events are different enough concerns to read poorly crammed into one
// file, even though they share one receiver type and one database
// connection pool. A second interface per aggregate was considered and
// rejected — see services/auth-service/README.md#repository-layout.
package repositories

import (
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	postgresUniqueViolationCode = "23505"
	postgresForeignKeyCode      = "23503"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func mapNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func mapConstraintViolation(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case postgresUniqueViolationCode:
			return ErrConflict
		case postgresForeignKeyCode:
			return ErrNotFound
		}
	}
	return mapNotFound(err)
}
