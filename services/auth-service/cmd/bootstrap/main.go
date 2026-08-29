// Command bootstrap creates the first super-admin account. There is no
// self-signup path anywhere in auth-service, so this is the only way an
// account can ever come to exist without another account creating it.
//
// The email and password are supplied by the operator at invocation time -
// as flags, or as AUTH_BOOTSTRAP_EMAIL/AUTH_BOOTSTRAP_PASSWORD if flags are
// omitted - and never defaulted. There is no default password anywhere in
// this repository, not even a local-only one; see
// notes/plans/services/auth-and-admin-plan.md#passwords.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/db"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
	"github.com/rs/zerolog/log"
)

const minimumBootstrapPasswordLength = 12

func main() {
	emailFlag := flag.String("email", "", "email for the first super-admin account (or AUTH_BOOTSTRAP_EMAIL)")
	passwordFlag := flag.String("password", "", "password for the first super-admin account (or AUTH_BOOTSTRAP_PASSWORD)")
	flag.Parse()

	email := firstNonEmpty(*emailFlag, os.Getenv("AUTH_BOOTSTRAP_EMAIL"))
	password := firstNonEmpty(*passwordFlag, os.Getenv("AUTH_BOOTSTRAP_PASSWORD"))
	if strings.TrimSpace(email) == "" {
		log.Fatal().Msg("bootstrap requires --email or AUTH_BOOTSTRAP_EMAIL")
	}
	if len(password) < minimumBootstrapPasswordLength {
		log.Fatal().Int("minimum_length", minimumBootstrapPasswordLength).Msg("bootstrap requires --password or AUTH_BOOTSTRAP_PASSWORD of at least the minimum length")
	}

	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load auth service configuration")
	}
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect auth database")
	}
	defer databasePool.Close()

	passwordHasher := security.NewPasswordHasher(
		serviceConfig.Argon2MemoryKiB, serviceConfig.Argon2Iterations, serviceConfig.Argon2Parallelism,
		serviceConfig.Argon2SaltLength, serviceConfig.Argon2KeyLength,
	)
	passwordHash, err := passwordHasher.Hash(password)
	if err != nil {
		log.Fatal().Err(err).Msg("hash bootstrap password")
	}

	store := repositories.NewPostgresStore(databasePool)
	account, err := store.CreateAccount(runtimeContext, repositories.CreateAccountParams{
		Email:               strings.ToLower(strings.TrimSpace(email)),
		PasswordHash:        passwordHash,
		Kind:                contracts.AccountKindStaff,
		IsSuperAdmin:        true,
		ForcePasswordChange: true,
	})
	if errors.Is(err, repositories.ErrConflict) {
		log.Fatal().Str("email", email).Msg("an account with this email already exists; bootstrap only creates the first account")
	}
	if err != nil {
		log.Fatal().Err(err).Msg("create bootstrap account")
	}
	fmt.Printf("Created super-admin account %s (%s). It must change its password on first login.\n", account.ID, account.Email)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
