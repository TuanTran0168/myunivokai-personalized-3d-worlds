package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

type fakeBroker struct {
	mutex             sync.Mutex
	publishedEnvelope contracts.Envelope[contracts.GenerateDNAData]
	requestedSubject  string
	requestedSubjects []string
	response          contracts.Envelope[contracts.RPCResponseData]
	// responsesBySubject lets a test answer two different NATS subjects
	// differently in one request (e.g. RequireAdminPermission's
	// AuthAccountPermissionsQuerySubject vs. the route's own subject) — a
	// subject missing from this map falls back to `response`, so every
	// existing single-response test keeps working unchanged.
	responsesBySubject map[string]contracts.Envelope[contracts.RPCResponseData]
	publishError       error
	requestError       error
	pingError          error
}

func (brokerClient *fakeBroker) PublishGeneration(_ context.Context, envelope contracts.Envelope[contracts.GenerateDNAData]) error {
	brokerClient.mutex.Lock()
	defer brokerClient.mutex.Unlock()
	brokerClient.publishedEnvelope = envelope
	return brokerClient.publishError
}

func (brokerClient *fakeBroker) Request(_ context.Context, subject string, _ any) (contracts.Envelope[contracts.RPCResponseData], error) {
	brokerClient.mutex.Lock()
	defer brokerClient.mutex.Unlock()
	brokerClient.requestedSubject = subject
	brokerClient.requestedSubjects = append(brokerClient.requestedSubjects, subject)
	if response, found := brokerClient.responsesBySubject[subject]; found {
		return response, brokerClient.requestError
	}
	return brokerClient.response, brokerClient.requestError
}

func (brokerClient *fakeBroker) Ping(context.Context) error { return brokerClient.pingError }
func (brokerClient *fakeBroker) Close()                     {}

type fakeEdgeStore struct {
	mutex         sync.Mutex
	values        map[string][]byte
	timeToLives   map[string]time.Duration
	deleteCounts  map[string]int
	pingError     error
	tokenVersions map[string]int
	// getError makes every cache read fail with something other than a miss,
	// which is how a Redis outage looks from the gateway - a case the cache
	// hit-rate counters have to treat differently from a miss.
	getError error

	wakeStats      map[string]edge.ServiceWakeStats
	wakeStatsError error
}

func newFakeEdgeStore() *fakeEdgeStore {
	return &fakeEdgeStore{
		values: make(map[string][]byte), timeToLives: make(map[string]time.Duration),
		deleteCounts: make(map[string]int), tokenVersions: make(map[string]int),
	}
}

func (store *fakeEdgeStore) GetTokenVersion(_ context.Context, accountID string) (int, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	tokenVersion, found := store.tokenVersions[accountID]
	if !found {
		return 0, edge.ErrCacheMiss
	}
	return tokenVersion, nil
}

func (store *fakeEdgeStore) SetTokenVersion(_ context.Context, accountID string, tokenVersion int, _ time.Duration) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.tokenVersions[accountID] = tokenVersion
	return nil
}

func (store *fakeEdgeStore) Allow(context.Context, string, string, float64, int) (bool, time.Duration, error) {
	return true, 0, nil
}

func (store *fakeEdgeStore) Get(_ context.Context, namespace, identifier string) ([]byte, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	if store.getError != nil {
		return nil, store.getError
	}
	payload, found := store.values[namespace+":"+identifier]
	if !found {
		return nil, edge.ErrCacheMiss
	}
	return append([]byte(nil), payload...), nil
}

func (store *fakeEdgeStore) Set(_ context.Context, namespace, identifier string, payload []byte, timeToLive time.Duration) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	key := namespace + ":" + identifier
	store.values[key] = append([]byte(nil), payload...)
	store.timeToLives[key] = timeToLive
	return nil
}

func (store *fakeEdgeStore) Delete(_ context.Context, namespace, identifier string) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	key := namespace + ":" + identifier
	delete(store.values, key)
	store.deleteCounts[key]++
	return nil
}

func (store *fakeEdgeStore) Ping(context.Context) error { return store.pingError }
func (store *fakeEdgeStore) Close() error               { return nil }

func (store *fakeEdgeStore) WakeStats(_ context.Context, services []string, _ time.Time, _ int) (map[string]edge.ServiceWakeStats, error) {
	if store.wakeStatsError != nil {
		return nil, store.wakeStatsError
	}
	stats := make(map[string]edge.ServiceWakeStats, len(services))
	for _, service := range services {
		stats[service] = store.wakeStats[service]
	}
	return stats, nil
}

