package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/telemetry"
)

const telemetryTestWorldID = "11111111-1111-4111-8111-111111111111"

func telemetrySnapshot(collector *telemetry.Collector) contracts.HTTPRollupData {
	return collector.Snapshot("test-instance", time.Now().UTC(), time.Minute)
}

func findHTTPBucket(data contracts.HTTPRollupData, routePattern string) (contracts.HTTPRollupBucket, bool) {
	for _, bucket := range data.Buckets {
		if bucket.RoutePattern == routePattern {
			return bucket, true
		}
	}
	return contracts.HTTPRollupBucket{}, false
}

// This is the rule the whole pipeline lives or dies on. A world id in a bucket
// key gives every world its own time series; the template gives the route one.
func TestTelemetryBucketsAreKeyedOnTheRouteTemplateNotThePath(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"world": map[string]any{"id": telemetryTestWorldID}})
	if err != nil {
		t.Fatal(err)
	}
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, newFakeEdgeStore(), nil, collector)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+telemetryTestWorldID, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	data := telemetrySnapshot(collector)
	bucket, found := findHTTPBucket(data, "/api/universe/worlds/{worldID}")
	if !found {
		t.Fatalf("no bucket keyed on the chi template; buckets were %+v", data.Buckets)
	}
	if bucket.Method != http.MethodGet || bucket.StatusClass != 2 || bucket.RequestCount != 1 {
		t.Fatalf("bucket = %+v, want one 2xx GET", bucket)
	}
	for _, anyBucket := range data.Buckets {
		if strings.Contains(anyBucket.RoutePattern, telemetryTestWorldID) {
			t.Fatalf("a world id reached a bucket key: %q", anyBucket.RoutePattern)
		}
	}
}

// A 404 sweep across random URLs is a routine event on a public gateway. One
// bucket per probed URL would be the unbounded growth this design exists to
// prevent, arriving through the one path that has no route to key on.
func TestUnmatchedRequestsCollapseIntoOneBucket(t *testing.T) {
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, collector)

	for _, path := range []string{"/wp-login.php", "/.env", "/admin/config.json"} {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}

	data := telemetrySnapshot(collector)
	bucket, found := findHTTPBucket(data, telemetry.UnmatchedRoutePattern)
	if !found {
		t.Fatalf("no unmatched bucket; buckets were %+v", data.Buckets)
	}
	if bucket.RequestCount != 3 {
		t.Fatalf("unmatched bucket counted %d requests, want 3", bucket.RequestCount)
	}
	if len(data.Buckets) != 1 {
		t.Fatalf("three probed URLs produced %d buckets, want 1: %+v", len(data.Buckets), data.Buckets)
	}
	if bucket.ErrorCodes["ROUTE_NOT_FOUND"] != 3 {
		t.Fatalf("error codes = %v, want three ROUTE_NOT_FOUND", bucket.ErrorCodes)
	}
}

// The error code is what makes the wake-conversion question answerable at all,
// and it is only reachable because WriteError leaves it on the request context
// for the middleware to read after the handler chain returns.
func TestTheGatewaysOwnErrorCodeReachesTheBucket(t *testing.T) {
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, collector)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(`{"nickname":"x"}`)))
	if response.Code < http.StatusBadRequest {
		t.Fatalf("expected the request to be rejected, got status %d", response.Code)
	}

	data := telemetrySnapshot(collector)
	bucket, found := findHTTPBucket(data, "/api/universe/worlds")
	if !found {
		t.Fatalf("no bucket for the create route; buckets were %+v", data.Buckets)
	}
	if len(bucket.ErrorCodes) == 0 {
		t.Fatal("the rejected request recorded no error code")
	}
}

