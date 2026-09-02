package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	defaultAPIPort                    = "8080"
	defaultMaximumRequestBodyBytes    = 64 * 1024
	defaultRateLimitRequestsPerSecond = 2
	defaultRateLimitBurst             = 20
	defaultNATSPublishTimeout         = 5 * time.Second
	defaultNATSRequestTimeout         = 3 * time.Second
	defaultNATSConnectTimeout         = 5 * time.Second
	defaultNATSReconnectWait          = 2 * time.Second
	defaultJobCacheTimeToLive         = 30 * time.Second
	defaultWorldCacheTimeToLive       = 60 * time.Second
	defaultShareCacheTimeToLive       = 60 * time.Second
	defaultShutdownTimeout            = 15 * time.Second
	defaultRedisKeyPrefix             = "myunivokai"
	// A handful of staff, not the public internet, but each admin page load
	// fans out several analytics queries at once (S4-ANALYTICS-004) rather
	// than one request at a time, so this needs a higher ceiling than the
	// product default it used to copy verbatim.
	defaultAdminRateLimitRequestsPerSecond = 10
	defaultAdminRateLimitBurst             = 50

	// The identity endpoints get their own bucket, much tighter than the
	// product one, because the traffic is genuinely different: a person signs
	// in a handful of times a day, while the product group serves every world
	// read and variant regeneration. A shared bucket would have to be sized
	// for the second and would therefore not constrain the first at all.
	//
	// Batch-2 setting candidates rather than batch-1 (decision 20c scoped
	// batch 1 to auth-service's own values), so they stay environment
	// variables shaped exactly like the two buckets above.
	defaultAuthRateLimitRequestsPerSecond = 1
	defaultAuthRateLimitBurst             = 10

	// The per-email failure counter's two numbers (plan §5.5). They are Go
	// constants with no environment variable, because unlike a rate limit
	// they are not something an operator tunes under load - a higher ceiling
	// here does not relieve traffic, it only widens the window for a
	// distributed guess against one account.
	//
	// Deliberately looser than auth-service's own account lockout (5 attempts
	// / 15 minutes), which stays the last line: this counter exists to catch
	// the attempt spread across many addresses that the per-IP bucket cannot
	// see, so it must not fire before the lockout it backstops.
	identityFailureLimit  = 10
	identityFailureWindow = 15 * time.Minute
	// Matches auth-service's own AUTH_TOKEN_VERSION_CACHE_TTL default - the
	// two writers (auth-service on bump, the gateway on cache-miss fallback)
	// don't need to agree exactly, but starting from the same number is the
	// sane default until real usage says otherwise.
	// The revocation cache's TTL. Named for the admin surface in its
	// environment variable and no longer only about it: from S8-IDENTITY-002
	// the product edge checks the same cached tokenVersion on every request,
	// which is the fact that makes a 7-day product access token revocable at
	// all (plan section 4.4).
	defaultTokenVersionCacheTTL = 15 * 24 * time.Hour
	// Wake defaults. "none" mirrors AI_PROVIDER's "mock": the shipped
	// configuration reaches nobody's infrastructure until an operator opts
	// in, and it is also the permanently correct value on an always-on host.
	defaultServiceWakePlatform = "none"
	// Long enough to establish a connection - which is all that is needed to
	// trigger a start - and far short of a cold start, which no request-path
	// goroutine should wait for.
	defaultServiceWakeTimeout = 5 * time.Second
	// One burst of admin queries against a sleeping service should produce
	// one wake, not one per query. Roughly a cold start long.
	defaultServiceWakeLockTimeToLive = 60 * time.Second
	// What Retry-After advertises. A cold-start estimate, not a promise; the
	// client retries on a budget rather than trusting this number once.
	defaultServiceWakeRetryAfter = 15 * time.Second
	// One minute is B2's own figure and the one every downstream number is
	// sized against: at ~50 route templates and 4 status classes it is roughly
	// 200 rows per minute in the worst case, and it is short enough that a
	// chart of the last hour has 60 points rather than 6. Lowering it
	// multiplies rows without adding resolution anybody reads; raising it
	// makes a spike disappear into an average.
	defaultTelemetryFlushInterval = 60 * time.Second
)

