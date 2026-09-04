package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/nats-io/nats.go"
)

// The quota as it reaches the world: through the router, on the real create
// route, with the verdict read off the command that was actually published.
// The arithmetic itself is tested in internal/quota; what is asserted here is
// that the create path carries it, that a client cannot forge it, and that
// nothing on this path refuses a request.

const quotaTestAnonymousIdentifier = "d290f1ee-6c54-4b01-90e6-d701748f0851"

// The anonymous counter key, spelled as internal/quota spells it. Written out
// rather than imported, deliberately: a test that computed the key with the
// same helper the code uses would pass through a change to either.
const quotaTestAnonymousCallerKey = "anonymous:" + quotaTestAnonymousIdentifier

func TestAnAnonymousCreateWithAllowanceLeftKeepsTheAITier(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, anonymousCreateRequest(quotaTestAnonymousIdentifier))

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	quotaVerdict := brokerClient.publishedEnvelope.Data.AIQuota
	if quotaVerdict == nil {
		t.Fatal("the create published no quota verdict at all, so dna-service would treat every create as allowed")
	}
	if quotaVerdict.Exhausted {
		t.Fatal("the first create of the day was withheld from the AI tier")
	}
	if quotaVerdict.DailyLimit != 5 {
		t.Fatalf("the command carried the limit %d rather than the declared anonymous default of 5", quotaVerdict.DailyLimit)
	}
}

// The guardrail section 12 asks for by name: the sixth anonymous creation of a
// day is served by the mock provider and still yields a world. Here that is
// the gateway's half — a 202 and a withheld verdict, never a 429.
func TestTheSixthAnonymousCreateOfADayIsWithheldAndStillAccepted(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.seedDailyGenerationCount(quotaTestAnonymousCallerKey, time.Now(), 5)
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, anonymousCreateRequest(quotaTestAnonymousIdentifier))

	if response.Code != http.StatusAccepted {
		t.Fatalf("a caller over the daily limit was not answered 202: status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Code == http.StatusTooManyRequests {
		t.Fatal("the create path returned 429. Decision 8: over the limit degrades, it never refuses")
	}
	quotaVerdict := brokerClient.publishedEnvelope.Data.AIQuota
	if quotaVerdict == nil || !quotaVerdict.Exhausted {
		t.Fatalf("the sixth create of the day published %+v, expected a withheld verdict", quotaVerdict)
	}
	// A withheld create is still a create: the job is queued, both services are
	// woken, and the world arrives. Only the AI call is withheld.
	if brokerClient.publishedEnvelope.JobID == "" {
		t.Fatal("a withheld create published no job, so no world would be produced at all")
	}
}

// The flag is the gateway's and only the gateway's. A client that could set it
// would be asking for the real provider, which is what the NATS ACL on the
// generate subject exists to prevent — and this is the half of that guarantee
// that lives in HTTP: the request body is decoded into contracts.WorldInput,
// so a field named after the quota is not "ignored", it is refused.
func TestAClientCannotAskForTheAITierBySendingTheVerdictItself(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.seedDailyGenerationCount(quotaTestAnonymousCallerKey, time.Now(), 5)
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	bodyClaimingItsOwnAllowance := strings.TrimSuffix(validWorldInputJSON(), "}") +
		`,"aiQuota":{"dailyLimit":1000,"exhausted":false}}`
	request := httptest.NewRequest(http.MethodPost, "/api/universe/worlds", strings.NewReader(bodyClaimingItsOwnAllowance))
	request.Header.Set("X-Anonymous-Id", quotaTestAnonymousIdentifier)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("a body naming its own quota verdict was not refused: status=%d body=%s", response.Code, response.Body.String())
	}
	if brokerClient.publishedEnvelope.JobID != "" {
		t.Fatal("a refused create still published a generate command")
	}
}