func TestBackendRoundTripsAreBucketedByTheServiceTheSubjectNames(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"world": map[string]any{"id": telemetryTestWorldID}})
	if err != nil {
		t.Fatal(err)
	}
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, newFakeEdgeStore(), nil, collector)

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+telemetryTestWorldID, nil))

	data := telemetrySnapshot(collector)
	if len(data.NATSBackendBuckets) != 1 {
		t.Fatalf("backend buckets = %+v, want exactly one", data.NATSBackendBuckets)
	}
	if data.NATSBackendBuckets[0].Service != "universe" {
		t.Fatalf("backend bucket service = %q, want the service the subject names", data.NATSBackendBuckets[0].Service)
	}
	if data.NATSBackendBuckets[0].RequestCount != 1 || data.NATSBackendBuckets[0].ErrorCount != 0 {
		t.Fatalf("backend bucket = %+v, want one successful round trip", data.NATSBackendBuckets[0])
	}
}

// Whether the Redis cache is earning its keep has never been measurable. Both
// halves of the ratio have to come from the same call site or the denominator
// silently drifts.
func TestCacheHitsAndMissesAreBothCounted(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"world": map[string]any{"id": telemetryTestWorldID}})
	if err != nil {
		t.Fatal(err)
	}
	edgeStore := newFakeEdgeStore()
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, edgeStore, nil, collector)

	worldPath := "/api/universe/worlds/" + telemetryTestWorldID
	// The first read misses and populates the cache; the second one hits it.
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, worldPath, nil))
	cachedResponse := httptest.NewRecorder()
	router.ServeHTTP(cachedResponse, httptest.NewRequest(http.MethodGet, worldPath, nil))
	if cachedResponse.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("the second read was not served from cache: X-Cache=%q", cachedResponse.Header().Get("X-Cache"))
	}

	data := telemetrySnapshot(collector)
	if len(data.CacheBuckets) != 1 || data.CacheBuckets[0].Namespace != worldCacheNamespace {
		t.Fatalf("cache buckets = %+v, want one for %s", data.CacheBuckets, worldCacheNamespace)
	}
	if data.CacheBuckets[0].Hits != 1 || data.CacheBuckets[0].Misses != 1 {
		t.Fatalf("cache bucket = %+v, want one hit and one miss", data.CacheBuckets[0])
	}
}

// A Redis outage sends every request to the backend the same way a miss does,
// but folding it into the miss count would make an outage read as a cache that
// stopped working - two different problems with two different fixes.
func TestARedisFailureIsCountedAsNeitherAHitNorAMiss(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"world": map[string]any{"id": telemetryTestWorldID}})
	if err != nil {
		t.Fatal(err)
	}
	edgeStore := newFakeEdgeStore()
	edgeStore.getError = errors.New("redis: connection refused")
	collector := telemetry.NewCollector()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, edgeStore, nil, collector)

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+telemetryTestWorldID, nil))

	data := telemetrySnapshot(collector)
	if len(data.CacheBuckets) != 0 {
		t.Fatalf("a Redis failure produced cache counters: %+v", data.CacheBuckets)
	}
}

// With telemetry off the gateway must behave exactly as the build before this
// package existed: nothing installed, nothing recorded, nothing published.
func TestWithNoCollectorTheRequestPathRecordsNothing(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"world": map[string]any{"id": telemetryTestWorldID}})
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, newFakeEdgeStore(), nil, nil)

	withTelemetry := httptest.NewRecorder()
	router.ServeHTTP(withTelemetry, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+telemetryTestWorldID, nil))
	if withTelemetry.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", withTelemetry.Code, withTelemetry.Body.String())
	}

	collectorRouter := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, newFakeEdgeStore(), nil, telemetry.NewCollector())
	withCollector := httptest.NewRecorder()
	collectorRouter.ServeHTTP(withCollector, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+telemetryTestWorldID, nil))

	if withTelemetry.Code != withCollector.Code || withTelemetry.Body.String() != withCollector.Body.String() {
		t.Fatalf("telemetry changed the response: %d %s vs %d %s",
			withTelemetry.Code, withTelemetry.Body.String(), withCollector.Code, withCollector.Body.String())
	}
	if withTelemetry.Header().Get("X-Cache") != withCollector.Header().Get("X-Cache") {
		t.Fatal("telemetry changed the response headers")
	}
}
