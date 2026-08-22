package config

import (
	"crypto/ed25519"
	"encoding/base64"
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
	defaultAccessTokenTTL             = 10 * time.Minute
	defaultRefreshTokenTTL            = 14 * 24 * time.Hour
	defaultTokenVersionCacheTTL       = 15 * 24 * time.Hour
	defaultInviteTokenTTL             = 7 * 24 * time.Hour
	defaultArgon2MemoryKiB            = 19 * 1024
	defaultArgon2Iterations           = 2
	defaultArgon2Parallelism          = 1
	defaultArgon2SaltLength           = 16
	defaultArgon2KeyLength            = 32
	defaultMaximumFailedAttempts      = 5
	defaultLockoutDuration            = 15 * time.Minute
)

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
	RedisURL                   string
	RedisKeyPrefix             string
	AccessTokenPrivateKey      ed25519.PrivateKey
	AccessTokenTTL             time.Duration
	RefreshTokenTTL            time.Duration
	TokenVersionCacheTTL       time.Duration
	InviteTokenTTL             time.Duration
	Argon2MemoryKiB            uint32
	Argon2Iterations           uint32
	Argon2Parallelism          uint8
	Argon2SaltLength           uint32
	Argon2KeyLength            uint32
	MaximumFailedAttempts      int
	LockoutDuration            time.Duration
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	accessTokenPrivateKey, err := decodeEd25519Seed(get("AUTH_ACCESS_PRIVATE_KEY", ""))
	if err != nil {
		return Config{}, err
	}
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
		RedisURL:                   get("REDIS_URL", ""),
		RedisKeyPrefix:             get("REDIS_KEY_PREFIX", "myunivokai"),
		AccessTokenPrivateKey:      accessTokenPrivateKey,
		AccessTokenTTL:             getDuration("AUTH_ACCESS_TOKEN_TTL", defaultAccessTokenTTL),
		RefreshTokenTTL:            getDuration("AUTH_REFRESH_TOKEN_TTL", defaultRefreshTokenTTL),
		TokenVersionCacheTTL:       getDuration("AUTH_TOKEN_VERSION_CACHE_TTL", defaultTokenVersionCacheTTL),
		InviteTokenTTL:             getDuration("AUTH_INVITE_TOKEN_TTL", defaultInviteTokenTTL),
		Argon2MemoryKiB:            uint32(getInt("AUTH_ARGON2_MEMORY_KIB", defaultArgon2MemoryKiB)),
		Argon2Iterations:           uint32(getInt("AUTH_ARGON2_ITERATIONS", defaultArgon2Iterations)),
		Argon2Parallelism:          uint8(getInt("AUTH_ARGON2_PARALLELISM", defaultArgon2Parallelism)),
		Argon2SaltLength:           uint32(getInt("AUTH_ARGON2_SALT_LENGTH", defaultArgon2SaltLength)),
		Argon2KeyLength:            uint32(getInt("AUTH_ARGON2_KEY_LENGTH", defaultArgon2KeyLength)),
		MaximumFailedAttempts:      getInt("AUTH_MAX_FAILED_ATTEMPTS", defaultMaximumFailedAttempts),
		LockoutDuration:            getDuration("AUTH_LOCKOUT_DURATION", defaultLockoutDuration),
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
	if strings.TrimSpace(loadedConfig.RedisURL) == "" {
		return errors.New("REDIS_URL is required")
	}
	if len(loadedConfig.AccessTokenPrivateKey) != ed25519.PrivateKeySize {
		return errors.New("AUTH_ACCESS_PRIVATE_KEY must decode to a 32-byte Ed25519 seed")
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
	if loadedConfig.AccessTokenTTL <= 0 || loadedConfig.RefreshTokenTTL <= 0 || loadedConfig.TokenVersionCacheTTL <= 0 || loadedConfig.InviteTokenTTL <= 0 {
		return errors.New("token lifetimes must be positive")
	}
	if loadedConfig.Argon2MemoryKiB == 0 || loadedConfig.Argon2Iterations == 0 || loadedConfig.Argon2Parallelism == 0 || loadedConfig.Argon2SaltLength == 0 || loadedConfig.Argon2KeyLength == 0 {
		return errors.New("Argon2id parameters must be positive")
	}
	if loadedConfig.MaximumFailedAttempts <= 0 || loadedConfig.LockoutDuration <= 0 {
		return errors.New("lockout parameters must be positive")
	}
	return nil
}

func decodeEd25519Seed(encodedSeed string) (ed25519.PrivateKey, error) {
	if strings.TrimSpace(encodedSeed) == "" {
		return nil, errors.New("AUTH_ACCESS_PRIVATE_KEY is required")
	}
	seed, err := base64.StdEncoding.DecodeString(encodedSeed)
	if err != nil {
		return nil, errors.New("AUTH_ACCESS_PRIVATE_KEY must be base64-encoded")
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("AUTH_ACCESS_PRIVATE_KEY must decode to a 32-byte Ed25519 seed")
	}
	return ed25519.NewKeyFromSeed(seed), nil
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
