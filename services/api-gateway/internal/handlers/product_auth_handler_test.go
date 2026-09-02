package handlers

import (
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
)

// productTestPublicKey/productTestPrivateKey is a real key pair every gateway
// test config trusts, so a test can mint a token RequireProductAccessToken
// genuinely verifies rather than always rejects. Distinct from the admin pair
// on purpose: a test that passes because both edges share one key would not
// notice the audience check being removed.
var productTestPublicKey, productTestPrivateKey, _ = ed25519.GenerateKey(nil)

const (
	testEndUserEmail    = "visitor@example.com"
	testEndUserPassword = "a-perfectly-fine-passphrase"
)

// mintProductAccessToken signs the claims shape
// services/auth-service/internal/security/tokens.go signs. Built by hand for
// the reason mintAdminAccessToken already documents: the gateway and
// auth-service are separate Go modules and agree on the wire shape without
// importing one another.
func mintProductAccessToken(t *testing.T, accountID string, audience contracts.AccountAudience) string {
	t.Helper()
	claims := testAccessClaims{
		Audience:     audience,
		TokenVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   accountID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(productTestPrivateKey)
	if err != nil {
		t.Fatalf("mint product access token: %v", err)
	}
	return token
}

func productSessionEnvelope(t *testing.T) contracts.Envelope[contracts.RPCResponseData] {
	t.Helper()
	envelope, err := contracts.SuccessRPCEnvelope("request-session", http.StatusOK, contracts.LoginResponseData{
		AccessToken:      "an-access-token",
		AccessExpiresAt:  time.Now().Add(7 * 24 * time.Hour).UTC(),
		RefreshToken:     "a-refresh-token",
		RefreshExpiresAt: time.Now().Add(90 * 24 * time.Hour).UTC(),
		Account: contracts.AccountSummary{
			AccountID: "account-1", Email: testEndUserEmail, Kind: contracts.AccountKindEndUser,
			// Present in the service response and expected to be dropped by
			// the gateway's own response model - see the assertion below.
			Roles: []string{"basic_user"}, Permissions: []string{"chart:read"}, IsSuperAdmin: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func postJSON(t *testing.T, router http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	return response
}

func credentialsJSON(email, password string) string {
	encoded, _ := json.Marshal(map[string]string{"email": email, "password": password})
	return string(encoded)
}

// The inverse of TestAdminLoginSetsSessionCookiesAndOmitsTokensFromTheBody,
// and the two together are the plan's §4.1 in one place: the admin session
// travels in httpOnly cookies because the admin app is same-site, and the
// product session travels in the body because the web app and the gateway are
// two different sites, where a session cookie needs SameSite=None and fails
// silently on iPhones.
func TestProductLoginReturnsTheTokensInTheBodyAndSetsNoCookie(t *testing.T) {
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if cookies := response.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("the product login set %d cookie(s); the gateway must set none", len(cookies))
	}
	var session productSessionResponseBody
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatalf("decode session body: %v", err)
	}
	if session.AccessToken == "" || session.RefreshToken == "" {
		t.Fatal("the session body carries no tokens, so a bearer client has nothing to send")
	}
	if session.Account.Email != testEndUserEmail {
		t.Fatalf("account email = %q, want %q", session.Account.Email, testEndUserEmail)
	}
}

// The response model. auth-service answers with a full AccountSummary because
// the admin surface needs one; the product body must not carry roles,
// permissions or the super-admin flag, whatever the service sent.
func TestProductSessionBodyOmitsRolesPermissionsAndTheSuperAdminFlag(t *testing.T) {
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword))

	for _, forbiddenField := range []string{"roles", "permissions", "isSuperAdmin", "disabled", "forcePasswordChange"} {
		if strings.Contains(response.Body.String(), forbiddenField) {
			t.Errorf("the product session body carries %q; body=%s", forbiddenField, response.Body.String())
		}
	}
}

func TestProductSignupReturns201WithASession(t *testing.T) {
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := postJSON(t, router, "/api/auth/signup", credentialsJSON("new-visitor@example.com", testEndUserPassword))

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", response.Code, response.Body.String())
	}
}

