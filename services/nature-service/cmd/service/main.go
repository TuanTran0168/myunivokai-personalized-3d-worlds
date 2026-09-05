package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/shared/family-platform/go/config"
	"github.com/myunivokai/myunivokai/shared/family-platform/go/db"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
	"github.com/rs/zerolog/log"
)

const (
	defaultMigrationsDirectory = "migrations"
	defaultHealthCheckPort     = "8080"
)

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
		log.Info().Str("addr", server.Addr).Msg("nature health server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("nature health server failed")
		}
	}()
	return server
}

func main() {
	processStartedAt := time.Now()
	serviceConfig, err := config.Load(contracts.WorldFamilyNature)
	if err != nil {
		log.Fatal().Err(err).Msg("load nature service configuration")
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
		log.Fatal().Err(err).Msg("run nature database migrations")
	}
	log.Info().Msg("nature database migrations complete")
	healthServer := startHealthServer()
	defer func() { _ = healthServer.Close() }()
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect nature database")
	}
	defer databasePool.Close()
	store := repositories.NewPostgresStore(databasePool)
	worldService := services.NewWorldService(serviceConfig, store, services.NewForestConfigBuilder())
	messagingRuntime, err := messaging.NewRuntime(serviceConfig, store, worldService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect nature messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start nature messaging runtime")
	}
	// Announced after Run, because "ready" here means subscriptions are
	// registered - a boot time measured to any earlier point would flatter
	// the cold start it exists to measure. Never fatal: this process is
	// here to serve, not to describe itself.
	if err := messagingRuntime.PublishServiceStarted(runtimeContext, time.Since(processStartedAt)); err != nil {
		log.Error().Err(err).Msg("announce nature service start")
	}
	log.Info().Msg("nature service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
