package handlers

import (
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
)

// adminTestKeyPair is shared by every test in this file: a real Ed25519 key
// pair the gateway is configured to trust, so a test can mint a token that
// RequireAdminAccessToken genuinely verifies rather than always rejecting.
var adminTestPublicKey, adminTestPrivateKey, _ = ed25519.GenerateKey(nil)

func testAdminGatewayConfig() config.Config {
	serviceConfig := testGatewayConfig()
	serviceConfig.AdminRoutesEnabled = true
	serviceConfig.AdminAllowedOrigin = "https://admin.example.com"
	serviceConfig.AdminRateLimitRequestsPerSecond = 1000
	serviceConfig.AdminRateLimitBurst = 1000
	serviceConfig.AdminAccessPublicKeys = []ed25519.PublicKey{adminTestPublicKey}
	serviceConfig.AdminTokenVersionCacheTTL = time.Minute
	return serviceConfig
}

type testAccessClaims struct {
	Roles        []string                  `json:"roles"`
	Audience     contracts.AccountAudience `json:"audience"`
	TokenVersion int                       `json:"tokenVersion"`
	jwt.RegisteredClaims
}

// mintAdminAccessToken signs a token with adminTestPrivateKey, mirroring
// exactly the claims shape services/auth-service/internal/security/tokens.go
// signs — the two sides agree on wire shape without importing one another
// (separate Go modules), so this test constructs it by hand too.
func mintAdminAccessToken(t *testing.T, accountID string) string {
	t.Helper()
	claims := testAccessClaims{
		Audience:     contracts.AccountAudienceAdmin,
		TokenVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   accountID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(10 * time.Minute)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(adminTestPrivateKey)
	if err != nil {
		t.Fatalf("mint admin access token: %v", err)
	}
	return token
}

func accountPermissionsResponseEnvelope(t *testing.T, permissions []string, isSuperAdmin bool) contracts.Envelope[contracts.RPCResponseData] {
	t.Helper()
	envelope, err := contracts.SuccessRPCEnvelope("request-permissions", http.StatusOK, contracts.AccountPermissionsResponseData{
		Permissions: permissions, IsSuperAdmin: isSuperAdmin,
	})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

// tokenVersionResponseEnvelope answers RequireAdminAccessToken's Redis
// cache-miss fallback (fakeEdgeStore starts with no cached tokenVersion in
// every test) with a value at or below mintAdminAccessToken's claimed
// TokenVersion (1), so the revocation check passes and the request reaches
// RequireAdminPermission.
func tokenVersionResponseEnvelope(t *testing.T) contracts.Envelope[contracts.RPCResponseData] {
	t.Helper()
	envelope, err := contracts.SuccessRPCEnvelope("request-tokenversion", http.StatusOK, contracts.TokenVersionResponseData{TokenVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

// Every /api/admin route must reject an unauthenticated request except
// login, which is public by design - see the S4-AUTH-003 default-deny
// scenario in notes/sprints/sprint-04-2026-08-06/user-stories.md. A route
// added later without wiring RequireAdminRefreshCookie or
// RequireAdminAccessToken fails this test instead of shipping open.
func TestAdminRoutesDefaultDenyUnlessExplicitlyPublic(t *testing.T) {
	publicRoutes := map[string]bool{"POST /api/admin/auth/login": true, "POST /api/admin/auth/invite/accept": true}
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)

	walkErr := chi.Walk(router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/admin") {
			return nil
		}
		key := method + " " + route
		if publicRoutes[key] {
			return nil
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, route, nil))
		if response.Code != http.StatusUnauthorized {
			t.Errorf("route %s: expected 401 default-deny for an unauthenticated request, got %d", key, response.Code)
		}
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
}

// Default-deny proves a route cannot be reached by a stranger. It does not
// prove the route is gated on anything in particular, and the difference is a
// real hole: a route added to the management group as
// `managementRouter.Get(...)` instead of
// `managementRouter.With(requirePermission(...)).Get(...)` still answers 401 to
// an anonymous caller and passes the test above - while being readable by every
// account that can log in at all, including one seeded with basic_user and
// nothing else.
//
// So this asks the sharper question. An authenticated staff account holding NO
// permissions and no super-admin bypass must be refused by every management
// route. A route with no permission middleware reaches its handler instead and
// answers something other than 403, which fails here.
func TestEveryAdminManagementRouteDemandsAPermission(t *testing.T) {
	// The session routes are the whole exception list, and each is gated by
	// something other than a permission: two are public by design, two require
	// a presented refresh cookie. Both facts are asserted by their own tests.
	sessionRoutes := map[string]bool{
		"POST /api/admin/auth/login":         true,
		"POST /api/admin/auth/invite/accept": true,
		"POST /api/admin/auth/refresh":       true,
		"POST /api/admin/auth/logout":        true,
	}
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, nil, false),
	}}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	accessToken := mintAdminAccessToken(t, "account-with-no-permissions")

	guarded := 0
	walkErr := chi.Walk(router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/admin") || sessionRoutes[method+" "+route] {
			return nil
		}
		request := httptest.NewRequest(method, route, nil)
		request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: accessToken})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Errorf("route %s %s: expected 403 for an account with no permissions, got %d - is it missing requirePermission? body=%s",
				method, route, response.Code, response.Body.String())
			return nil
		}
		guarded++
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
	// A router that mounted nothing would pass every assertion above by
	// vacuous truth, which is exactly the failure this kind of test is prone
	// to. Assert it actually walked the management group.
	if guarded < len(sessionRoutes) {
		t.Fatalf("only %d management routes were checked; the walk found almost nothing to assert on", guarded)
	}
}

