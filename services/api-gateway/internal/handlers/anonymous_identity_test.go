package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

func anonymousCreateRequest(anonymousIdentifier string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON()))
	if anonymousIdentifier != "" {
		request.Header.Set("X-Anonymous-Id", anonymousIdentifier)
	}
	return request
}

// The anonymous id reaches the generate command, which is the only reason it
// exists: without it on the profile and world rows there is nothing for a
// signup to claim, and the visitor's first five worlds stay anonymous for ever.
func TestAnAnonymousCreateCarriesTheBrowsersAnonymousIdentifier(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, anonymousCreateRequest(claimTestAnonymousID))

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	published := brokerClient.publishedEnvelope.Data
	if published.AnonymousID == nil || *published.AnonymousID != claimTestAnonymousID {
		t.Fatalf("anonymous id on the command = %v, want %q", published.AnonymousID, claimTestAnonymousID)
	}
	if published.OwnerAccountID != nil {
		t.Errorf("an anonymous create published an owner: %q", *published.OwnerAccountID)
	}
}

// Exactly one of the two identity fields is ever set, and the header loses.
//
// A signed-in visitor still HAS an anonymous cookie — signing out does not
// clear it, deliberately, because it names worlds made before the account
// existed. So this case is the normal one, not an edge: the browser sends both,
// and the gateway must store the account. A world that has an owner can never
// be claimed, so an anonymous id beside one would be a personal-data trail with
// no reader at all.
func TestASignedInCreateDropsTheAnonymousIdentifier(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := anonymousCreateRequest(claimTestAnonymousID)
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	published := brokerClient.publishedEnvelope.Data
	if published.OwnerAccountID == nil || *published.OwnerAccountID != ownershipTestAccountID {
		t.Fatalf("owner = %v, want the token's subject", published.OwnerAccountID)
	}
	if published.AnonymousID != nil {
		t.Errorf("a signed-in create published anonymous id %q as well as an owner. Both set means one of them is a value nothing will ever read", *published.AnonymousID)
	}
}

// A create with no header at all is unchanged from before this shipped: a 202
// and a world with no identity. That is a browser with cookies disabled, and
// every non-browser caller.
//
// Its world is anonymous and unclaimable, which is decision 16's answer for
// every world already in production: nobody can prove they made it.
func TestACreateWithNoAnonymousIdentifierStillSucceeds(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, anonymousCreateRequest(""))

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	published := brokerClient.publishedEnvelope.Data
	if published.AnonymousID != nil || published.OwnerAccountID != nil {
		t.Fatalf("a create with no identity published one: owner=%v anonymous=%v", published.OwnerAccountID, published.AnonymousID)
	}
}

// A malformed header is REFUSED rather than ignored, and this is the decision
// worth the test.
//
// Ignoring it would create the world and answer 202. The world would have no
// anonymous id, so it could never be claimed — a permanent, silent loss
// reported as a success. A 400 tells the caller its header is broken while
// there is still something to fix.
func TestACreateWithAMalformedAnonymousIdentifierIsRefused(t *testing.T) {
	malformedIdentifiers := []string{
		"mine",
		"' OR '1'='1",
		strings.ReplaceAll(claimTestAnonymousID, "-", ""),
		"{" + claimTestAnonymousID + "}",
	}
	for _, malformedIdentifier := range malformedIdentifiers {
		t.Run(malformedIdentifier, func(t *testing.T) {
			brokerClient := &fakeBroker{}
			router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

			response := httptest.NewRecorder()
			router.ServeHTTP(response, anonymousCreateRequest(malformedIdentifier))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400; body=%s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "INVALID_ANONYMOUS_ID") {
				t.Errorf("body=%s, want INVALID_ANONYMOUS_ID", response.Body.String())
			}
			if brokerClient.publishedEnvelope.JobID != "" {
				t.Error("a refused create still published a generation command, so a world exists that the caller was told does not")
			}
		})
	}
}

// A signed-in visitor whose anonymous cookie has gone stale must not have
// their create refused over a value the gateway is going to drop anyway.
//
// This is the failure the "drop it when there is a session" rule prevents, and
// it is easy to write the validation in the order that causes it: validate the
// header, then notice the session. A visitor would be blocked from creating
// anything by a 180-day cookie they never see.
func TestASignedInCreateIgnoresAMalformedAnonymousIdentifier(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := anonymousCreateRequest("whatever-was-in-that-cookie")
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d, want 202 - the header is irrelevant to a signed-in create and must not be able to refuse one; body=%s", response.Code, response.Body.String())
	}
	if brokerClient.publishedEnvelope.Data.AnonymousID != nil {
		t.Error("the malformed header reached the command")
	}
}
