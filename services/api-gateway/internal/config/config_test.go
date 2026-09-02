package config

import (
	"crypto/ed25519"
	"testing"
	"time"
)

var testAdminPublicKey, _, _ = ed25519.GenerateKey(nil)

func TestProductionValidationRequiresTrustedProxyAndExactOrigins(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AppEnvironment = "production"
	serviceConfig.TrustProxyHeaders = true
	serviceConfig.AllowedOrigins = []string{"https://web.example.com"}
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}

	serviceConfig.TrustProxyHeaders = false
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected untrusted production proxy configuration to be rejected")
	}
	serviceConfig.TrustProxyHeaders = true
	serviceConfig.AllowedOrigins = []string{"https://*.example.com"}
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected wildcard origin to be rejected")
	}
	serviceConfig.AllowedOrigins = []string{"https://web.example.com/path"}
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected origin path to be rejected")
	}
}

func TestValidationRequiresPositiveOperationalLimits(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.NATSRequestTimeout = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected zero NATS request timeout to be rejected")
	}

	serviceConfig = validTestConfig()
	serviceConfig.WorldCacheTimeToLive = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected zero world cache TTL to be rejected")
	}
}

// The identity bucket is required whether or not the admin surface is on,
// and must stay tighter than the product one - see the check's own comment
// for why a looser identity bucket is worse than no separate bucket at all.
func TestValidationRequiresATighterIdentityRateLimitThanTheProductOne(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AuthRateLimitRequestsPerSecond = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected a zero auth rate limit to be rejected")
	}

	serviceConfig = validTestConfig()
	serviceConfig.AuthRateLimitRequestsPerSecond = serviceConfig.RateLimitRequestsPerSecond + 1
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected an identity bucket looser than the product bucket to be rejected")
	}
}

// The verification key is the one thing the product edge cannot do without,
// and ADMIN_ROUTES_ENABLED does not gate /api/auth or /api/me. Missing it used
// to be a 401 on every valid session with nothing saying why.
func TestValidationRequiresTheAccessTokenPublicKeyEvenWithAdminRoutesOff(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AdminRoutesEnabled = false
	serviceConfig.AccessTokenPublicKeys = nil
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected a missing access-token public key to be rejected even with the admin routes disabled")
	}
}

func TestValidationSkipsAdminChecksWhenDisabled(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AdminRoutesEnabled = false
	serviceConfig.AdminAllowedOrigin = ""
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("admin routes disabled should skip admin validation: %v", err)
	}
}

func TestValidationRequiresANonWildcardAdminOriginWhenEnabled(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.AdminRoutesEnabled = true
	serviceConfig.AdminAllowedOrigin = ""
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected empty admin origin to be rejected when admin routes are enabled")
	}
	serviceConfig.AdminAllowedOrigin = "https://*.example.com"
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected wildcard admin origin to be rejected")
	}
	serviceConfig.AdminAllowedOrigin = "https://admin.example.com"
	serviceConfig.AdminRateLimitRequestsPerSecond = 0
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected zero admin rate limit to be rejected")
	}
	serviceConfig.AdminRateLimitRequestsPerSecond = 5
	serviceConfig.AdminRateLimitBurst = 20
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("valid admin config rejected: %v", err)
	}
}

// The flush interval is only validated once telemetry is switched on, for the
// same reason the wake values are: with telemetry off it is never read, and
// demanding it would make every hand-built Config carry a field that does
// nothing. With telemetry on, a zero makes time.NewTicker panic at startup.
func TestTelemetryFlushIntervalIsOnlyRequiredOnceTelemetryIsOn(t *testing.T) {
	serviceConfig := validTestConfig()
	serviceConfig.TelemetryEnabled = false
	serviceConfig.TelemetryFlushInterval = 0
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("a config with telemetry off must not be judged on a value it never reads: %v", err)
	}

	serviceConfig.TelemetryEnabled = true
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected a zero flush interval to be rejected once telemetry is enabled")
	}

	serviceConfig.TelemetryFlushInterval = -time.Minute
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("expected a negative flush interval to be rejected")
	}

	serviceConfig.TelemetryFlushInterval = time.Minute
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("valid telemetry config rejected: %v", err)
	}
}

func validTestConfig() Config {
	return Config{
		AppEnvironment:                 "test",
		AllowedOrigins:                 []string{"http://localhost:41300"},
		MaximumRequestBodyBytes:        64 * 1024,
		RateLimitRequestsPerSecond:     10,
		RateLimitBurst:                 20,
		AuthRateLimitRequestsPerSecond: 1,
		AuthRateLimitBurst:             10,
		NATSURL:                        "nats://localhost:4222",
		NATSPublishTimeout:             time.Second,
		NATSRequestTimeout:             time.Second,
		NATSConnectTimeout:             time.Second,
		NATSReconnectWait:              time.Second,
		RedisURL:                       "redis://localhost:6379/0",
		RedisKeyPrefix:                 "test",
		JobCacheTimeToLive:             time.Minute,
		WorldCacheTimeToLive:           time.Minute,
		ShareCacheTimeToLive:           time.Minute,
		ShutdownTimeout:                time.Second,
		AccessTokenPublicKeys:          []ed25519.PublicKey{testAdminPublicKey},
		TokenVersionCacheTTL:           time.Minute,
	}
}
