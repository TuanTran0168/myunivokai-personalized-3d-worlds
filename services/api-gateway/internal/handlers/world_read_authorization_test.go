package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

const readAuthorizationTestWorldID = "44444444-4444-4444-8444-444444444444"

// poisonedCachedWorld is what a stranger would be handed if the by-id read ever
// consults the world cache again. It is deliberately not a world any fake
// service in this package answers with, so its presence in a response body can
// only mean one thing.
const poisonedCachedWorld = "somebody else's private world"

func worldReadResponse(t *testing.T) contracts.Envelope[contracts.RPCResponseData] {
	t.Helper()
	response, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{
		"world": map[string]any{"id": readAuthorizationTestWorldID, "nickname": "Neo"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return response
}

// The gateway's half of the read-authorization fix: both world READS carry who
// is asking, from the verified token and from nowhere else.
//
// Written the same way TestEveryWorldMutationCarriesTheTokensAccount is, body
// and all, because the reason is identical. The family service's ownership
// check is worth exactly as much as this one assertion: if the caller could
// ever be taken from something the client says about itself, ownership would be
// a claim rather than a fact.
//
// What made this necessary is that these two routes used to sit OUTSIDE the
// identity middleware, under a comment explaining why the share route must —
// so `GET /worlds/{id}` answered 200 with no credentials at all, for a world
// that had an owner and had never been published.
func TestEveryWorldReadCarriesTheTokensAccount(t *testing.T) {
	reads := []struct {
		description string
		path        string
		subject     string
	}{
		{
			description: "one world by id",
			path:        "/api/universe/worlds/" + readAuthorizationTestWorldID,
			subject:     contracts.UniverseWorldGetQuerySubject,
		},
		{
			description: "the gallery's batch",
			path:        "/api/universe/worlds?ids=" + readAuthorizationTestWorldID,
			subject:     contracts.UniverseWorldListQuerySubject,
		},
	}

	for _, read := range reads {
		t.Run(read.description, func(t *testing.T) {
			brokerClient := &fakeBroker{response: worldReadResponse(t)}
			edgeStore := newFakeEdgeStore()
			edgeStore.tokenVersions[ownershipTestAccountID] = 1
			router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

			// A body naming a different account, which must be ignored: a GET
			// decodes no body at all, and the id it sends comes from the token.
			request := httptest.NewRequest(http.MethodGet, read.path, strings.NewReader(`{"requestingAccountId":"somebody-else"}`))
			request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			sentAccountID := requestingAccountIDFromSentPayload(t, brokerClient, read.subject)
			if sentAccountID != ownershipTestAccountID {
				t.Fatalf("requesting account id = %q, want %q", sentAccountID, ownershipTestAccountID)
			}
		})
	}
}

// The half of the rule that keeps the product working, and the reason this fix
// could not simply require a session on the read.
//
// A visitor with no account reads worlds, and every world made before ownership
// existed is unowned. So a read with no session must still be answered — and it
// must send nil rather than an account invented from a cookie or an IP, because
// downstream nil means "no session" and an invented value would mean "the
// owner" of a world nobody owns.
func TestAWorldReadWithNoSessionCarriesNoAccount(t *testing.T) {
	brokerClient := &fakeBroker{response: worldReadResponse(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/universe/worlds/"+readAuthorizationTestWorldID, nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if sentAccountID := requestingAccountIDFromSentPayload(t, brokerClient, contracts.UniverseWorldGetQuerySubject); sentAccountID != "" {
		t.Fatalf("an anonymous read carried an account: %q", sentAccountID)
	}
}

// The ratchet on the second half of the fix, and the one most worth having,
// because the failure it guards is invisible from everywhere else.
//
// The world cache key is `family:worldID`, with no room for who asked. With an
// ownership check downstream and that key above it, the owner's own first read
// stores their private world under a name a stranger's request resolves to: the
// check holds for one request and Redis answers the next sixty seconds of them.
// Every ownership test still passes while that is true.
//
// So this asserts it from both ends. A poisoned entry sitting under exactly the
// key the old code wrote must never appear in a response, and two reads must
// produce two round trips — one round trip for two reads is the signature of
// the cache being back.
func TestTheByIdWorldReadIsNeverServedFromCache(t *testing.T) {
	brokerClient := &fakeBroker{response: worldReadResponse(t)}
	edgeStore := newFakeEdgeStore()
	edgeStore.values[worldCacheNamespace+":"+edge.WorldCacheIdentifier(string(contracts.WorldFamilyUniverse), readAuthorizationTestWorldID)] =
		[]byte(`{"world":{"nickname":"` + poisonedCachedWorld + `"}}`)
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	worldPath := "/api/universe/worlds/" + readAuthorizationTestWorldID
	for readNumber := 1; readNumber <= 2; readNumber++ {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, worldPath, nil))

		if response.Code != http.StatusOK {
			t.Fatalf("read %d: status=%d body=%s", readNumber, response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), poisonedCachedWorld) {
			t.Fatalf("read %d was answered from the world cache, so the ownership check downstream decides nothing", readNumber)
		}
		if cacheHeader := response.Header().Get("X-Cache"); cacheHeader != "" {
			t.Fatalf("read %d reported X-Cache=%q; a per-caller read must not be cached under a key that cannot name the caller", readNumber, cacheHeader)
		}
	}

	worldGetRequestCount := 0
	for _, subject := range brokerClient.requestedSubjects {
		if subject == contracts.UniverseWorldGetQuerySubject {
			worldGetRequestCount++
		}
	}
	if worldGetRequestCount != 2 {
		t.Fatalf("the world-get subject was asked %d time(s) for two reads, want 2", worldGetRequestCount)
	}
}
