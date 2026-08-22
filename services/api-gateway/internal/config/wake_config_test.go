package config

import (
	"os"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

// serviceWakeURLKeys is spelled with literal service names so that this
// package imports none of ours. This test pays for that choice: a service
// added to wake.Services with no variable here would be configurable in name
// only, and a key here for a service that no longer exists would be a
// variable an operator can set that nothing ever reads.
func TestEveryWakeableServiceHasAnEnvironmentVariable(t *testing.T) {
	if len(serviceWakeURLKeys) != len(wake.Services) {
		t.Fatalf("serviceWakeURLKeys has %d entries, wake.Services has %d", len(serviceWakeURLKeys), len(wake.Services))
	}
	for _, service := range wake.Services {
		if serviceWakeURLKeys[service] == "" {
			t.Fatalf("wake.Services lists %q but no environment variable maps to it", service)
		}
	}
}

func TestServiceWakeTargetsOnlyIncludeWhatWasSupplied(t *testing.T) {
	t.Setenv("DNA_SERVICE_URL", "https://myunivokai-dna.onrender.com")
	t.Setenv("ANALYTICS_SERVICE_URL", "https://myunivokai-analytics.onrender.com")
	for _, key := range []string{"UNIVERSE_SERVICE_URL", "NATURE_SERVICE_URL", "AUTH_SERVICE_URL"} {
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unset %s: %v", key, err)
		}
	}
	targets, err := readServiceWakeTargets()
	if err != nil {
		t.Fatalf("readServiceWakeTargets returned %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("targets = %v, want only the two that were supplied", targets)
	}
	if targets[wake.ServiceDNA] != "https://myunivokai-dna.onrender.com" {
		t.Fatalf("dna target = %q", targets[wake.ServiceDNA])
	}
}

// A typo has to stop the deploy. The alternative is a wake that quietly never
// fires, discovered months later when someone wonders why a page still 503s.
func TestAMalformedServiceURLIsRejectedAtStartup(t *testing.T) {
	testCases := map[string]string{
		"not a URL":       "myunivokai-dna.onrender.com",
		"wrong scheme":    "ftp://myunivokai-dna.onrender.com",
		"carries a path":  "https://myunivokai-dna.onrender.com/healthz",
		"carries a query": "https://myunivokai-dna.onrender.com?x=1",
	}
	for name, rawURL := range testCases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("DNA_SERVICE_URL", rawURL)
			if _, err := readServiceWakeTargets(); err == nil {
				t.Fatalf("%q was accepted as a service URL", rawURL)
			}
		})
	}
}

func TestWakeDurationsAreOnlyRequiredWhenAPlatformIsSelected(t *testing.T) {
	serviceConfig := validTestConfig()
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("a config that never opted into waking was rejected: %v", err)
	}

	serviceConfig.ServiceWakePlatform = string(wake.PlatformHTTP)
	if err := serviceConfig.Validate(); err == nil {
		t.Fatal("waking was enabled with zero durations and accepted")
	}

	serviceConfig.ServiceWakeTimeout = 5 * time.Second
	serviceConfig.ServiceWakeLockTimeToLive = time.Minute
	serviceConfig.ServiceWakeRetryAfter = 15 * time.Second
	if err := serviceConfig.Validate(); err != nil {
		t.Fatalf("a fully configured wake was rejected: %v", err)
	}
}