// serviceWakeURLKeys maps each wakeable service to the variable holding its
// public base URL. The keys are wake.Service* values, spelled literally so
// this stays a leaf package that imports nothing of ours; a test asserts the
// two lists have not drifted apart.
var serviceWakeURLKeys = map[string]string{
	"dna":       "DNA_SERVICE_URL",
	"universe":  "UNIVERSE_SERVICE_URL",
	"nature":    "NATURE_SERVICE_URL",
	"ocean":     "OCEAN_SERVICE_URL",
	"auth":      "AUTH_SERVICE_URL",
	"analytics": "ANALYTICS_SERVICE_URL",
	"telemetry": "TELEMETRY_SERVICE_URL",
}

type Config struct {
	AppEnvironment             string
	AppName                    string
	APIHost                    string
	APIPort                    string
	AllowedOrigins             []string
	TrustProxyHeaders          bool
	MaximumRequestBodyBytes    int64
	RateLimitRequestsPerSecond float64
	RateLimitBurst             int
	NATSURL                    string
	NATSUsername               string
	NATSPassword               string
	NATSCredentialsFile        string
	NATSPublishTimeout         time.Duration
	NATSRequestTimeout         time.Duration
	NATSConnectTimeout         time.Duration
	NATSReconnectWait          time.Duration
	RedisURL                   string
	RedisKeyPrefix             string
	JobCacheTimeToLive         time.Duration
	WorldCacheTimeToLive       time.Duration
	ShareCacheTimeToLive       time.Duration
	ShutdownTimeout            time.Duration
	// AdminRoutesEnabled gates the whole /api/admin sub-router. Default false:
	// a fresh deploy of this binary must not crash-loop the product edge over
	// admin-only vars nobody has filled in yet, and the switch itself exists
	// so the admin surface can be taken offline without redeploying — see
	// agent-system/plans/services/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
	AdminRoutesEnabled              bool
	AdminAllowedOrigin              string
	AdminRateLimitRequestsPerSecond float64
	AdminRateLimitBurst             int
	AuthRateLimitRequestsPerSecond  float64
	AuthRateLimitBurst              int
	// AccessTokenPublicKeys holds every currently-accepted Ed25519 public key.
	//
	// Its environment variable is still ADMIN_ACCESS_PUBLIC_KEYS while the Go
	// field deliberately no longer says "admin": both edges verify with the
	// same key, because auth-service mints both audiences with one signing key
	// and the audience is a claim inside the token rather than a second key.
	// The variable keeps its name because it is a deployed secret in a Render
	// environment group and renaming it would be a coordinated rotation to buy
	// nothing; the field is renamed because a reader of the product edge would
	// otherwise believe it verifies with an admin-only key.
	// for verifying the admin access token locally (RequireAdminAccessToken) -
	// never the private key, which only auth-service ever holds. More than
	// one during a rotation drill: add the new key before removing the old
	// one so no session is force-logged-out - see
	// agent-system/plans/services/auth-and-admin-plan.md#tokens.
	AccessTokenPublicKeys     []ed25519.PublicKey
	TokenVersionCacheTTL time.Duration
	// ServiceWakePlatform names the hosting mechanism used to start a
	// sleeping instance - see internal/wake. "none" disables waking
	// entirely, which is both the default and the correct setting on any
	// host whose instances do not sleep, so leaving free tier is a config
	// change rather than a code change.
	ServiceWakePlatform string
	// ServiceWakeTargets holds only the services an operator actually
	// supplied a URL for. A missing entry is not an error: it means that
	// service is not wakeable here, and the gateway keeps answering plain
	// SERVICE_UNAVAILABLE for it instead of promising a wake that will not
	// happen.
	ServiceWakeTargets        map[string]string
	ServiceWakeTimeout        time.Duration
	ServiceWakeLockTimeToLive time.Duration
	ServiceWakeRetryAfter     time.Duration
	// TelemetryEnabled gates the whole rollup path. Default false, and that
	// default is load-bearing rather than cautious: with it off no middleware
	// is registered, no collector exists, no ticker runs and nothing is
	// published, so a deploy of this binary behaves exactly as the one before
	// it did. Turning it on is the only way any of internal/telemetry runs.
	TelemetryEnabled bool
	// TelemetryFlushInterval is how much traffic one published envelope
	// summarises. It also becomes the bucket width every chart is drawn at,
	// so changing it changes the resolution of history already stored, not
	// only of history still to come.
	TelemetryFlushInterval time.Duration
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	loadedConfig := Config{
		AppEnvironment:             get("APP_ENV", "development"),
		AppName:                    get("APP_NAME", "Myunivokai API Gateway"),
		APIHost:                    get("API_HOST", "0.0.0.0"),
		APIPort:                    getAny([]string{"API_PORT", "PORT"}, defaultAPIPort),
		AllowedOrigins:             split(get("API_ALLOWED_ORIGINS", "http://localhost:41300")),
		TrustProxyHeaders:          getBool("TRUST_PROXY", false),
		MaximumRequestBodyBytes:    getInt64("MAX_REQUEST_BODY_BYTES", defaultMaximumRequestBodyBytes),
		RateLimitRequestsPerSecond: getFloat("RATE_LIMIT_REQUESTS_PER_SECOND", defaultRateLimitRequestsPerSecond),
		RateLimitBurst:             getInt("RATE_LIMIT_BURST", defaultRateLimitBurst),
		NATSURL:                    get("NATS_URL", "nats://localhost:4222"),
		NATSUsername:               get("NATS_USERNAME", ""),
		NATSPassword:               get("NATS_PASSWORD", ""),
		NATSCredentialsFile:        get("NATS_CREDENTIALS", ""),
		NATSPublishTimeout:         getDuration("NATS_PUBLISH_TIMEOUT", defaultNATSPublishTimeout),
		NATSRequestTimeout:         getDuration("NATS_REQUEST_TIMEOUT", defaultNATSRequestTimeout),
		NATSConnectTimeout:         getDuration("NATS_CONNECT_TIMEOUT", defaultNATSConnectTimeout),
		NATSReconnectWait:          getDuration("NATS_RECONNECT_WAIT", defaultNATSReconnectWait),
		RedisURL:                   get("REDIS_URL", "redis://localhost:6379/0"),
		RedisKeyPrefix:             get("REDIS_KEY_PREFIX", defaultRedisKeyPrefix),
		JobCacheTimeToLive:         getDuration("JOB_CACHE_TTL", defaultJobCacheTimeToLive),
		WorldCacheTimeToLive:       getDuration("WORLD_CACHE_TTL", defaultWorldCacheTimeToLive),
		ShareCacheTimeToLive:       getDuration("SHARE_CACHE_TTL", defaultShareCacheTimeToLive),
		ShutdownTimeout:            getDuration("SERVICE_SHUTDOWN_TIMEOUT", defaultShutdownTimeout),

		AdminRoutesEnabled:              getBool("ADMIN_ROUTES_ENABLED", false),
		AdminAllowedOrigin:              get("ADMIN_ALLOWED_ORIGIN", ""),
		AdminRateLimitRequestsPerSecond: getFloat("ADMIN_RATE_LIMIT_REQUESTS_PER_SECOND", defaultAdminRateLimitRequestsPerSecond),
		AdminRateLimitBurst:             getInt("ADMIN_RATE_LIMIT_BURST", defaultAdminRateLimitBurst),
		AuthRateLimitRequestsPerSecond:  getFloat("AUTH_RATE_LIMIT_REQUESTS_PER_SECOND", defaultAuthRateLimitRequestsPerSecond),
		AuthRateLimitBurst:              getInt("AUTH_RATE_LIMIT_BURST", defaultAuthRateLimitBurst),
		TokenVersionCacheTTL:       getDuration("ADMIN_TOKEN_VERSION_CACHE_TTL", defaultTokenVersionCacheTTL),

		ServiceWakePlatform:       get("SERVICE_WAKE_PLATFORM", defaultServiceWakePlatform),
		ServiceWakeTimeout:        getDuration("SERVICE_WAKE_TIMEOUT", defaultServiceWakeTimeout),
		ServiceWakeLockTimeToLive: getDuration("SERVICE_WAKE_LOCK_TTL", defaultServiceWakeLockTimeToLive),
		ServiceWakeRetryAfter:     getDuration("SERVICE_WAKE_RETRY_AFTER", defaultServiceWakeRetryAfter),

		TelemetryEnabled:       getBool("TELEMETRY_ENABLED", false),
		TelemetryFlushInterval: getDuration("TELEMETRY_FLUSH_INTERVAL", defaultTelemetryFlushInterval),
	}
	accessTokenPublicKeys, err := decodeEd25519PublicKeys(get("ADMIN_ACCESS_PUBLIC_KEYS", ""))
	if err != nil {
		return Config{}, err
	}
	loadedConfig.AccessTokenPublicKeys = accessTokenPublicKeys
	serviceWakeTargets, err := readServiceWakeTargets()
	if err != nil {
		return Config{}, err
	}
	loadedConfig.ServiceWakeTargets = serviceWakeTargets
	if err := loadedConfig.Validate(); err != nil {
		return Config{}, err
	}
	return loadedConfig, nil
}

