package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

const worldListTestCursor = "MTc1NjkwMDAwMDAwMDAwMDAwMDoworldjob"

func worldListRequest(t *testing.T, accountIdentifier, queryString string) *http.Request {
	t.Helper()
	path := "/api/me/worlds"
	if queryString != "" {
		path += "?" + queryString
	}
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if accountIdentifier != "" {
		request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, accountIdentifier, contracts.AccountAudienceWeb))
	}
	return request
}

// A world list with no session is the one request this route must never
// answer: there is no account to list, so any answer at all would be somebody
// else's. The router-walking test in product_auth_router_test.go proves the
// middleware is attached; this proves what a caller sees.
func TestTheWorldListRefusesACallerWithNoSession(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, worldListRequest(t, "", ""))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
	}
}

// The whole of the authorisation model for this route: the owner comes off the
// verified token, so there is no request shape that asks for a stranger's
// worlds. A query string naming an account must change nothing.
func TestTheWorldListTakesItsOwnerFromTheTokenAndNotFromTheQueryString(t *testing.T) {
	const someoneElsesAccount = "99999999-9999-9999-9999-999999999999"
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, worldListRequest(t, ownershipTestAccountID, "ownerAccountId="+someoneElsesAccount))

	if response.Code == http.StatusUnauthorized {
		t.Fatalf("the signed-in request was refused; body=%s", response.Body.String())
	}
	publishedQuery := worldListQueryFromBroker(t, brokerClient)
	if publishedQuery.OwnerAccountID != ownershipTestAccountID {
		t.Fatalf("the query asked for %q, want the token's own subject %q", publishedQuery.OwnerAccountID, ownershipTestAccountID)
	}
	if strings.Contains(publishedQuery.OwnerAccountID, someoneElsesAccount) {
		t.Fatal("a query-string account reached dna-service")
	}
}

func TestTheWorldListRelaysItsCursorAndLimit(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, worldListRequest(t, ownershipTestAccountID, "cursor="+worldListTestCursor+"&limit=10"))
	if response.Code == http.StatusUnauthorized {
		t.Fatalf("the signed-in request was refused; body=%s", response.Body.String())
	}

	publishedQuery := worldListQueryFromBroker(t, brokerClient)
	if publishedQuery.Cursor != worldListTestCursor {
		t.Fatalf("cursor = %q, want %q", publishedQuery.Cursor, worldListTestCursor)
	}
	if publishedQuery.Limit != 10 {
		t.Fatalf("limit = %d, want 10", publishedQuery.Limit)
	}
}

// A limit that is not a number is refused, while one that is merely too large
// is clamped by the contract. The difference is that the first has no honest
// answer and the second has an obvious one.
func TestAnUnreadableLimitIsRefusedAndAnOversizedOneIsNot(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	unreadableResponse := httptest.NewRecorder()
	router.ServeHTTP(unreadableResponse, worldListRequest(t, ownershipTestAccountID, "limit=lots"))
	if unreadableResponse.Code != http.StatusBadRequest {
		t.Fatalf("limit=lots answered %d, want 400; body=%s", unreadableResponse.Code, unreadableResponse.Body.String())
	}

	oversizedResponse := httptest.NewRecorder()
	router.ServeHTTP(oversizedResponse, worldListRequest(t, ownershipTestAccountID, "limit=500"))
	if oversizedResponse.Code == http.StatusBadRequest {
		t.Fatalf("limit=500 was refused rather than clamped; body=%s", oversizedResponse.Body.String())
	}
	if publishedQuery := worldListQueryFromBroker(t, brokerClient); publishedQuery.PageSize() != contracts.MaximumLibraryPageSize {
		t.Fatalf("page size = %d, want the clamped maximum %d", publishedQuery.PageSize(), contracts.MaximumLibraryPageSize)
	}
}

// The collision product_auth_router_test.go predicted when this route did not
// exist yet: `GET /api/me/worlds` against the already-registered
// `GET /api/{family}/worlds`. chi prefers a static segment to a parameter one,
// but this asserts the outcome rather than the rule, because the cost of being
// wrong is that a signed-in visitor's gallery is answered by the nature family.
func TestTheWorldListIsNotAnsweredByTheFamilyWildcard(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, worldListRequest(t, ownershipTestAccountID, ""))

	if strings.Contains(response.Body.String(), "WORLD_FAMILY_NOT_FOUND") {
		t.Fatalf("/api/me/worlds was matched by the family wildcard; body=%s", response.Body.String())
	}
	if len(brokerClient.requestedSubjects) == 0 || brokerClient.requestedSubjects[0] != contracts.DNALibraryListQuerySubject {
		t.Fatalf("subjects asked = %q, want the library list subject first", brokerClient.requestedSubjects)
	}
}

// The claim and the list share a path prefix and differ in method and segment
// count. Asserted together, because the failure is silent: a POST answered by
// the list handler would return a page instead of claiming anything, and the
// visitor's worlds would stay anonymous with a 200 in the trace.
func TestTheWorldListAndTheClaimDoNotShadowEachOther(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	listResponse := httptest.NewRecorder()
	router.ServeHTTP(listResponse, worldListRequest(t, ownershipTestAccountID, ""))
	if listResponse.Code == http.StatusMethodNotAllowed || listResponse.Code == http.StatusNotFound {
		t.Fatalf("GET /api/me/worlds answered %d; body=%s", listResponse.Code, listResponse.Body.String())
	}

	// A GET at the claim's own path must not be answered by either: the claim
	// is a POST, and /worlds/claim is three segments.
	claimAsGetResponse := httptest.NewRecorder()
	claimRequest := httptest.NewRequest(http.MethodGet, "/api/me/worlds/claim", nil)
	claimRequest.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	router.ServeHTTP(claimAsGetResponse, claimRequest)
	if claimAsGetResponse.Code == http.StatusOK {
		t.Fatal("GET /api/me/worlds/claim was answered 200; the list handler is matching a path that is not its own")
	}
}

// dna-service holds this list and sleeps on a free tier. Without the wake, the
// first gallery opened after a quiet period waits for the request timeout and
// then reports a failure the visitor can do nothing about.
func TestTheWorldListWakesTheServiceThatHoldsIt(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	waker := newFakeWaker(wake.ServiceDNA)
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, waker, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, worldListRequest(t, ownershipTestAccountID, ""))
	if response.Code == http.StatusUnauthorized {
		t.Fatalf("the signed-in request was refused; body=%s", response.Body.String())
	}

	if !slices.Contains(waker.wokenServices(), wake.ServiceDNA) {
		t.Fatalf("dna-service was not woken for a world list; services woken = %q", waker.wokenServices())
	}
}

func worldListQueryFromBroker(t *testing.T, brokerClient *fakeBroker) contracts.LibraryListQueryData {
	t.Helper()
	payload, found := brokerClient.requestedPayloadsBySubject[contracts.DNALibraryListQuerySubject]
	if !found {
		t.Fatalf("nothing was published on %s; subjects asked = %q", contracts.DNALibraryListQuerySubject, brokerClient.requestedSubjects)
	}
	// The transport wraps a query in Envelope[any], so the payload comes back
	// as the envelope rather than as the query - the same two-step every other
	// handler test in this package does.
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("re-encode the published payload: %v", err)
	}
	var envelope contracts.Envelope[contracts.LibraryListQueryData]
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("decode the published query: %v", err)
	}
	return envelope.Data
}
