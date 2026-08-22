package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/telemetry"
)

func snapshotOf(collector *telemetry.Collector) contracts.HTTPRollupData {
	return collector.Snapshot("test-instance", time.Now().UTC(), time.Minute)
}

// A panicking handler never returns to anything nested inside Recover. This is
// the reason the router registers Telemetry outside it: from there, the panic
// has already been turned into a written 500 by the time the recording runs,
// so the one status class most worth seeing is the one that would otherwise be
// invisible.
func TestAPanickingHandlerIsStillCountedAsAServerError(t *testing.T) {
	collector := telemetry.NewCollector()
	router := chi.NewRouter()
	router.Use(Telemetry(collector))
	router.Use(Recover)
	router.Get("/api/universe/worlds/{worldID}", func(http.ResponseWriter, *http.Request) {
		panic("the handler exploded")
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/abc", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 from Recover", response.Code)
	}

	data := snapshotOf(collector)
	if len(data.Buckets) != 1 {
		t.Fatalf("buckets = %+v, want exactly one", data.Buckets)
	}
	bucket := data.Buckets[0]
	if bucket.StatusClass != 5 {
		t.Fatalf("status class = %d, want 5", bucket.StatusClass)
	}
	if bucket.RoutePattern != "/api/universe/worlds/{worldID}" {
		t.Fatalf("route pattern = %q, want the chi template", bucket.RoutePattern)
	}
	if bucket.ErrorCodes["INTERNAL_ERROR"] != 1 {
		t.Fatalf("error codes = %v, want one INTERNAL_ERROR", bucket.ErrorCodes)
	}
}

// A handler that never calls WriteHeader has served a 200, and the wrapper has
// to report that rather than a zero that StatusClassOf would round up to a
// server error.
func TestAHandlerThatNeverSetsAStatusIsCountedAsSuccess(t *testing.T) {
	collector := telemetry.NewCollector()
	router := chi.NewRouter()
	router.Use(Telemetry(collector))
	router.Get("/api/v1/healthz", func(responseWriter http.ResponseWriter, _ *http.Request) {
		_, _ = responseWriter.Write([]byte("ok"))
	})

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil))

	data := snapshotOf(collector)
	if data.Buckets[0].StatusClass != 2 {
		t.Fatalf("status class = %d, want 2", data.Buckets[0].StatusClass)
	}
}

func TestRoutePatternFallsBackToTheUnmatchedKey(t *testing.T) {
	collector := telemetry.NewCollector()
	router := chi.NewRouter()
	router.Use(Telemetry(collector))
	router.Get("/api/v1/healthz", func(http.ResponseWriter, *http.Request) {})

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/nothing/here", nil))

	data := snapshotOf(collector)
	if data.Buckets[0].RoutePattern != telemetry.UnmatchedRoutePattern {
		t.Fatalf("route pattern = %q, want %q", data.Buckets[0].RoutePattern, telemetry.UnmatchedRoutePattern)
	}
}

// The wrapper has to stay transparent to http.ResponseController, or anything
// reaching for Flush through the chain stops at this middleware.
func TestTheStatusWrapperStaysTransparentToTheResponseController(t *testing.T) {
	collector := telemetry.NewCollector()
	router := chi.NewRouter()
	router.Use(Telemetry(collector))
	var flushError error
	router.Get("/api/v1/healthz", func(responseWriter http.ResponseWriter, _ *http.Request) {
		_, _ = responseWriter.Write([]byte("ok"))
		flushError = http.NewResponseController(responseWriter).Flush()
	})

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil))

	if flushError != nil {
		t.Fatalf("Flush through the telemetry wrapper failed: %v", flushError)
	}
}
