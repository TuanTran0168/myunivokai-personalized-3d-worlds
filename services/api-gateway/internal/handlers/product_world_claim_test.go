package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// A real account id, unlike ownershipTestAccountID next door. The claim is the
// one endpoint that requires the token's subject to BE a UUID, because that
// value goes on to become an owner in three other databases.
const claimTestAccountID = "9f1c2f7e-3b44-4a91-9f0e-6d2b7c8a1e55"
const claimTestAnonymousID = "22222222-2222-4222-8222-222222222222"
const claimTestRoutePath = "/api/me/worlds/claim"

func claimRequest(t *testing.T, accessToken, anonymousIdentifier string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, claimTestRoutePath, nil)
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if anonymousIdentifier != "" {
		request.Header.Set("X-Anonymous-Id", anonymousIdentifier)
	}
	return request
}

func routerWithClaimSession(t *testing.T, brokerClient *fakeBroker) http.Handler {
	t.Helper()
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[claimTestAccountID] = 1
	return NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)
}

// The claim's whole contract in one test: the account comes from the token, the
// anonymous id comes from the header, and neither comes from the body — there
// is no body at all.
//
// 202 rather than 200, and that is not a detail. When this response is written
// nothing has been claimed: the command is in JetStream and dna-service is
// probably asleep. The body says "accepted" for the same reason.
func TestAClaimCarriesTheTokensAccountAndTheHeadersAnonymousID(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := routerWithClaimSession(t, brokerClient)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, claimRequest(t, mintProductAccessToken(t, claimTestAccountID, contracts.AccountAudienceWeb), claimTestAnonymousID))

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d, want 202; body=%s", response.Code, response.Body.String())
	}
	if len(brokerClient.claimedEnvelopes) != 1 {
		t.Fatalf("claim commands published = %d, want exactly 1. dna-service fans one command out to the families the visitor used; a second would be a second fan-out", len(brokerClient.claimedEnvelopes))
	}
	claimed := brokerClient.claimedEnvelopes[0].Data
	if claimed.AccountID != claimTestAccountID {
		t.Errorf("account id on the command = %q, want the token's subject %q", claimed.AccountID, claimTestAccountID)
	}
	if claimed.AnonymousID != claimTestAnonymousID {
		t.Errorf("anonymous id on the command = %q, want the header's %q", claimed.AnonymousID, claimTestAnonymousID)
	}
	var body worldClaimAcceptedBody
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Accepted {
		t.Error("the response does not say the claim was accepted, so the client has nothing to key its own cookie clear on")
	}
}

// Every way of arriving without a usable claim, and none of them publishes a
// command.
//
// The admin-audience token is the sharpest case: a real signature and a real
// account, on the wrong edge. And "no anonymous id at all" is a 400 rather
// than a silent 202 because the client's next act is to DELETE its anonymous
// cookie — telling it a claim succeeded when nothing was sent would throw away
// the only thing that could ever claim those worlds.
func TestAClaimIsRefusedWithoutBothHalves(t *testing.T) {
	attempts := []struct {
		description         string
		audience            contracts.AccountAudience
		omitToken           bool
		anonymousIdentifier string
		expectedStatus      int
		expectedCode        string
	}{
		{
			description: "no session at all", omitToken: true, anonymousIdentifier: claimTestAnonymousID,
			expectedStatus: http.StatusUnauthorized, expectedCode: "UNAUTHENTICATED",
		},
		{
			description: "an admin-audience token", audience: contracts.AccountAudienceAdmin, anonymousIdentifier: claimTestAnonymousID,
			expectedStatus: http.StatusUnauthorized, expectedCode: "UNAUTHENTICATED",
		},
		{
			description: "a session but no anonymous id", audience: contracts.AccountAudienceWeb, anonymousIdentifier: "",
			expectedStatus: http.StatusBadRequest, expectedCode: "ANONYMOUS_ID_REQUIRED",
		},
		{
			description: "an anonymous id that is not a UUID", audience: contracts.AccountAudienceWeb, anonymousIdentifier: "mine",
			expectedStatus: http.StatusBadRequest, expectedCode: "INVALID_ANONYMOUS_ID",
		},
		{
			description: "SQL in the anonymous id", audience: contracts.AccountAudienceWeb, anonymousIdentifier: "' OR '1'='1",
			expectedStatus: http.StatusBadRequest, expectedCode: "INVALID_ANONYMOUS_ID",
		},
	}
	for _, attempt := range attempts {
		t.Run(attempt.description, func(t *testing.T) {
			brokerClient := &fakeBroker{}
			router := routerWithClaimSession(t, brokerClient)
			accessToken := ""
			if !attempt.omitToken {
				accessToken = mintProductAccessToken(t, claimTestAccountID, attempt.audience)
			}

			response := httptest.NewRecorder()
			router.ServeHTTP(response, claimRequest(t, accessToken, attempt.anonymousIdentifier))

			if response.Code != attempt.expectedStatus {
				t.Fatalf("status=%d, want %d; body=%s", response.Code, attempt.expectedStatus, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), attempt.expectedCode) {
				t.Errorf("body=%s, want the code %s", response.Body.String(), attempt.expectedCode)
			}
			if len(brokerClient.claimedEnvelopes) != 0 {
				t.Errorf("a refused claim still published a command: %+v", brokerClient.claimedEnvelopes[0].Data)
			}
		})
	}
}