func TestAdminRoutesAreNotMountedWhenDisabled(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"a@b.com","password":"x"}`)))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when ADMIN_ROUTES_ENABLED is false", response.Code)
	}
}

func TestAdminLoginSetsSessionCookiesAndOmitsTokensFromTheBody(t *testing.T) {
	session := contracts.LoginResponseData{
		AccessToken: "access-token-value", AccessExpiresAt: time.Now().Add(10 * time.Minute).UTC(),
		RefreshToken: "refresh-token-value", RefreshExpiresAt: time.Now().Add(336 * time.Hour).UTC(),
		Account: contracts.AccountSummary{AccountID: "account-1", Email: "staff@example.com"},
	}
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, session)
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: responseEnvelope}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"staff@example.com","password":"correct horse battery staple"}`)))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if brokerClient.requestedSubject != contracts.AuthLoginQuerySubject {
		t.Fatalf("subject = %q, want %q", brokerClient.requestedSubject, contracts.AuthLoginQuerySubject)
	}
	if strings.Contains(response.Body.String(), "access-token-value") || strings.Contains(response.Body.String(), "refresh-token-value") {
		t.Fatalf("session tokens must never appear in the response body: %s", response.Body.String())
	}
	cookies := response.Result().Cookies()
	var access, refresh *http.Cookie
	for _, cookie := range cookies {
		switch cookie.Name {
		case "myunivokai_admin_access":
			access = cookie
		case "myunivokai_admin_refresh":
			refresh = cookie
		}
	}
	if access == nil || access.Value != "access-token-value" || !access.HttpOnly || access.SameSite != http.SameSiteLaxMode {
		t.Fatalf("access cookie = %+v", access)
	}
	if refresh == nil || refresh.Value != "refresh-token-value" || refresh.Path != "/api/admin/auth" || !refresh.HttpOnly {
		t.Fatalf("refresh cookie = %+v", refresh)
	}
	var decodedBody map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decodedBody); err != nil {
		t.Fatal(err)
	}
	if _, hasAccountKey := decodedBody["account"]; !hasAccountKey {
		t.Fatalf("expected the account summary in the response body, got %s", response.Body.String())
	}
}

func TestAdminRefreshRequiresARefreshCookieBeforeCallingAuthService(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/refresh", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	if brokerClient.requestedSubject != "" {
		t.Fatalf("auth-service must not be called without a refresh cookie, but subject=%q was requested", brokerClient.requestedSubject)
	}
}

func TestAdminLogoutClearsSessionCookies(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusNoContent, struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: responseEnvelope}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/admin/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_refresh", Value: "raw-refresh-token"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			t.Fatalf("cookie %q was not cleared: MaxAge=%d", cookie.Name, cookie.MaxAge)
		}
	}
}

func TestAdminCORSAllowsOnlyItsOwnOriginNeverTheProductOrigin(t *testing.T) {
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodOptions, "/api/admin/auth/login", nil)
	request.Header.Set("Origin", "http://localhost:41300") // the product origin, not the admin origin
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Header().Get("Access-Control-Allow-Origin") == "http://localhost:41300" {
		t.Fatal("the admin CORS handler must not allow the product origin")
	}

	adminOriginRequest := httptest.NewRequest(http.MethodOptions, "/api/admin/auth/login", nil)
	adminOriginRequest.Header.Set("Origin", "https://admin.example.com")
	adminOriginRequest.Header.Set("Access-Control-Request-Method", http.MethodPost)
	adminOriginResponse := httptest.NewRecorder()
	router.ServeHTTP(adminOriginResponse, adminOriginRequest)
	if adminOriginResponse.Header().Get("Access-Control-Allow-Origin") != "https://admin.example.com" {
		t.Fatalf("admin origin preflight = %q", adminOriginResponse.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestAdminManagementRouteSucceedsWithTheRightPermission(t *testing.T) {
	accountsResponse, err := contracts.SuccessRPCEnvelope("request-accounts", http.StatusOK, contracts.AccountListResponseData{
		Accounts: []contracts.AccountSummary{{AccountID: "account-1", Email: "staff@example.com"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(contracts.PermissionAccountRead)}, false),
		contracts.AuthAccountListQuerySubject:        accountsResponse,
	}}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/accounts", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "account-1")})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "staff@example.com") {
		t.Fatalf("expected the relayed account list, got %s", response.Body.String())
	}
}

func TestAdminManagementRouteRejectsWithoutTheRightPermission(t *testing.T) {
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(contracts.PermissionChartRead)}, false),
	}}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/accounts", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "account-1")})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", response.Code, response.Body.String())
	}
}

func TestAdminManagementRouteSuperAdminBypassesPermissionCheck(t *testing.T) {
	rolesResponse, err := contracts.SuccessRPCEnvelope("request-roles", http.StatusOK, contracts.RoleListResponseData{
		Roles: []contracts.RoleSummary{{RoleID: "role-1", Name: "basic_user"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, nil, true),
		contracts.AuthRoleListQuerySubject:           rolesResponse,
	}}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/roles", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: mintAdminAccessToken(t, "super-admin-1")})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
}

func TestAdminManagementRouteRejectsAnUnverifiableToken(t *testing.T) {
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)
	request := httptest.NewRequest(http.MethodGet, "/api/admin/accounts", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: "not-a-real-token"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", response.Code, response.Body.String())
	}
}