// Rejected at the edge, before a NATS round trip. Not only tidiness: on a
// cold auth-service, forwarding a malformed address means waking a sleeping
// instance for 20-60 seconds in order to say no.
func TestProductAuthRejectsAMalformedEmailBeforeSpendingANATSRoundTrip(t *testing.T) {
	for _, candidate := range []string{
		"not-an-address",
		"missing@",
		"@missing-local-part.example",
		"Display Name <someone@example.com>",
		strings.Repeat("a", 250) + "@example.com",
	} {
		t.Run(candidate, func(t *testing.T) {
			brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
			router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

			response := postJSON(t, router, "/api/auth/signup", credentialsJSON(candidate, testEndUserPassword))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", response.Code, response.Body.String())
			}
			if len(brokerClient.requestedSubjects) != 0 {
				t.Fatalf("a malformed address reached %v, which on a cold instance means waking auth-service to say no", brokerClient.requestedSubjects)
			}
		})
	}
}

// The per-email counter's whole reason for existing (plan §5.5): the per-IP
// bucket cannot see one account being guessed at from many addresses, because
// every attempt arrives on a fresh bucket.
func TestProductLoginThrottlesRepeatedFailuresForOneEmailAcrossAddresses(t *testing.T) {
	unauthorizedEnvelope := contracts.ErrorRPCEnvelope("request-login", http.StatusUnauthorized, "INVALID_CREDENTIALS", "Incorrect email or password.")
	brokerClient := &fakeBroker{response: unauthorizedEnvelope}
	edgeStore := newFakeEdgeStore()
	serviceConfig := testGatewayConfig()
	router := NewRouter(serviceConfig, brokerClient, edgeStore, nil, nil)

	// Each attempt arrives from a different address, so the per-IP bucket
	// never fires. Only the per-email counter can stop this.
	failureLimit := serviceConfig.IdentityFailureLimit()
	for attempt := 0; attempt < failureLimit; attempt++ {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(credentialsJSON(testEndUserEmail, "a-wrong-guess")))
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = "203.0.113." + strconv.Itoa(attempt+1) + ":9000"
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401; body=%s", attempt, response.Code, response.Body.String())
		}
	}

	throttled := postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, "a-wrong-guess"))
	if throttled.Code != http.StatusTooManyRequests {
		t.Fatalf("status after %d failures = %d, want 429; body=%s", failureLimit, throttled.Code, throttled.Body.String())
	}

	// A different address is unaffected: the counter is per identity, so one
	// account being attacked must not lock everybody else out.
	other := postJSON(t, router, "/api/auth/login", credentialsJSON("somebody-else@example.com", "a-wrong-guess"))
	if other.Code != http.StatusUnauthorized {
		t.Fatalf("an unrelated address got %d, want 401 - the counter is not per identity", other.Code)
	}
}

func TestProductLoginClearsTheFailureTallyOnSuccess(t *testing.T) {
	edgeStore := newFakeEdgeStore()
	identityKey := edge.IdentityFailureKey(testEndUserEmail)
	edgeStore.identityFailures[identityKey] = 3
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	if response := postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword)); response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}

	if remaining := edgeStore.identityFailures[identityKey]; remaining != 0 {
		t.Fatalf("failure tally = %d after a successful sign-in, want 0 - four typos then a correct password would leave somebody one attempt from a throttle", remaining)
	}
}

// A cold auth-service must not count against the person trying to sign in.
// The whole of story S8-IDENTITY-005 rests on a cold start being a wait rather
// than a failure, and a 503 counted as a bad password would turn a slow
// instance into a lockout.
func TestProductLoginDoesNotCountAColdAuthServiceAsAFailedAttempt(t *testing.T) {
	edgeStore := newFakeEdgeStore()
	brokerClient := &fakeBroker{requestError: errors.New("nats: no responders available for request")}
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword))

	if tally := edgeStore.identityFailures[edge.IdentityFailureKey(testEndUserEmail)]; tally != 0 {
		t.Fatalf("failure tally = %d after a transport failure, want 0", tally)
	}
}

