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
	defaultConsumerAckWait            = 2 * time.Minute
	defaultConsumerMaximumDeliveries  = 5
	defaultConsumerFetchBatchSize     = 1
	defaultConsumerFetchMaximumWait   = time.Second
	defaultConsumerRetryDelay         = 2 * time.Second
	defaultNATSConnectTimeout         = 5 * time.Second
	defaultNATSReconnectWait          = 2 * time.Second
	defaultNATSPublishTimeout         = 5 * time.Second
	defaultQueryTimeout               = 2500 * time.Millisecond
	defaultShutdownTimeout            = 15 * time.Second
	defaultOutboxPollInterval         = 500 * time.Millisecond
	defaultOutboxBatchSize            = 50
	defaultShareSlugLength            = 10
)

type Config struct {
	AppEnvironment             string
	PublicWebURL               string
	DatabaseURL                string
	DatabaseDirectURL          string
	DatabaseMaximumConnections int
	NATSURL                    string
	NATSUsername               string
	NATSPassword               string
	NATSCredentialsFile        string
	ConsumerAckWait            time.Duration
	ConsumerMaximumDeliveries  int
	ConsumerFetchBatchSize     int
	ConsumerFetchMaximumWait   time.Duration
	ConsumerRetryDelay         time.Duration
	NATSConnectTimeout         time.Duration
	NATSReconnectWait          time.Duration
	NATSPublishTimeout         time.Duration
	QueryTimeout               time.Duration
	ShutdownTimeout            time.Duration
	OutboxPollInterval         time.Duration
	OutboxBatchSize            int
	ShareSlugLength            int
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	loadedConfig := Config{
		AppEnvironment:             get("APP_ENV", "development"),
		PublicWebURL:               get("PUBLIC_WEB_URL", "http://localhost:41300/ocean"),
		DatabaseURL:                get("DATABASE_URL", ""),
		DatabaseDirectURL:          get("DATABASE_DIRECT_URL", ""),
		DatabaseMaximumConnections: getInt("DATABASE_MAX_CONNS", defaultDatabaseMaximumConnections),
		NATSURL:                    get("NATS_URL", "nats://localhost:4222"),
		NATSUsername:               get("NATS_USERNAME", ""),
		NATSPassword:               get("NATS_PASSWORD", ""),
		NATSCredentialsFile:        get("NATS_CREDENTIALS", ""),
		ConsumerAckWait:            getDuration("NATS_ACK_WAIT", defaultConsumerAckWait),
		ConsumerMaximumDeliveries:  getInt("NATS_MAX_DELIVER", defaultConsumerMaximumDeliveries),
		ConsumerFetchBatchSize:     getInt("NATS_FETCH_BATCH_SIZE", defaultConsumerFetchBatchSize),
		ConsumerFetchMaximumWait:   getDuration("NATS_FETCH_MAX_WAIT", defaultConsumerFetchMaximumWait),
		ConsumerRetryDelay:         getDuration("NATS_RETRY_DELAY", defaultConsumerRetryDelay),
		NATSConnectTimeout:         getDuration("NATS_CONNECT_TIMEOUT", defaultNATSConnectTimeout),
		NATSReconnectWait:          getDuration("NATS_RECONNECT_WAIT", defaultNATSReconnectWait),
		NATSPublishTimeout:         getDuration("NATS_PUBLISH_TIMEOUT", defaultNATSPublishTimeout),
		QueryTimeout:               getDuration("NATS_QUERY_TIMEOUT", defaultQueryTimeout),
		ShutdownTimeout:            getDuration("SERVICE_SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
		OutboxPollInterval:         getDuration("OUTBOX_POLL_INTERVAL", defaultOutboxPollInterval),
		OutboxBatchSize:            getInt("OUTBOX_BATCH_SIZE", defaultOutboxBatchSize),
		ShareSlugLength:            getInt("SHARE_SLUG_LENGTH", defaultShareSlugLength),
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
	if loadedConfig.DatabaseMaximumConnections <= 0 || loadedConfig.ConsumerAckWait <= 0 || loadedConfig.ConsumerMaximumDeliveries <= 0 || loadedConfig.ConsumerFetchBatchSize <= 0 {
		return errors.New("database and consumer limits must be positive")
	}
	if loadedConfig.ConsumerFetchMaximumWait <= 0 || loadedConfig.ConsumerRetryDelay <= 0 || loadedConfig.NATSConnectTimeout <= 0 || loadedConfig.NATSReconnectWait <= 0 || loadedConfig.NATSPublishTimeout <= 0 {
		return errors.New("NATS timing values must be positive")
	}
	if loadedConfig.QueryTimeout <= 0 || loadedConfig.ShutdownTimeout <= 0 || loadedConfig.OutboxPollInterval <= 0 || loadedConfig.OutboxBatchSize <= 0 || loadedConfig.ShareSlugLength <= 0 {
		return errors.New("query, shutdown, outbox, and share values must be positive")
	}
	return nil
}

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