// decodeEd25519PublicKeys parses a comma-separated list of base64-standard-
// encoded 32-byte Ed25519 public keys - plural so a key-rotation drill can
// list both the new and the outgoing key at once (TokenVerifier accepts
// either until the old one is removed).
func decodeEd25519PublicKeys(commaSeparated string) ([]ed25519.PublicKey, error) {
	trimmed := strings.TrimSpace(commaSeparated)
	if trimmed == "" {
		return nil, nil
	}
	encodedKeys := strings.Split(trimmed, ",")
	publicKeys := make([]ed25519.PublicKey, 0, len(encodedKeys))
	for _, encodedKey := range encodedKeys {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
		if err != nil {
			return nil, errors.New("ADMIN_ACCESS_PUBLIC_KEYS must be base64-encoded")
		}
		if len(decoded) != ed25519.PublicKeySize {
			return nil, errors.New("ADMIN_ACCESS_PUBLIC_KEYS must decode to 32-byte Ed25519 public keys")
		}
		publicKeys = append(publicKeys, ed25519.PublicKey(decoded))
	}
	return publicKeys, nil
}

// readServiceWakeTargets collects the per-service base URLs a wake platform
// may need. Every value is validated here, at startup, for the reason the
// wake design doc gives: these are operator-supplied and never request-
// derived, so the only realistic failure is a typo - and a typo must stop the
// deploy rather than become an unexplained no-op at the one moment the wake
// was needed. Reusing validateOriginFormat also rules out a URL carrying a
// path, query or credentials, none of which belong in a service base URL.
func readServiceWakeTargets() (map[string]string, error) {
	targets := make(map[string]string)
	for service, environmentKey := range serviceWakeURLKeys {
		rawURL := get(environmentKey, "")
		if rawURL == "" {
			continue
		}
		if err := validateOriginFormat(rawURL); err != nil {
			return nil, fmt.Errorf("%s: %w", environmentKey, err)
		}
		targets[service] = rawURL
	}
	return targets, nil
}