// A Redis outage must not stop people signing in. The per-IP bucket has a
// local fallback for the same reason, and auth-service's own account lockout
// is in Postgres and unaffected, so failing open here loses one layer rather
// than all of them.
func TestProductLoginStillWorksWhenTheFailureCounterIsUnavailable(t *testing.T) {
	edgeStore := newFakeEdgeStore()
	edgeStore.identityFailuresError = errors.New("redis unreachable")
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	if response := postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword)); response.Code != http.StatusOK {
		t.Fatalf("status = %d with the counter unavailable, want 200; body=%s", response.Code, response.Body.String())
	}
}

// middleware.RateLimit's own comment states the rule this asserts: two groups
// sharing a route key share one token bucket even with different parameters.
// The plan's §5.5 requires the identity group to have its own.
func TestTheIdentityGroupUsesItsOwnRateLimitBucket(t *testing.T) {
	edgeStore := newFakeEdgeStore()
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, edgeStore, nil, nil)

	postJSON(t, router, "/api/auth/login", credentialsJSON(testEndUserEmail, testEndUserPassword))

	if edgeStore.rateLimitRouteKeys[authRateLimitRouteKey] == 0 {
		t.Fatalf("the identity group did not use the %q bucket; buckets seen: %v", authRateLimitRouteKey, edgeStore.rateLimitRouteKeys)
	}
	if edgeStore.rateLimitRouteKeys[productRateLimitRouteKey] != 0 {
		t.Fatalf("the identity group also charged the %q bucket, so the two are not independent", productRateLimitRouteKey)
	}
	if authRateLimitRouteKey == productRateLimitRouteKey || authRateLimitRouteKey == adminRateLimitRouteKey {
		t.Fatal("the three route keys must all differ, or two groups share one Redis token bucket")
	}
}

func TestMeReturnsTheSignedInAccountAndNothingElse(t *testing.T) {
	accountEnvelope, err := contracts.SuccessRPCEnvelope("request-me", http.StatusOK, contracts.AccountSummary{
		AccountID: "account-1", Email: testEndUserEmail, Name: "Visitor", Kind: contracts.AccountKindEndUser,
		Roles: []string{"basic_user"}, Permissions: []string{"chart:read"}, IsSuperAdmin: true,
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject: tokenVersionResponseEnvelope(t),
		contracts.AuthAccountGetQuerySubject:   accountEnvelope,
	}}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, "account-1", contracts.AccountAudienceWeb))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	var account productAccountBody
	if err := json.Unmarshal(response.Body.Bytes(), &account); err != nil {
		t.Fatalf("decode account body: %v", err)
	}
	if account.AccountID != "account-1" || account.Email != testEndUserEmail {
		t.Fatalf("account = %+v, want the signed-in one", account)
	}
	for _, forbiddenField := range []string{"roles", "permissions", "isSuperAdmin"} {
		if strings.Contains(response.Body.String(), forbiddenField) {
			t.Errorf("/api/me carries %q; body=%s", forbiddenField, response.Body.String())
		}
	}
}

// A lowercase scheme is valid per RFC 7235, and a client sending it is not
// making a mistake worth a 401 over.
func TestMeAcceptsTheBearerSchemeCaseInsensitively(t *testing.T) {
	accountEnvelope, err := contracts.SuccessRPCEnvelope("request-me", http.StatusOK, contracts.AccountSummary{
		AccountID: "account-1", Email: testEndUserEmail, Kind: contracts.AccountKindEndUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject: tokenVersionResponseEnvelope(t),
		contracts.AuthAccountGetQuerySubject:   accountEnvelope,
	}}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("Authorization", "bearer "+mintProductAccessToken(t, "account-1", contracts.AccountAudienceWeb))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d for a lowercase bearer scheme, want 200; body=%s", response.Code, response.Body.String())
	}
}

