package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/aifactory"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/db"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/services"
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
		log.Info().Str("addr", server.Addr).Msg("dna health server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("dna health server failed")
		}
	}()
	return server
}

func main() {
	processStartedAt := time.Now()
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load dna service configuration")
	}
	migrationDatabaseURL := serviceConfig.DatabaseDirectURL
	if strings.TrimSpace(migrationDatabaseURL) == "" {
		migrationDatabaseURL = serviceConfig.DatabaseURL
	}
	migrationsDirectory := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR"))
	if migrationsDirectory == "" {
		migrationsDirectory = defaultMigrationsDirectory
	}
	if err := db.Migrate(migrationDatabaseURL, migrationsDirectory); err != nil {
		log.Fatal().Err(err).Msg("run dna database migrations")
	}
	log.Info().Msg("dna database migrations complete")
	healthServer := startHealthServer()
	defer func() { _ = healthServer.Close() }()
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect dna database")
	}
	defer databasePool.Close()
	store := repositories.NewPostgresStore(databasePool)
	orchestrator, err := aifactory.NewOrchestrator(serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("create AI orchestrator")
	}
	generationService := services.NewGenerationService(serviceConfig, store, orchestrator)
	messagingRuntime, err := messaging.NewRuntime(serviceConfig, store, generationService)
	if err != nil {
		log.Fatal().Err(err).Msg("connect DNA messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start DNA messaging runtime")
	}
	// Announced after Run, because "ready" here means subscriptions are
	// registered - a boot time measured to any earlier point would flatter
	// the cold start it exists to measure. Never fatal: this process is
	// here to serve, not to describe itself.
	if err := messagingRuntime.PublishServiceStarted(runtimeContext, time.Since(processStartedAt)); err != nil {
		log.Error().Err(err).Msg("announce dna service start")
	}
	log.Info().Msg("dna service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}