func TestCreateWorldPublishesValidatedEnvelopeAndReturnsAcceptedJob(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON()))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("create status = %d, body=%s", response.Code, response.Body.String())
	}
	if brokerClient.publishedEnvelope.JobID == "" || brokerClient.publishedEnvelope.Timestamp.IsZero() {
		t.Fatalf("generation envelope is incomplete: %+v", brokerClient.publishedEnvelope)
	}
	if brokerClient.publishedEnvelope.Data.Family != contracts.WorldFamilyUniverse || brokerClient.publishedEnvelope.Data.Input.Nickname != "Nova" {
		t.Fatalf("unexpected generation data: %+v", brokerClient.publishedEnvelope.Data)
	}
	var job contracts.Job
	if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil {
		t.Fatal(err)
	}
	if job.JobID != brokerClient.publishedEnvelope.JobID || job.Status != contracts.JobStatusQueued {
		t.Fatalf("unexpected accepted job: %+v", job)
	}
}

func TestCreateWorldRejectsTrailingJSONBeforePublishing(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON()+` {}`)))
	if response.Code != http.StatusBadRequest || brokerClient.publishedEnvelope.JobID != "" {
		t.Fatalf("status=%d publishedJob=%q", response.Code, brokerClient.publishedEnvelope.JobID)
	}
}

func TestWorldQueryUsesFamilySpecificNATSSubject(t *testing.T) {
	worldID := "11111111-1111-4111-8111-111111111111"
	testCases := []struct {
		name            string
		path            string
		expectedSubject string
	}{
		{name: "universe", path: "/api/universe/worlds/" + worldID, expectedSubject: contracts.UniverseWorldGetQuerySubject},
		{name: "nature", path: "/api/nature/worlds/" + worldID, expectedSubject: contracts.NatureWorldGetQuerySubject},
		{name: "ocean", path: "/api/ocean/worlds/" + worldID, expectedSubject: contracts.OceanWorldGetQuerySubject},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			payload := json.RawMessage(`{"id":"` + worldID + `"}`)
			responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, json.RawMessage(payload))
			if err != nil {
				t.Fatal(err)
			}
			brokerClient := &fakeBroker{response: responseEnvelope}
			router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, testCase.path, nil))
			if response.Code != http.StatusOK || brokerClient.requestedSubject != testCase.expectedSubject {
				t.Fatalf("status=%d subject=%q body=%s", response.Code, brokerClient.requestedSubject, response.Body.String())
			}
		})
	}
}

func TestUnsupportedFamilyKeepsGatewayErrorContract(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	// Deliberately a family that does not exist and is not planned. This test
	// used "/api/ocean" until ocean-service shipped, at which point it started
	// failing — correctly, and loudly. Pick a name no roadmap mentions when the
	// next family arrives, rather than one that is merely unbuilt today.
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/tundra/worlds", nil))
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"WORLD_FAMILY_NOT_FOUND"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestWorldMutationInvalidatesCacheBeforeAndAfterSuccess(t *testing.T) {
	worldID := "11111111-1111-4111-8111-111111111111"
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusCreated, map[string]any{
		"variant": map[string]any{"id": "22222222-2222-4222-8222-222222222222"},
	})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: responseEnvelope}
	edgeStore := newFakeEdgeStore()
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds/"+worldID+"/variants", strings.NewReader(`{}`)))
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	cacheKey := worldCacheNamespace + ":" + edge.WorldCacheIdentifier(string(contracts.WorldFamilyUniverse), worldID)
	if edgeStore.deleteCounts[cacheKey] != 2 {
		t.Fatalf("cache delete count = %d, want 2", edgeStore.deleteCounts[cacheKey])
	}
}

// The share cache is keyed by slug while mutations arrive keyed by world id, so
// the slug travels back in the mutation response. Without this the share page
// served the previously selected variant for a whole TTL, which is how a
// seed-derived rare feature showed on the dashboard and vanished from the link.
func TestSelectingAVariantInvalidatesTheCachedShareResponse(t *testing.T) {
	worldID := "11111111-1111-4111-8111-111111111111"
	variantID := "22222222-2222-4222-8222-222222222222"
	shareSlug := "neo-4dfowlscib"
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{
		"variant":   map[string]any{"id": variantID},
		"shareSlug": shareSlug,
	})
	if err != nil {
		t.Fatal(err)
	}
	edgeStore := newFakeEdgeStore()
	shareCacheKey := shareCacheNamespace + ":" + edge.ShareCacheIdentifier(string(contracts.WorldFamilyUniverse), shareSlug)
	edgeStore.values[shareCacheKey] = []byte(`{"world":{"nickname":"Neo"}}`)
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, edgeStore, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds/"+worldID+"/variants/"+variantID+"/select", strings.NewReader(`{}`)))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, stillCached := edgeStore.values[shareCacheKey]; stillCached {
		t.Fatal("share response is still cached after the selected variant changed")
	}
	if edgeStore.deleteCounts[shareCacheKey] != 1 {
		t.Fatalf("share cache delete count = %d, want 1", edgeStore.deleteCounts[shareCacheKey])
	}
}

