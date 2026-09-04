package platforms

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

func TestHTTPWakeRequestsTheHealthRoute(t *testing.T) {
	requestedPaths := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		requestedPaths <- request.URL.Path
		responseWriter.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	platform := NewHTTP(map[string]string{wake.ServiceAnalytics: server.URL}, server.Client())
	if _, err := platform.Wake(context.Background(), wake.ServiceAnalytics); err != nil {
		t.Fatalf("Wake returned %v", err)
	}
	if path := <-requestedPaths; path != HealthPath {
		t.Fatalf("requested %q, want %q", path, HealthPath)
	}
}

// A base URL with a trailing slash is what an operator pastes out of a
// dashboard at least half the time; it must not produce a double slash.
func TestHTTPWakeNormalizesATrailingSlash(t *testing.T) {
	requestedPaths := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		requestedPaths <- request.URL.Path
	}))
	defer server.Close()

	platform := NewHTTP(map[string]string{wake.ServiceDNA: server.URL + "/"}, server.Client())
	if _, err := platform.Wake(context.Background(), wake.ServiceDNA); err != nil {
		t.Fatalf("Wake returned %v", err)
	}
	if path := <-requestedPaths; path != HealthPath {
		t.Fatalf("requested %q, want %q", path, HealthPath)
	}
}

// A booting instance can answer anything at all, or nothing; the wake happened
// when the connection arrived. Reading a verdict out of the status code would
// be reading readiness out of a start signal.
func TestHTTPWakeIgnoresTheResponseStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	platform := NewHTTP(map[string]string{wake.ServiceNature: server.URL}, server.Client())
	if _, err := platform.Wake(context.Background(), wake.ServiceNature); err != nil {
		t.Fatalf("Wake treated a 502 from a booting instance as a failure: %v", err)
	}
}

// Ignoring the status as a verdict is not the same as discarding it. Against
// production on 2026-09-04 the gateway logged four successful wake calls for a
// service that never started, because the only fact recorded was "no transport
// error" - which a host answering instantly and a host holding the request
// open for twelve seconds both satisfy. These three fields are what tell them
// apart.
func TestHTTPWakeReportsWhatItObserved(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusTeapot)
	}))
	defer server.Close()
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing the test server URL: %v", err)
	}

	platform := NewHTTP(map[string]string{wake.ServiceOcean: server.URL}, server.Client())
	observation, err := platform.Wake(context.Background(), wake.ServiceOcean)
	if err != nil {
		t.Fatalf("Wake returned %v", err)
	}
	if observation.StatusCode != http.StatusTeapot {
		t.Fatalf("observed status %d, want %d", observation.StatusCode, http.StatusTeapot)
	}
	if observation.Host != serverURL.Host {
		t.Fatalf("observed host %q, want %q", observation.Host, serverURL.Host)
	}
	if observation.Elapsed <= 0 {
		t.Fatal("observed a non-positive elapsed time; it is the field that separates a real wake from an instant refusal")
	}
}

func TestHTTPSupportsOnlyConfiguredServices(t *testing.T) {
	platform := NewHTTP(map[string]string{wake.ServiceDNA: "https://dna.example.com"}, http.DefaultClient)
	if !platform.Supports(wake.ServiceDNA) {
		t.Fatal("a configured service reported unsupported")
	}
	if platform.Supports(wake.ServiceAnalytics) {
		t.Fatal("an unconfigured service reported supported")
	}
	if _, err := platform.Wake(context.Background(), wake.ServiceAnalytics); err == nil {
		t.Fatal("waking an unconfigured service should report an error, not silently succeed")
	}
}

func TestHTTPPlatformName(t *testing.T) {
	if name := NewHTTP(nil, http.DefaultClient).Name(); name != wake.PlatformHTTP {
		t.Fatalf("Name() = %q, want %q", name, wake.PlatformHTTP)
	}
}

func TestNoneSupportsNothingAndReachesNobody(t *testing.T) {
	platform := NewNone()
	if platform.Name() != wake.PlatformNone {
		t.Fatalf("Name() = %q, want %q", platform.Name(), wake.PlatformNone)
	}
	for _, service := range wake.Services {
		if platform.Supports(service) {
			t.Fatalf("the none platform reported support for %q", service)
		}
	}
	observation, err := platform.Wake(context.Background(), wake.ServiceDNA)
	if err != nil {
		t.Fatalf("the none platform returned %v; doing nothing is not a failure", err)
	}
	if observation != (wake.WakeObservation{}) {
		t.Fatalf("the none platform observed %+v; it requests nothing, so it sees nothing", observation)
	}
}

// The client's timeout is what bounds a wake goroutine. A cold start outlasts
// it, so the adapter has to return rather than hold the goroutine open.
func TestHTTPWakeGivesUpOnASlowTarget(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	defer func() {
		close(release)
		server.Close()
	}()

	platform := NewHTTP(map[string]string{wake.ServiceAuth: server.URL}, &http.Client{Timeout: 50 * time.Millisecond})
	if _, err := platform.Wake(context.Background(), wake.ServiceAuth); err == nil {
		t.Fatal("expected the client timeout to end the wake call")
	}
}

// The error path is the one an operator most needs described, because a wake
// that exhausted a generous timeout and a wake that was refused immediately
// are opposite diagnoses arriving as the same non-nil error. Host and elapsed
// are therefore filled in before the error is returned, not after.
func TestHTTPWakeReportsWhatItObservedEvenWhenTheCallFails(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	defer func() {
		close(release)
		server.Close()
	}()
	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing the test server URL: %v", err)
	}

	const clientTimeout = 50 * time.Millisecond
	platform := NewHTTP(map[string]string{wake.ServiceAuth: server.URL}, &http.Client{Timeout: clientTimeout})
	observation, err := platform.Wake(context.Background(), wake.ServiceAuth)
	if err == nil {
		t.Fatal("expected the client timeout to end the wake call")
	}
	if observation.Host != serverURL.Host {
		t.Fatalf("observed host %q on the error path, want %q", observation.Host, serverURL.Host)
	}
	if observation.Elapsed < clientTimeout {
		t.Fatalf("observed elapsed %v, want at least the client timeout %v - a wake that ran out of its budget must be distinguishable from one refused instantly", observation.Elapsed, clientTimeout)
	}
	if observation.StatusCode != 0 {
		t.Fatalf("observed status %d with no response received, want 0", observation.StatusCode)
	}
}
