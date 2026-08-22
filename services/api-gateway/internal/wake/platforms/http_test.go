package platforms

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	if err := platform.Wake(context.Background(), wake.ServiceAnalytics); err != nil {
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
	if err := platform.Wake(context.Background(), wake.ServiceDNA); err != nil {
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
	if err := platform.Wake(context.Background(), wake.ServiceNature); err != nil {
		t.Fatalf("Wake treated a 502 from a booting instance as a failure: %v", err)
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
	if err := platform.Wake(context.Background(), wake.ServiceAnalytics); err == nil {
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
	if err := platform.Wake(context.Background(), wake.ServiceDNA); err != nil {
		t.Fatalf("the none platform returned %v; doing nothing is not a failure", err)
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
	if err := platform.Wake(context.Background(), wake.ServiceAuth); err == nil {
		t.Fatal("expected the client timeout to end the wake call")
	}
}