func (loadedConfig Config) Validate() error {
	if len(loadedConfig.AllowedOrigins) == 0 {
		return errors.New("API_ALLOWED_ORIGINS must contain at least one origin")
	}
	if strings.TrimSpace(loadedConfig.NATSURL) == "" || strings.TrimSpace(loadedConfig.RedisURL) == "" {
		return errors.New("NATS_URL and REDIS_URL are required")
	}
	if loadedConfig.AuthRateLimitRequestsPerSecond <= 0 || loadedConfig.AuthRateLimitBurst <= 0 {
		return errors.New("auth rate limit parameters must be positive")
	}
	// The identity bucket must stay the tighter of the two, or the route group
	// it exists to constrain is policed more loosely than the one it was
	// separated from - which is worse than having no separate bucket, because
	// it reads as protection while removing it.
	if loadedConfig.AuthRateLimitRequestsPerSecond > loadedConfig.RateLimitRequestsPerSecond {
		return errors.New("AUTH_RATE_LIMIT_REQUESTS_PER_SECOND must not exceed RATE_LIMIT_REQUESTS_PER_SECOND")
	}
	if loadedConfig.MaximumRequestBodyBytes <= 0 || loadedConfig.RateLimitRequestsPerSecond <= 0 || loadedConfig.RateLimitBurst <= 0 {
		return errors.New("request body and rate limit values must be positive")
	}
	if loadedConfig.NATSPublishTimeout <= 0 || loadedConfig.NATSRequestTimeout <= 0 || loadedConfig.NATSConnectTimeout <= 0 || loadedConfig.NATSReconnectWait <= 0 || loadedConfig.ShutdownTimeout <= 0 {
		return errors.New("NATS and shutdown timeouts must be positive")
	}
	if loadedConfig.JobCacheTimeToLive <= 0 || loadedConfig.WorldCacheTimeToLive <= 0 || loadedConfig.ShareCacheTimeToLive <= 0 {
		return errors.New("cache TTL values must be positive")
	}
	if strings.TrimSpace(loadedConfig.RedisKeyPrefix) == "" {
		return errors.New("REDIS_KEY_PREFIX is required")
	}
	if loadedConfig.isProduction() {
		if !loadedConfig.TrustProxyHeaders {
			return errors.New("TRUST_PROXY must be true in production")
		}
		for _, origin := range loadedConfig.AllowedOrigins {
			if err := validateOriginFormat(origin); err != nil {
				return err
			}
		}
	}
	// Required unconditionally, unlike everything else in the admin block
	// below, because /api/auth and /api/me are NOT gated by
	// ADMIN_ROUTES_ENABLED: from Phase A the gateway always carries a
	// token-verifying edge. Without a key, RequireProductAccessToken rejects
	// every valid session with a 401 and nothing says why - a silent failure
	// this turns into a loud one at boot.
	//
	// Not a new burden on local development: .env.example ships
	// ADMIN_ROUTES_ENABLED=true, so the admin block below already demanded it.
	if len(loadedConfig.AccessTokenPublicKeys) == 0 {
		return errors.New("ADMIN_ACCESS_PUBLIC_KEYS is required: the gateway verifies every product and admin access token locally with it")
	}
	if loadedConfig.TokenVersionCacheTTL <= 0 {
		return errors.New("ADMIN_TOKEN_VERSION_CACHE_TTL must be positive")
	}
	if loadedConfig.AdminRoutesEnabled {
		// No wildcard is acceptable here at any point, dev included — the
		// admin origin check is unconditional, unlike the product group's
		// (which only tightens in production) — see
		// agent-system/plans/services/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
		if err := validateOriginFormat(loadedConfig.AdminAllowedOrigin); err != nil {
			return fmt.Errorf("ADMIN_ALLOWED_ORIGIN: %w", err)
		}
		if loadedConfig.AdminRateLimitRequestsPerSecond <= 0 || loadedConfig.AdminRateLimitBurst <= 0 {
			return errors.New("admin rate limit values must be positive")
		}
	}
	// Only meaningful once a platform is selected: with waking off these
	// values are never read, and demanding them would make every hand-built
	// Config carry three fields that do nothing. With waking on, a zero means
	// an unbounded wake goroutine, a single-flight lock that never expires, or
	// a Retry-After telling every client to come back immediately - which
	// would turn one sleeping service into a retry storm. Which platform names
	// are legal is internal/wake/factory's business, not this package's.
	if loadedConfig.serviceWakeConfigured() {
		if loadedConfig.ServiceWakeTimeout <= 0 || loadedConfig.ServiceWakeLockTimeToLive <= 0 || loadedConfig.ServiceWakeRetryAfter <= 0 {
			return errors.New("service wake timeout, lock TTL and retry-after must be positive")
		}
	}
	// Only meaningful once telemetry is switched on, for the same reason the
	// wake values above are. A zero interval would make time.NewTicker panic
	// at startup and a negative one would truncate every bucket start to the
	// same instant, which the consumer would read as one interval delivered
	// forever.
	if loadedConfig.TelemetryEnabled && loadedConfig.TelemetryFlushInterval <= 0 {
		return errors.New("TELEMETRY_FLUSH_INTERVAL must be positive when TELEMETRY_ENABLED is true")
	}
	return nil
}

