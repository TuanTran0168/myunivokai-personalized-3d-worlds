package wake

import (
	"context"
	"errors"
	"testing"
	"time"
)

// quietWindow is how long a negative assertion waits before concluding that
// no wake was fired. Wake is asynchronous by design, so "nothing happened"
// can only be observed by giving it a chance to happen first.
const quietWindow = 200 * time.Millisecond

type fakePlatform struct {
	supported map[string]bool
	woken     chan string
	wakeError error
}

func newFakePlatform(supported ...string) *fakePlatform {
	platform := &fakePlatform{supported: make(map[string]bool), woken: make(chan string, 8)}
	for _, service := range supported {
		platform.supported[service] = true
	}
	return platform
}

func (platform *fakePlatform) Name() PlatformName           { return PlatformName("fake") }
func (platform *fakePlatform) Supports(service string) bool { return platform.supported[service] }

func (platform *fakePlatform) Wake(_ context.Context, service string) error {
	platform.woken <- service
	return platform.wakeError
}

type fakeLock struct {
	acquired  chan string
	granted   bool
	lockError error
}

func newFakeLock(granted bool, lockError error) *fakeLock {
	return &fakeLock{acquired: make(chan string, 8), granted: granted, lockError: lockError}
}

func (lock *fakeLock) AcquireWakeLock(_ context.Context, service string, _ time.Duration) (bool, error) {
	lock.acquired <- service
	return lock.granted, lock.lockError
}

func waitForWake(t *testing.T, platform *fakePlatform) string {
	t.Helper()
	select {
	case service := <-platform.woken:
		return service
	case <-time.After(2 * time.Second):
		t.Fatal("expected a wake but none was fired")
		return ""
	}
}

func assertNoWake(t *testing.T, platform *fakePlatform) {
	t.Helper()
	select {
	case service := <-platform.woken:
		t.Fatalf("expected no wake, but %q was woken", service)
	case <-time.After(quietWindow):
	}
}

func TestWakeReachesTheConfiguredPlatform(t *testing.T) {
	platform := newFakePlatform(ServiceAnalytics)
	coordinator := NewCoordinator(platform, newFakeLock(true, nil), nil, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceAnalytics)
	if service := waitForWake(t, platform); service != ServiceAnalytics {
		t.Fatalf("woke %q, want %q", service, ServiceAnalytics)
	}
}

// A held lock means another request is already waking this service, so the
// second caller must stay quiet — that is the entire purpose of the lock.
func TestAHeldSingleFlightLockSuppressesTheWake(t *testing.T) {
	platform := newFakePlatform(ServiceAnalytics)
	coordinator := NewCoordinator(platform, newFakeLock(false, nil), nil, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceAnalytics)
	assertNoWake(t, platform)
}

// Deduplication is an optimisation; waking is the point. A Redis outage must
// therefore cost a redundant call, never a service that stays asleep.
func TestALockFailureStillWakes(t *testing.T) {
	platform := newFakePlatform(ServiceAuth)
	coordinator := NewCoordinator(platform, newFakeLock(false, errors.New("redis is down")), nil, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceAuth)
	if service := waitForWake(t, platform); service != ServiceAuth {
		t.Fatalf("woke %q, want %q", service, ServiceAuth)
	}
}

// An operator who supplied no URL for a service has not opted that service in.
// Waking it anyway would be an outbound call to an address nobody configured.
func TestAnUnsupportedServiceIsNeverWoken(t *testing.T) {
	platform := newFakePlatform(ServiceDNA)
	coordinator := NewCoordinator(platform, newFakeLock(true, nil), nil, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceAnalytics)
	assertNoWake(t, platform)
	if coordinator.Supports(ServiceAnalytics) {
		t.Fatal("Supports reported true for a service the platform does not support")
	}
}

func TestAnEmptyServiceNameIsNeverWoken(t *testing.T) {
	platform := newFakePlatform(ServiceDNA)
	coordinator := NewCoordinator(platform, newFakeLock(true, nil), nil, time.Second, time.Minute, time.Second)
	// This is what ServiceForSubject returns for a subject it cannot name, so
	// it reaches Wake in normal operation rather than only in a test.
	coordinator.Wake("")
	assertNoWake(t, platform)
}

// The gateway holds one coordinator whether or not waking is configured, so a
// nil one has to behave like a coordinator that supports nothing rather than
// panic on the request path.
func TestANilCoordinatorIsInert(t *testing.T) {
	var coordinator *Coordinator
	if coordinator.Supports(ServiceDNA) {
		t.Fatal("a nil coordinator reported that it supports a service")
	}
	if coordinator.RetryAfter() != 0 {
		t.Fatal("a nil coordinator returned a non-zero retry-after")
	}
	coordinator.Wake(ServiceDNA)
}

// A wake that fails is expected, not exceptional: a host that starts an
// instance on connect has already begun, and the boot outlasts our timeout.
// It must not panic or block the caller.
func TestAFailedWakeIsSurvivable(t *testing.T) {
	platform := newFakePlatform(ServiceNature)
	platform.wakeError = errors.New("context deadline exceeded")
	coordinator := NewCoordinator(platform, nil, nil, time.Second, time.Minute, time.Second)
	coordinator.Wake(ServiceNature)
	if service := waitForWake(t, platform); service != ServiceNature {
		t.Fatalf("woke %q, want %q", service, ServiceNature)
	}
}

func TestRetryAfterIsReportedForClients(t *testing.T) {
	coordinator := NewCoordinator(newFakePlatform(), nil, nil, time.Second, time.Minute, 42*time.Second)
	if retryAfter := coordinator.RetryAfter(); retryAfter != 42*time.Second {
		t.Fatalf("RetryAfter() = %s, want 42s", retryAfter)
	}
}
