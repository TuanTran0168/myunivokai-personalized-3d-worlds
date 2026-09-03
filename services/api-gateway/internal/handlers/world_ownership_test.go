package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const ownershipTestAccountID = "account-1"
const ownershipTestWorldID = "11111111-1111-4111-8111-111111111111"

// A visitor with no account is the product's first impression and has to keep
// working exactly as it did, which means a 202 and a command with no owner on
// it — not a 401, and not an owner invented from an IP or a cookie.
func TestAnAnonymousCreateCarriesNoOwner(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON())))

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if brokerClient.publishedEnvelope.Data.OwnerAccountID != nil {
		t.Fatalf("an anonymous create published an owner: %v", *brokerClient.publishedEnvelope.Data.OwnerAccountID)
	}
}

// The identity on the command comes from the verified token and from nowhere
// else. This is the assertion behind the plan's claim that a family service is
// right to trust the envelope: the gateway is the only publisher the ACLs
// admit on this subject, and this is what the gateway puts on it.
func TestASignedInCreateCarriesTheTokensAccount(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON()))
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	ownerAccountID := brokerClient.publishedEnvelope.Data.OwnerAccountID
	if ownerAccountID == nil || *ownerAccountID != ownershipTestAccountID {
		t.Fatalf("owner account id = %v, want %s", ownerAccountID, ownershipTestAccountID)
	}
}

// The decision inside OptionalProductAccessToken, stated as a test because the
// alternative is silent and permanent: a token that does not verify produces a
// 401 and no world, rather than an anonymous world its owner can never claim.
//
// An `admin` token is the sharpest form of the case — a real signature, a real
// account, and the wrong audience.
func TestATokenTheProductEdgeRejectsCreatesNoWorldAtAll(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(validWorldInputJSON()))
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceAdmin))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401; body=%s", response.Code, response.Body.String())
	}
	if brokerClient.publishedEnvelope.JobID != "" {
		t.Fatal("a rejected session still published a generation command")
	}
}

// Every mutation carries who is asking, and carries it from the token. The
// body is checked in the same test because "never from the request body" is
// the half that makes the family service's check worth anything.
func TestEveryWorldMutationCarriesTheTokensAccount(t *testing.T) {
	mutationResponse, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, map[string]any{"shareSlug": ""})
	if err != nil {
		t.Fatal(err)
	}

	mutations := []struct {
		description string
		method      string
		path        string
		subject     string
	}{
		{
			description: "create a variant",
			method:      http.MethodPost,
			path:        "/api/universe/worlds/" + ownershipTestWorldID + "/variants",
			subject:     contracts.UniverseVariantCreateSubject,
		},
		{
			description: "select a variant",
			method:      http.MethodPost,
			path:        "/api/universe/worlds/" + ownershipTestWorldID + "/variants/22222222-2222-4222-8222-222222222222/select",
			subject:     contracts.UniverseVariantSelectSubject,
		},
		{
			description: "publish the world",
			method:      http.MethodPost,
			path:        "/api/universe/worlds/" + ownershipTestWorldID + "/publish",
			subject:     contracts.UniverseWorldPublishSubject,
		},
	}

	for _, mutation := range mutations {
		t.Run(mutation.description, func(t *testing.T) {
			brokerClient := &fakeBroker{response: mutationResponse}
			edgeStore := newFakeEdgeStore()
			edgeStore.tokenVersions[ownershipTestAccountID] = 1
			router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

			// A body naming a different account, which must be ignored: the
			// route decodes no body at all, and the id it sends comes from the
			// token. If this ever starts passing through, ownership becomes a
			// claim the client makes about itself.
			request := httptest.NewRequest(mutation.method, mutation.path, strings.NewReader(`{"requestingAccountId":"somebody-else"}`))
			request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			sentAccountID := requestingAccountIDFromSentPayload(t, brokerClient, mutation.subject)
			if sentAccountID != ownershipTestAccountID {
				t.Fatalf("requesting account id = %q, want %q", sentAccountID, ownershipTestAccountID)
			}
		})
	}
}

// requestingAccountIDFromSentPayload reads the field back off whatever the
// gateway actually put on the wire, rather than off a typed struct the test
// chose — so a field renamed on the contract without the family services being
// told fails here instead of in production.
func requestingAccountIDFromSentPayload(t *testing.T, brokerClient *fakeBroker, subject string) string {
	t.Helper()
	sentPayload, found := brokerClient.requestedPayloadsBySubject[subject]
	if !found {
		t.Fatalf("nothing was sent on %s", subject)
	}
	// RPCTransport wraps every request in an Envelope before publishing, so the
	// captured payload is the envelope and the mutation is its Data.
	envelope, isEnvelope := sentPayload.(contracts.Envelope[any])
	if !isEnvelope {
		t.Fatalf("payload type = %T, want contracts.Envelope[any]", sentPayload)
	}
	encoded, err := json.Marshal(envelope.Data)
	if err != nil {
		t.Fatalf("marshal the sent payload: %v", err)
	}
	var decoded struct {
		RequestingAccountID string `json:"requestingAccountId"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode the sent payload: %v", err)
	}
	return decoded.RequestingAccountID
}
