package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

const deletedWorldShareSlug = "neo-64x3rcsu3a"

// S8-IDENTITY-010, and the story is explicit about why the test is written
// here rather than against the family service:
//
// **A test that bypasses the gateway passes while the bug ships**, because the
// bug IS the Redis entry. The family service filters the row correctly the
// moment the flag is set; what keeps a deleted world resolving at its public
// URL for up to a whole cache TTL is a response the gateway cached before the
// deletion and never dropped. That failure exists only where there is a warm
// cache and more than one reader, which is to say only in production.
//
// The share key is the one that needs the response path. It is keyed by SLUG,
// and the gateway cannot derive a slug from a world id - which is why the
// family service returns it in the deletion response, and why the invalidation
// is synchronous rather than driven by an event.
func TestDeletingAWorldDropsBothCachedResponsesThroughTheGateway(t *testing.T) {
	deletionResponse, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{
		"deleted":   true,
		"shareSlug": deletedWorldShareSlug,
	})
	if err != nil {
		t.Fatal(err)
	}

	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	worldCacheKey := worldCacheNamespace + ":" + edge.WorldCacheIdentifier(string(contracts.WorldFamilyUniverse), ownershipTestWorldID)
	shareCacheKey := shareCacheNamespace + ":" + edge.ShareCacheIdentifier(string(contracts.WorldFamilyUniverse), deletedWorldShareSlug)
	edgeStore.values[worldCacheKey] = []byte(`{"world":{"nickname":"Neo"}}`)
	edgeStore.values[shareCacheKey] = []byte(`{"world":{"nickname":"Neo"}}`)

	router := NewRouter(testGatewayConfig(), &fakeBroker{response: deletionResponse}, edgeStore, nil, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds/"+ownershipTestWorldID+"/delete", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, stillCached := edgeStore.values[worldCacheKey]; stillCached {
		t.Error("the world response is still cached after deletion, so the world keeps loading for up to a whole TTL")
	}
	if _, stillCached := edgeStore.values[shareCacheKey]; stillCached {
		t.Error("the share response is still cached after deletion, so a link the visitor already sent someone keeps resolving for up to a whole TTL")
	}
}

// Deletion carries the caller the same way every other mutation does, and is
// the only one where a nil is never enough - but the gateway does not decide
// that, the family service does. What the gateway must not do is let the body
// speak for the caller.
func TestDeletingCarriesTheTokensAccountAndNotTheBody(t *testing.T) {
	deletionResponse, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"deleted": true})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: deletionResponse}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds/"+ownershipTestWorldID+"/delete",
		strings.NewReader(`{"requestingAccountId":"somebody-else"}`))
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	sentAccountID := requestingAccountIDFromSentPayload(t, brokerClient, contracts.UniverseWorldDeleteSubject)
	if sentAccountID != ownershipTestAccountID {
		t.Fatalf("requesting account id = %q, want %q", sentAccountID, ownershipTestAccountID)
	}
}

// An unrecognised family answers the same way for delete as for every other
// world route. Registering the route on the supported families and forgetting
// the wildcard would answer 405 for a family that does not exist, which reads
// as "wrong method" rather than "no such family".
func TestDeletingInAnUnsupportedFamilyIsNotFound(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/desert/worlds/"+ownershipTestWorldID+"/delete", strings.NewReader(`{}`)))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404; body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "WORLD_FAMILY_NOT_FOUND") {
		t.Fatalf("body=%s, want WORLD_FAMILY_NOT_FOUND", response.Body.String())
	}
}
