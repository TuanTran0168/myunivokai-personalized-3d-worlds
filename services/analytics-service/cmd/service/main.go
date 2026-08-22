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

	"github.com/myunivokai/myunivokai/services/analytics-service/internal/config"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/db"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/messaging"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/services"
	"github.com/rs/zerolog/log"
)

const (
	defaultMigrationsDirectory = "migrations"
	defaultHealthCheckPort     = "8080"
)

// startHealthServer binds a port immediately so Render's free-tier cold start
// has an inbound HTTP target - see
// notes/vision/service-wake-mechanism.md#healthz-is-a-start-signal-not-a-readiness-signal.
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
		log.Info().Str("addr", server.Addr).Msg("analytics health server listening")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("analytics health server failed")
		}
	}()
	return server
}

func main() {
	processStartedAt := time.Now()
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load analytics service configuration")
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
		log.Fatal().Err(err).Msg("run analytics database migrations")
	}
	log.Info().Msg("analytics database migrations complete")
	healthServer := startHealthServer()
	defer func() { _ = healthServer.Close() }()
	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databasePool, err := db.Connect(runtimeContext, serviceConfig)
	if err != nil {
		log.Fatal().Err(err).Msg("connect analytics database")
	}
	defer databasePool.Close()

	store := repositories.NewPostgresStore(databasePool)
	messagingRuntime, err := messaging.NewRuntime(
		serviceConfig,
		services.NewAnalyticsService(store),
		services.NewProjectionService(store),
	)
	if err != nil {
		log.Fatal().Err(err).Msg("connect analytics messaging runtime")
	}
	if err := messagingRuntime.Run(runtimeContext); err != nil {
		log.Fatal().Err(err).Msg("start analytics messaging runtime")
	}
	recordOwnStart(runtimeContext, store, time.Since(processStartedAt))
	log.Info().Msg("analytics service ready")
	<-runtimeContext.Done()
	messagingRuntime.Close()
}

// recordOwnStart writes this boot straight to the database instead of
// publishing it.
//
// Every other service announces itself on myunivokai.events.<name>.service.started.v1
// and this service projects it. analytics-service is that consumer, so the
// event would travel to itself and back for nothing - and sending it would
// need an exception in the one NATS user allowed to publish no myunivokai
// subject at all (infra/nats/nats-server.conf). Keeping that absolute is
// worth more than making all six look identical.
//
// A failure here is logged and not fatal. Losing one row of boot history is
// not a reason to refuse to consume events, which is what this process exists
// to do.
func recordOwnStart(ctx context.Context, store *repositories.PostgresStore, bootDuration time.Duration) {
	data := contracts.NewServiceStartedData(contracts.ServiceNameAnalytics, bootDuration)
	start := models.ServiceStart{
		Service:        data.Service,
		InstanceID:     data.InstanceID,
		Version:        data.Version,
		BootDurationMS: data.BootDurationMS,
		StartedAt:      time.Now().UTC(),
	}
	if err := store.RecordOwnStart(ctx, start); err != nil {
		log.Error().Err(err).Msg("record analytics service start")
		return
	}
	log.Info().Str("instance_id", start.InstanceID).Str("version", start.Version).Int64("boot_ms", start.BootDurationMS).Msg("analytics service start recorded")
}