// The revocation check, which is the single fact that makes a 7-day product
// access token defensible (plan §4.4): it runs on every request, so a
// disabled account stops working within the cache window rather than at
// expiry.
func TestMeRejectsARevokedSessionEvenThoughTheTokenHasNotExpired(t *testing.T) {
	edgeStore := newFakeEdgeStore()
	// auth-service bumped tokenVersion past what the token claims, which is
	// exactly what DisableAccount does.
	edgeStore.tokenVersions["account-1"] = 2
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, edgeStore, nil, nil)

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("Authorization", "Bearer "+mintProductAccessToken(t, "account-1", contracts.AccountAudienceWeb))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for a revoked session; body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "SESSION_REVOKED") {
		t.Fatalf("body = %s, want SESSION_REVOKED so the client signs out rather than retrying", response.Body.String())
	}
}

// The display name travels with the signup, and LOGIN's body shape is
// unchanged by its arrival: the two are decoded into separate structs so a
// login that quietly accepted a name would be a field with no meaning on the
// one request where somebody might expect it to identify them.
func TestSignUpCarriesTheDisplayNameAndLoginStillRefusesOne(t *testing.T) {
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthWebSignupQuerySubject: productSessionEnvelope(t),
		contracts.AuthWebLoginQuerySubject:  productSessionEnvelope(t),
	}}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	signUpResponse := postJSON(t, router, "/api/auth/signup",
		`{"email":"`+testEndUserEmail+`","password":"`+testEndUserPassword+`","name":"  Neo  "}`)
	if signUpResponse.Code != http.StatusCreated {
		t.Fatalf("signup status = %d, body = %s", signUpResponse.Code, signUpResponse.Body.String())
	}
	envelope, ok := brokerClient.requestedPayloadsBySubject[contracts.AuthWebSignupQuerySubject].(contracts.Envelope[any])
	if !ok {
		t.Fatalf("signup payload = %T, want an envelope", brokerClient.requestedPayloadsBySubject[contracts.AuthWebSignupQuerySubject])
	}
	signup, ok := envelope.Data.(contracts.WebSignupData)
	if !ok {
		t.Fatalf("envelope data = %T, want contracts.WebSignupData", envelope.Data)
	}
	// Trimmed at the edge, so auth-service never stores the spaces and the
	// header never renders them.
	if signup.Name != "Neo" {
		t.Errorf("name = %q, want it trimmed to Neo", signup.Name)
	}

	loginResponse := postJSON(t, router, "/api/auth/login",
		`{"email":"`+testEndUserEmail+`","password":"`+testEndUserPassword+`","name":"Neo"}`)
	if loginResponse.Code != http.StatusBadRequest {
		t.Fatalf("login with a name: status = %d, want 400 - login's body shape must not have grown a name", loginResponse.Code)
	}
}

// The ceiling is enforced at the edge so the message can name the limit, and
// a cold auth-service is not woken to refuse a name nobody can save.
func TestSignUpRefusesADisplayNamePastTheCeiling(t *testing.T) {
	brokerClient := &fakeBroker{response: productSessionEnvelope(t)}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)

	response := postJSON(t, router, "/api/auth/signup",
		`{"email":"`+testEndUserEmail+`","password":"`+testEndUserPassword+`","name":"`+strings.Repeat("n", contracts.MaximumAccountDisplayNameLength+1)+`"}`)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", response.Code, response.Body.String())
	}
	if len(brokerClient.requestedSubjects) != 0 {
		t.Errorf("an over-long name reached %v", brokerClient.requestedSubjects)
	}
	if !strings.Contains(response.Body.String(), strconv.Itoa(contracts.MaximumAccountDisplayNameLength)) {
		t.Errorf("the message does not name the limit; body = %s", response.Body.String())
	}
}