// A signed-in visitor is measured against the account allowance, and the
// twenty-fifth create is where it binds rather than the fifth. Asserted
// through the router because that is where the two identities are resolved.
func TestASignedInCreateIsMeasuredAgainstTheAccountAllowance(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	edgeStore.tokenVersions[ownershipTestAccountID] = 1
	edgeStore.seedDailyGenerationCount("account:"+ownershipTestAccountID, time.Now(), 5)
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	request := anonymousCreateRequest(quotaTestAnonymousIdentifier)
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, ownershipTestAccountID, contracts.AccountAudienceWeb))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	quotaVerdict := brokerClient.publishedEnvelope.Data.AIQuota
	if quotaVerdict == nil {
		t.Fatal("a signed-in create published no quota verdict")
	}
	if quotaVerdict.DailyLimit != 25 {
		t.Fatalf("a signed-in create was measured against %d rather than the account default of 25", quotaVerdict.DailyLimit)
	}
	if quotaVerdict.Exhausted {
		t.Fatal("the sixth create by an account holder was withheld; the account allowance is 25, not 5")
	}
}

// The whole reason the two limits are settings rather than environment
// variables: an operator changes one in the admin app and the very next create
// enforces it, with nothing restarted and nothing redeployed.
func TestALimitChangedInTheAdminAppBindsOnTheNextCreate(t *testing.T) {
	brokerClient := &fakeBroker{}
	edgeStore := newFakeEdgeStore()
	// What auth-service mirrors after an operator saves the settings screen.
	edgeStore.setMirroredSetting(contracts.SettingKeyQuotaAIDailyLimitAnonymous, "1")
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	firstResponse := httptest.NewRecorder()
	router.ServeHTTP(firstResponse, anonymousCreateRequest(quotaTestAnonymousIdentifier))
	if firstResponse.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", firstResponse.Code, firstResponse.Body.String())
	}
	if firstVerdict := brokerClient.publishedEnvelope.Data.AIQuota; firstVerdict == nil || firstVerdict.DailyLimit != 1 {
		t.Fatalf("the operator's limit of 1 did not reach the create path: %+v", firstVerdict)
	}

	secondResponse := httptest.NewRecorder()
	router.ServeHTTP(secondResponse, anonymousCreateRequest(quotaTestAnonymousIdentifier))
	if secondResponse.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", secondResponse.Code, secondResponse.Body.String())
	}
	if secondVerdict := brokerClient.publishedEnvelope.Data.AIQuota; secondVerdict == nil || !secondVerdict.Exhausted {
		t.Fatalf("the second create was still allowed against an operator-set limit of 1: %+v", secondVerdict)
	}
}

// Section 12's other settings guardrail, on the path it names: with
// auth-service unavailable the create still succeeds, using the compiled-in
// default. The fake broker answers only the generate publish here — nothing in
// this request may attempt a NATS request at all, because a request to a
// sleeping auth-service is the 20-60 second cold start this design refuses to
// put on the create path.
func TestACreateSucceedsWithAuthServiceUnavailable(t *testing.T) {
	brokerClient := &fakeBroker{requestError: nats.ErrNoResponders}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, anonymousCreateRequest(quotaTestAnonymousIdentifier))

	if response.Code != http.StatusAccepted {
		t.Fatalf("a create failed while auth-service was unavailable: status=%d body=%s", response.Code, response.Body.String())
	}
	if natsRequestCount := len(brokerClient.requestedSubjects); natsRequestCount != 0 {
		t.Fatalf("the create path made %d NATS request(s) (%q). Resolving a setting must never wake auth-service: see internal/settings/reader.go", natsRequestCount, brokerClient.requestedSubjects)
	}
	if quotaVerdict := brokerClient.publishedEnvelope.Data.AIQuota; quotaVerdict == nil || quotaVerdict.DailyLimit != 5 {
		t.Fatalf("expected the compiled-in default of 5 with no mirror and no auth-service, got %+v", quotaVerdict)
	}
}
