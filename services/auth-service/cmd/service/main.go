package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/myunivokai/myunivokai/services/auth-service/internal/breach/checkers"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/config"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/db"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/messaging"
	authredis "github.com/myunivokai/myunivokai/services/auth-service/internal/redis"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/security"
	"github.com/myunivokai/myunivokai/services/auth-service/internal/services"
	"github.com/rs/zerolog/log"
)

const (
	defaultMigrationsDirectory = "migrations"
	defaultHealthCheckPort     = "8080"
)

// startHealthServer binds a port immediately so Render's free-tier cold
// start has an inbound HTTP target - see
// agent-system/plans/architecture/service-wake-mechanism.md#healthz-is-a-start-signal-not-a-readiness-signal.
// It answers 200 before the messaging runtime has finished Run().
func startHealthServer() *http.Server {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultHealthCheckPort
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})
	server := &http.Server{Addr: ":" + port, Handler: mux}
	go func() {
		log.Info().Str("addr", server.Addr).Msg("auth health server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("auth health server failed")
		}
	}()
	return server
}

func main() {
	processStartedAt := time.Now()
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load auth service configuration")
	}
	migrationDatabaseURL := serviceConfig.DatabaseDirectURL
	if migrationDatabaseURL == "" {
		migrationDatabaseURL = serviceConfig.DatabaseURL
	}
	migrationsDirectory := os.Getenv("MIGRATIONS_DIR")
	if migrationsDirectory == "" {
		migrationsDirectory = defaultMigrationsDirectory
	}
	if err := db.Migrate(migrationDatabaseURL, migrationsDirectory); err != nil {
		log.Fatal().Err(err).Msg("run auth database migrations")
	}
	log.Info().Msg("auth database migrations complete")
	healthServer := startHealthServer()
	defer func() { _ = healthServer.Close() }()
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect auth database")
	}
	defer databasePool.Close()

	redisClient, err := authredis.NewClient(serviceConfig.RedisURL, serviceConfig.RedisKeyPrefix)
	if err != nil {
		log.Fatal().Err(err).Msg("connect auth redis client")
	}
	defer func() { _ = redisClient.Close() }()

	store := repositories.NewPostgresStore(databasePool)
	if err := services.SyncPermissionsAndSeedRoles(runtimeContext, store); err != nil {
		log.Fatal().Err(err).Msg("sync auth permissions and seed roles")
	}
	log.Info().Msg("auth permission sync complete")

	passwordHasher := security.NewPasswordHasher(
		serviceConfig.Argon2MemoryKiB, serviceConfig.Argon2Iterations, serviceConfig.Argon2Parallelism,
		serviceConfig.Argon2SaltLength, serviceConfig.Argon2KeyLength,
	)
	// No lifetimes: all four are system_settings rows now, resolved per call
	// by AuthService.accessTokenLifetime and refreshTokenLifetime.
	tokenIssuer := security.NewTokenIssuer(serviceConfig.AccessTokenPrivateKey)
	// The real breached-password corpus, wired only here. Every test builds
	// the service with checkers.NewMockChecker instead, per AGENTS.md.
	passwordPolicy := services.NewPasswordPolicy(checkers.NewPwnedRangeChecker())
	authService, err := services.NewAuthService(store, passwordHasher, tokenIssuer, redisClient, passwordPolicy, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("construct auth service")
	}

	// Re-mirror every setting into Redis, so a flushed cache self-heals on the
	// next boot and the gateway's compiled-in default stays a last resort
	// rather than the normal answer — §9.3.
	//
	// Not fatal, unlike the permission sync above. This service reads its own
	// settings from Postgres and needs no mirror to behave correctly; refusing
	// to boot here would take every sign-in on the platform down to protect a
	// quota number the gateway has a correct default for.
	if err := authService.MirrorSettingsToCache(runtimeContext); err != nil {
		log.Error().Err(err).Msg("mirror auth settings into redis")
	} else {
		log.Info().Msg("auth settings mirrored to redis")
	}

	messagingRuntime, err := messaging.NewRuntime(serviceConfig, authService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect auth messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start auth messaging runtime")
	}
	// Announced after Run, because "ready" here means subscriptions are
	// registered - a boot time measured to any earlier point would flatter
	// the cold start it exists to measure. Never fatal: this process is
	// here to serve, not to describe itself.
	if err := messagingRuntime.PublishServiceStarted(runtimeContext, time.Since(processStartedAt)); err != nil {
		log.Error().Err(err).Msg("announce auth service start")
	}
	log.Info().Msg("auth service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
