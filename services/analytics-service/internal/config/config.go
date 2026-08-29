package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	defaultDatabaseMaximumConnections = 10
	defaultNATSConnectTimeout         = 5 * time.Second
	defaultNATSReconnectWait          = 2 * time.Second
	defaultQueryTimeout               = 2500 * time.Millisecond
	defaultShutdownTimeout            = 15 * time.Second
	defaultConsumerAckWait            = 2 * time.Minute
	defaultConsumerFetchBatchSize     = 25
	defaultConsumerFetchMaximumWait   = time.Second
	defaultConsumerRetryDelay         = 2 * time.Second
)

// Config carries no Redis and no AI settings: analytics-service verifies no
// token and calls no provider. It also carries no outbox settings, because it
// publishes nothing — see
// notes/plans/services/analytics-service-plan.md#analytics-schema.
type Config struct {
	AppEnvironment             string
	DatabaseURL                string
	DatabaseDirectURL          string
	DatabaseMaximumConnections int
	NATSURL                    string
	NATSUsername               string
	NATSPassword               string
	NATSCredentialsFile        string
	NATSConnectTimeout         time.Duration
	NATSReconnectWait          time.Duration
	QueryTimeout               time.Duration
	ShutdownTimeout            time.Duration
	ConsumerAckWait            time.Duration
	ConsumerFetchBatchSize     int
	ConsumerFetchMaximumWait   time.Duration
	ConsumerRetryDelay         time.Duration
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	loadedConfig := Config{
		AppEnvironment:             get("APP_ENV", "development"),
		DatabaseURL:                get("DATABASE_URL", ""),
		DatabaseDirectURL:          get("DATABASE_DIRECT_URL", ""),
		DatabaseMaximumConnections: getInt("DATABASE_MAX_CONNS", defaultDatabaseMaximumConnections),
		NATSURL:                    get("NATS_URL", "nats://localhost:4222"),
		NATSUsername:               get("NATS_USERNAME", ""),
		NATSPassword:               get("NATS_PASSWORD", ""),
		NATSCredentialsFile:        get("NATS_CREDENTIALS", ""),
		NATSConnectTimeout:         getDuration("NATS_CONNECT_TIMEOUT", defaultNATSConnectTimeout),
		NATSReconnectWait:          getDuration("NATS_RECONNECT_WAIT", defaultNATSReconnectWait),
		QueryTimeout:               getDuration("NATS_QUERY_TIMEOUT", defaultQueryTimeout),
		ShutdownTimeout:            getDuration("SERVICE_SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
		ConsumerAckWait:            getDuration("NATS_ACK_WAIT", defaultConsumerAckWait),
		ConsumerFetchBatchSize:     getInt("NATS_FETCH_BATCH_SIZE", defaultConsumerFetchBatchSize),
		ConsumerFetchMaximumWait:   getDuration("NATS_FETCH_MAX_WAIT", defaultConsumerFetchMaximumWait),
		ConsumerRetryDelay:         getDuration("NATS_RETRY_DELAY", defaultConsumerRetryDelay),
	}
	if err := loadedConfig.Validate(); err != nil {
		return Config{}, err
	}
	return loadedConfig, nil
}

func (loadedConfig Config) Validate() error {
	if strings.TrimSpace(loadedConfig.DatabaseURL) == "" {
		return errors.New("DATABASE_URL is required")
	}
	if strings.TrimSpace(loadedConfig.NATSURL) == "" {
		return errors.New("NATS_URL is required")
	}
	if loadedConfig.DatabaseMaximumConnections <= 0 {
		return errors.New("database connection limit must be positive")
	}
	if loadedConfig.NATSConnectTimeout <= 0 || loadedConfig.NATSReconnectWait <= 0 {
		return errors.New("NATS timing values must be positive")
	}
	if loadedConfig.QueryTimeout <= 0 || loadedConfig.ShutdownTimeout <= 0 {
		return errors.New("query and shutdown timeouts must be positive")
	}
	if loadedConfig.ConsumerAckWait <= 0 || loadedConfig.ConsumerFetchMaximumWait <= 0 || loadedConfig.ConsumerRetryDelay <= 0 {
		return errors.New("consumer timing values must be positive")
	}
	if loadedConfig.ConsumerFetchBatchSize <= 0 {
		return errors.New("consumer fetch batch size must be positive")
	}
	return nil
}

// loadEnvironmentFiles matches every other service: a real process
// environment always outranks a dotenv file, so a deployed container is never
// silently repointed by a file that happened to be baked into the image.
func loadEnvironmentFiles() {
	originalEnvironment := snapshotEnvironment()
	explicitFile := strings.TrimSpace(os.Getenv("MYUNIVOKAI_ENV_FILE"))
	if explicitFile != "" {
		_ = godotenv.Overload(explicitFile)
		restoreEnvironment(originalEnvironment)
		return
	}
	_ = godotenv.Overload(".env", ".env.local")
	restoreEnvironment(originalEnvironment)
}

func snapshotEnvironment() map[string]string {
	values := make(map[string]string)
	for _, pair := range os.Environ() {
		key, value, found := strings.Cut(pair, "=")
		if found {
			values[key] = value
		}
	}
	return values
}

func restoreEnvironment(values map[string]string) {
	for key, value := range values {
		_ = os.Setenv(key, value)
	}
}

func get(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value, err := strconv.Atoi(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func getDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}
