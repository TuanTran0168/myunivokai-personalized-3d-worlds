package factory

import (
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

func wakeConfig(platform string, targets map[string]string) config.Config {
	return config.Config{
		ServiceWakePlatform:       platform,
		ServiceWakeTargets:        targets,
		ServiceWakeTimeout:        5 * time.Second,
		ServiceWakeLockTimeToLive: time.Minute,
		ServiceWakeRetryAfter:     15 * time.Second,
	}
}

func TestTheDefaultPlatformSupportsNothing(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformNone), nil), nil, nil)
	if err != nil {
		t.Fatalf("the none platform should always build: %v", err)
	}
	for _, service := range wake.Services {
		if coordinator.Supports(service) {
			t.Fatalf("the none platform supports %q; it must reach nobody", service)
		}
	}
}

func TestTheHTTPPlatformSupportsOnlyTheServicesGivenAURL(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformHTTP), map[string]string{
		wake.ServiceAuth:      "https://myunivokai-auth.onrender.com",
		wake.ServiceAnalytics: "https://myunivokai-analytics.onrender.com",
	}), nil, nil)
	if err != nil {
		t.Fatalf("NewCoordinator returned %v", err)
	}
	for _, service := range []string{wake.ServiceAuth, wake.ServiceAnalytics} {
		if !coordinator.Supports(service) {
			t.Fatalf("%q was given a URL but is not supported", service)
		}
	}
	// dna/universe/nature were left unconfigured on purpose: a partly filled
	// deployment must not claim it can wake what it cannot reach, because the
	// gateway turns that claim into a SERVICE_WAKING the client retries on.
	for _, service := range []string{wake.ServiceDNA, wake.ServiceUniverse, wake.ServiceNature} {
		if coordinator.Supports(service) {
			t.Fatalf("%q has no URL but reported as supported", service)
		}
	}
}

// A typo must stop the deploy. Falling back to "none" would produce a gateway
// that silently never wakes anything and reports plain 503s for months.
func TestAnUnknownPlatformNameFails(t *testing.T) {
	if _, err := NewCoordinator(wakeConfig("renderr", nil), nil, nil); err == nil {
		t.Fatal("an unknown SERVICE_WAKE_PLATFORM was accepted")
	}
}

// Selecting the HTTP platform with no URL yet must start, and must wake
// nothing.
//
// This is the first deploy of a blueprint: the targets have to be the public
// URLs of services that this same deploy is creating, so they cannot be known
// in advance. Refusing to start there is a requirement the host makes
// impossible to meet, and it takes the whole product edge down with it - not
// just waking. The gateway serves traffic through the gap and says so in its
// startup log; cmd/gateway.logServiceWake is the other half of this.
func TestTheHTTPPlatformStartsBeforeAnyURLIsKnown(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformHTTP), nil), nil, nil)
	if err != nil {
		t.Fatalf("the http platform must start before its URLs exist, got %v", err)
	}
	if wakeable := coordinator.WakeableServices(); len(wakeable) != 0 {
		t.Fatalf("nothing is reachable yet, but the coordinator claims %v", wakeable)
	}
	// The claim matters more than the call: Supports is what makes the gateway
	// answer SERVICE_WAKING instead of SERVICE_UNAVAILABLE, and a client
	// retries the first one. Promising a wake it cannot deliver would send the
	// caller round a loop that never resolves.
	for _, service := range wake.Services {
		if coordinator.Supports(service) {
			t.Fatalf("%q has no URL but reported as supported", service)
		}
	}
}

// WakeableServices is what the startup log prints, so it has to describe the
// deploy rather than the intent: a half-filled blueprint is the normal state
// between the first sync and the second.
func TestWakeableServicesReportsOnlyWhatIsReachable(t *testing.T) {
	coordinator, err := NewCoordinator(wakeConfig(string(wake.PlatformHTTP), map[string]string{
		wake.ServiceDNA:  "https://myunivokai-dna.onrender.com",
		wake.ServiceAuth: "https://myunivokai-auth.onrender.com",
	}), nil, nil)
	if err != nil {
		t.Fatalf("NewCoordinator returned %v", err)
	}
	wakeable := coordinator.WakeableServices()
	expected := []string{wake.ServiceDNA, wake.ServiceAuth}
	if len(wakeable) != len(expected) {
		t.Fatalf("expected %v, got %v", expected, wakeable)
	}
	// Order follows wake.Services, not map iteration, so the startup log reads
	// the same on every boot.
	for index, service := range expected {
		if wakeable[index] != service {
			t.Fatalf("expected %v in the order of wake.Services, got %v", expected, wakeable)
		}
	}
}

func TestRetryAfterComesFromConfiguration(t *testing.T) {
	serviceConfig := wakeConfig(string(wake.PlatformNone), nil)
	serviceConfig.ServiceWakeRetryAfter = 20 * time.Second
	coordinator, err := NewCoordinator(serviceConfig, nil, nil)
	if err != nil {
		t.Fatalf("NewCoordinator returned %v", err)
	}
	if retryAfter := coordinator.RetryAfter(); retryAfter != 20*time.Second {
		t.Fatalf("RetryAfter() = %s, want 20s", retryAfter)
	}
}