// An unpublished world has no share page, and a mutation on it must not fire a
// delete against a slug-shaped key built from an empty string.
func TestMutatingAnUnpublishedWorldTouchesNoShareCacheKey(t *testing.T) {
	worldID := "11111111-1111-4111-8111-111111111111"
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusCreated, map[string]any{
		"variant": map[string]any{"id": "22222222-2222-4222-8222-222222222222"},
	})
	if err != nil {
		t.Fatal(err)
	}
	edgeStore := newFakeEdgeStore()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, edgeStore, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds/"+worldID+"/variants", strings.NewReader(`{}`)))
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	for key := range edgeStore.deleteCounts {
		if strings.HasPrefix(key, shareCacheNamespace+":") {
			t.Fatalf("unexpected share cache delete for key %q", key)
		}
	}
}

// Publishing already returns the slug at the response root, so the same peek
// covers it: a republish of a world whose share was read moments earlier must not
// leave the pre-publish body in place.
func TestPublishingInvalidatesTheCachedShareResponse(t *testing.T) {
	worldID := "11111111-1111-4111-8111-111111111111"
	shareSlug := "neo-64x3rcsu3a"
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{
		"shareSlug": shareSlug,
		"shareUrl":  "http://localhost/universe/share/worlds/" + shareSlug,
	})
	if err != nil {
		t.Fatal(err)
	}
	edgeStore := newFakeEdgeStore()
	shareCacheKey := shareCacheNamespace + ":" + edge.ShareCacheIdentifier(string(contracts.WorldFamilyNature), shareSlug)
	edgeStore.values[shareCacheKey] = []byte(`{"world":{"nickname":"Neo"}}`)
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, edgeStore, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/nature/worlds/"+worldID+"/publish", strings.NewReader(`{}`)))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, stillCached := edgeStore.values[shareCacheKey]; stillCached {
		t.Fatal("share response is still cached after publish")
	}
}

func TestActiveJobUsesShortCacheTTL(t *testing.T) {
	job := contracts.Job{JobID: "job-1", Family: contracts.WorldFamilyNature, Status: contracts.JobStatusProcessing, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, job)
	if err != nil {
		t.Fatal(err)
	}
	store := newFakeEdgeStore()
	router := NewRouter(testGatewayConfig(), &fakeBroker{response: responseEnvelope}, store, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/jobs/job-1", nil))
	if response.Code != http.StatusOK || store.timeToLives[jobCacheNamespace+":job-1"] != activeJobCacheTTL {
		t.Fatalf("status=%d ttl=%s", response.Code, store.timeToLives[jobCacheNamespace+":job-1"])
	}
}

func TestReadinessReportsNATSAndRedisFailures(t *testing.T) {
	brokerClient := &fakeBroker{pingError: errors.New("nats unavailable")}
	store := newFakeEdgeStore()
	store.pingError = errors.New("redis unavailable")
	router := NewRouter(testGatewayConfig(), brokerClient, store, nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"nats":"unavailable"`) || !strings.Contains(response.Body.String(), `"redis":"unavailable"`) {
		t.Fatalf("readiness=%d body=%s", response.Code, response.Body.String())
	}
}

func TestGatewayRejectsOversizedBodyBeforePublishing(t *testing.T) {
	serviceConfig := testGatewayConfig()
	serviceConfig.MaximumRequestBodyBytes = 4
	brokerClient := &fakeBroker{}
	router := NewRouter(serviceConfig, brokerClient, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader("12345")))
	if response.Code != http.StatusRequestEntityTooLarge || brokerClient.publishedEnvelope.JobID != "" {
		t.Fatalf("status=%d publishedJob=%q", response.Code, brokerClient.publishedEnvelope.JobID)
	}
}

func TestGatewayCORSIsOwnedAtPublicEdge(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodOptions, "/api/universe/worlds", nil)
	request.Header.Set("Origin", "http://localhost:41300")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:41300" {
		t.Fatalf("preflight status=%d origin=%q", response.Code, response.Header().Get("Access-Control-Allow-Origin"))
	}
}

func testGatewayConfig() config.Config {
	return config.Config{
		AppEnvironment: "test", AppName: "Gateway Test", AllowedOrigins: []string{"http://localhost:41300"},
		RateLimitRequestsPerSecond: 1000, RateLimitBurst: 1000, MaximumRequestBodyBytes: 64 * 1024,
		NATSPublishTimeout: time.Second, NATSRequestTimeout: time.Second, JobCacheTimeToLive: time.Minute,
		WorldCacheTimeToLive: time.Minute, ShareCacheTimeToLive: time.Minute,
	}
}

func validWorldInputJSON() string {
	return worldInputJSONWithStyle("nebula")
}

// The world style is the one field whose vocabulary is per family, so a body
// posted to /api/nature/worlds cannot carry a universe style. Every other field
// is family-agnostic.
func worldInputJSONWithStyle(style string) string {
	return `{"nickname":" Nova ","role":"Builder","interests":["AI","music","space"],"traits":["curious","calm","focused"],"goal":"Build a meaningful creative universe","mood":"curious","favoriteColors":["#8B5CF6"],"preferredWorldStyle":"` + style + `"}`
}