// serviceWakeConfigured reports whether an operator asked for waking at all.
// An empty platform counts as "no" alongside the explicit "none" so that a
// Config built in code, rather than through Load, does not have to opt out of
// a feature it never opted into.
func (loadedConfig Config) serviceWakeConfigured() bool {
	platform := strings.TrimSpace(loadedConfig.ServiceWakePlatform)
	return platform != "" && platform != defaultServiceWakePlatform
}

func (loadedConfig Config) Address() string {
	return loadedConfig.APIHost + ":" + loadedConfig.APIPort
}

// IdentityFailureLimit and IdentityFailureWindow expose the per-email
// throttle's two constants as methods rather than fields, which is the whole
// point: a field would be assignable, and something assignable eventually
// gets an environment variable attached to it. See their declarations for why
// these two in particular are not operator dials.
func (loadedConfig Config) IdentityFailureLimit() int {
	return identityFailureLimit
}

func (loadedConfig Config) IdentityFailureWindow() time.Duration {
	return identityFailureWindow
}

// IsProduction reports whether cookies and other environment-sensitive
// behavior should use their hardened form (e.g. the admin session cookies'
// Secure attribute) rather than the dev-friendly default.
func (loadedConfig Config) IsProduction() bool {
	return loadedConfig.isProduction()
}

func (loadedConfig Config) isProduction() bool {
	normalizedEnvironment := strings.ToLower(strings.TrimSpace(loadedConfig.AppEnvironment))
	return normalizedEnvironment == "production" || normalizedEnvironment == "prod"
}

func validateOriginFormat(origin string) error {
	if strings.Contains(origin, "*") {
		return errors.New("wildcard CORS origins are not allowed")
	}
	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Host == "" || (parsedOrigin.Scheme != "http" && parsedOrigin.Scheme != "https") {
		return fmt.Errorf("CORS origin %q must be an absolute http or https origin", origin)
	}
	if parsedOrigin.User != nil || parsedOrigin.Path != "" || parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
		return fmt.Errorf("CORS origin %q must not contain credentials, a path, query, or fragment", origin)
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

func getAny(keys []string, fallback string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
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

func getInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(get(key, ""), 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func getFloat(key string, fallback float64) float64 {
	value, err := strconv.ParseFloat(get(key, ""), 64)
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

func getBool(key string, fallback bool) bool {
	value := strings.ToLower(get(key, ""))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}

func split(value string) []string {
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmedPart := strings.TrimSpace(part); trimmedPart != "" {
			values = append(values, trimmedPart)
		}
	}
	return values
}