// A token whose subject is not an account id is the gateway's own fault, not
// the caller's, and it is refused anyway.
//
// The reason is the consumers: the claim's JetStream consumers have NO delivery
// limit, on purpose, because a claim that gave up would leave somebody's worlds
// anonymous for ever. That makes a command which can never be applied a message
// the fleet chews on for as long as the stream keeps it — so it must not be
// published at all.
func TestAClaimIsRefusedWhenTheTokensSubjectIsNotAnAccountID(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions["not-a-uuid"] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, claimRequest(t, mintProductAccessToken(t, "not-a-uuid", contracts.AccountAudienceWeb), claimTestAnonymousID))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500 - this is the issuer being wrong, not the visitor; body=%s", response.Code, response.Body.String())
	}
	if len(brokerClient.claimedEnvelopes) != 0 {
		t.Error("a claim that no consumer could ever apply was published to a consumer with no delivery limit")
	}
}

// A failed publish is a 503 and not a 202, because the client clears its
// anonymous cookie on success. A claim reported as accepted and never published
// would take the visitor's only claim credential with it.
func TestAClaimThatCouldNotBePublishedIsNotReportedAsAccepted(t *testing.T) {
	brokerClient := &fakeBroker{publishError: errors.New("no connection")}
	router := routerWithClaimSession(t, brokerClient)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, claimRequest(t, mintProductAccessToken(t, claimTestAccountID, contracts.AccountAudienceWeb), claimTestAnonymousID))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want 503; body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "CLAIM_UNAVAILABLE") {
		t.Errorf("body=%s, want CLAIM_UNAVAILABLE so the client can tell this apart from a rejected session", response.Body.String())
	}
}

// Two claims produce two commands with DIFFERENT correlation ids, and that is
// the one property the fan-out's deduplication depends on.
//
// dna-service keys its outbox message ids on this value, so a JetStream
// redelivery (same envelope, same id) is deduplicated while a genuinely
// repeated claim is not. The repeat is a real case: a browser whose cookie
// clear failed can legitimately claim the same anonymous id again, for worlds
// it made in between.
func TestTwoClaimsAreTwoCommandsWithDifferentCorrelationIdentifiers(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := routerWithClaimSession(t, brokerClient)
	accessToken := mintProductAccessToken(t, claimTestAccountID, contracts.AccountAudienceWeb)

	for attempt := 0; attempt < 2; attempt++ {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, claimRequest(t, accessToken, claimTestAnonymousID))
		if response.Code != http.StatusAccepted {
			t.Fatalf("attempt %d: status=%d body=%s", attempt+1, response.Code, response.Body.String())
		}
	}
	if len(brokerClient.claimedEnvelopes) != 2 {
		t.Fatalf("claim commands published = %d, want 2", len(brokerClient.claimedEnvelopes))
	}
	if brokerClient.claimedEnvelopes[0].JobID == brokerClient.claimedEnvelopes[1].JobID {
		t.Error("two claims share one correlation id, so the second one's family commands would be swallowed by the outbox's ON CONFLICT DO NOTHING and its worlds would stay anonymous")
	}
}

// The CORS half, which no other test in this package would notice.
//
// X-Anonymous-Id has to be in AllowedHeaders or the browser refuses the
// preflight and both the claim and every anonymous create fail — with no
// server-side error anywhere, because the request the handler would have
// answered was never sent.
func TestThePreflightAdmitsTheAnonymousIdentifierHeader(t *testing.T) {
	router := routerWithClaimSession(t, &fakeBroker{})

	request := httptest.NewRequest(http.MethodOptions, claimTestRoutePath, nil)
	request.Header.Set("Origin", "http://localhost:41300")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "authorization,x-anonymous-id")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	allowedHeaders := strings.ToLower(response.Header().Get("Access-Control-Allow-Headers"))
	if !strings.Contains(allowedHeaders, "x-anonymous-id") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want it to admit x-anonymous-id. Without it no browser can send a claim or an anonymous create, and every Go test here still passes", allowedHeaders)
	}
}
