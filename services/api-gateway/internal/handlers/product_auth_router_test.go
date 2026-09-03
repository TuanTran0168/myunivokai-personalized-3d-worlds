package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// productPublicRoutes is the whole exception list for the enumerating tests
// below: the four identity routes a caller with no session is exactly who
// needs. Anything else under /api/auth or /api/me must be authenticated, and a
// route added without its middleware fails here rather than shipping open.
//
// The same shape as admin_router_test.go's publicRoutes, applied to the
// product group — which is what §12 of the identity plan asks for by name.
var productPublicRoutes = map[string]bool{
	"POST /api/auth/signup":  true,
	"POST /api/auth/login":   true,
	"POST /api/auth/refresh": true,
	"POST /api/auth/logout":  true,
}

// walkIdentityRoutes visits every route chi has registered under /api/auth or
// /api/me. Walking the router rather than listing the routes is the point: a
// hand-maintained list would still pass after somebody adds a fifth route and
// forgets to add it here.
func walkIdentityRoutes(t *testing.T, router http.Handler, visit func(method, route string)) int {
	t.Helper()
	visited := 0
	walkErr := chi.Walk(router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, productAuthRoutePrefix) && !strings.HasPrefix(route, productMeRoutePrefix) {
			return nil
		}
		visited++
		visit(method, route)
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
	// A router that mounted nothing would satisfy every assertion below by
	// vacuous truth, which is the failure this kind of test is most prone to.
	if visited <= len(productPublicRoutes) {
		t.Fatalf("the walk found %d identity routes, which is not more than the %d public ones - it is asserting almost nothing", visited, len(productPublicRoutes))
	}
	return visited
}

func TestIdentityRoutesDefaultDenyUnlessExplicitlyPublic(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)

	walkIdentityRoutes(t, router, func(method, route string) {
		if productPublicRoutes[method+" "+route] {
			return
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, route, nil))
		if response.Code != http.StatusUnauthorized {
			t.Errorf("route %s %s: expected 401 default-deny for a request with no token, got %d - is it missing RequireProductAccessToken? body=%s",
				method, route, response.Code, response.Body.String())
		}
	})
}

// The direction that did not exist before this sprint, and the reason §12 says
// "both directions, or neither is proven": the admin edge has rejected a `web`
// token since Sprint 4 (admin_auth_test.go), but until /api/me existed there
// was no product edge for an `admin` token to be turned away by.
//
// The token here is otherwise perfect - correctly signed by a key the gateway
// trusts, unexpired, and its tokenVersion current - so the only thing that can
// reject it is the audience check.
func TestEveryProductRouteRejectsAnAdminAudienceToken(t *testing.T) {
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject: tokenVersionResponseEnvelope(t),
	}}
	router := NewRouter(testGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	adminAudienceToken := mintProductAccessToken(t, "a-staff-account", contracts.AccountAudienceAdmin)

	walkIdentityRoutes(t, router, func(method, route string) {
		if productPublicRoutes[method+" "+route] {
			return
		}
		request := httptest.NewRequest(method, route, nil)
		request.Header.Set("Authorization", "Bearer "+adminAudienceToken)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("route %s %s: an admin-audience token was accepted with status %d; body=%s",
				method, route, response.Code, response.Body.String())
		}
	})
}

// The mirror assertion, kept next to the one above so the pair reads as one
// fact. It duplicates nothing: admin_auth_test.go asserts the middleware in
// isolation, and this asserts every registered /api/admin route as mounted.
func TestEveryAdminRouteRejectsAWebAudienceToken(t *testing.T) {
	brokerClient := &fakeBroker{responsesBySubject: map[string]contracts.Envelope[contracts.RPCResponseData]{
		contracts.AuthTokenVersionQuerySubject:       tokenVersionResponseEnvelope(t),
		contracts.AuthAccountPermissionsQuerySubject: accountPermissionsResponseEnvelope(t, []string{string(contracts.PermissionAccountRead)}, true),
	}}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore(), nil, nil)
	webAudienceToken := mintProductAccessToken(t, "an-end-user-account", contracts.AccountAudienceWeb)

	// The admin session travels in a cookie, so the web token is presented the
	// way an attacker would have to present it there - as that cookie's value.
	sessionRoutes := map[string]bool{
		"POST /api/admin/auth/login":         true,
		"POST /api/admin/auth/invite/accept": true,
		"POST /api/admin/auth/refresh":       true,
		"POST /api/admin/auth/logout":        true,
	}
	checked := 0
	walkErr := chi.Walk(router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/admin") || sessionRoutes[method+" "+route] {
			return nil
		}
		request := httptest.NewRequest(method, route, nil)
		request.AddCookie(&http.Cookie{Name: "myunivokai_admin_access", Value: webAudienceToken})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("route %s %s: a web-audience token was accepted with status %d; body=%s",
				method, route, response.Code, response.Body.String())
			return nil
		}
		checked++
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
	if checked == 0 {
		t.Fatal("no admin management route was checked; the walk found nothing to assert on")
	}
}

// Default-deny proves a route cannot be reached by a stranger. It says nothing
// about the four PUBLIC routes, which by design have no auth middleware at all
// — so the thing they must still carry is the identity rate-limit bucket. A
// route registered outside the identity group would answer normally and pass
// every other test in this file while being policed by the product bucket, or
// by nothing.
func TestEveryIdentityRouteIsPolicedByTheIdentityBucket(t *testing.T) {
	walkIdentityRoutes(t, NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil), func(method, route string) {
		edgeStore := newFakeEdgeStore()
		router := NewRouter(testGatewayConfig(), &fakeBroker{}, edgeStore, nil, nil)
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, route, strings.NewReader("{}")))

		if edgeStore.rateLimitRouteKeys[authRateLimitRouteKey] == 0 {
			t.Errorf("route %s %s did not charge the %q bucket; buckets seen: %v",
				method, route, authRateLimitRouteKey, edgeStore.rateLimitRouteKeys)
		}
		if edgeStore.rateLimitRouteKeys[productRateLimitRouteKey] != 0 {
			t.Errorf("route %s %s also charged the %q bucket, so it is registered in the wrong group",
				method, route, productRateLimitRouteKey)
		}
	})
}

// The identity routes are not gated by ADMIN_ROUTES_ENABLED, unlike
// /api/admin. testGatewayConfig leaves that flag false, so every test above
// already runs in that state - this states it as a fact rather than leaving it
// as a coincidence of the fixture.
func TestIdentityRoutesAreMountedEvenWithTheAdminSurfaceDisabled(t *testing.T) {
	serviceConfig := testGatewayConfig()
	serviceConfig.AdminRoutesEnabled = false
	router := NewRouter(serviceConfig, &fakeBroker{}, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))
	if response.Code == http.StatusNotFound {
		t.Fatal("/api/me is not mounted with the admin surface disabled; the product session would 404 on a default deployment")
	}

	adminResponse := httptest.NewRecorder()
	router.ServeHTTP(adminResponse, httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader("{}")))
	if adminResponse.Code != http.StatusNotFound {
		t.Fatalf("/api/admin answered %d with ADMIN_ROUTES_ENABLED false, want 404", adminResponse.Code)
	}
}

// chi prefers a static path segment to a parameter one, so /api/me does not
// collide with /api/{family}. That is a property of the router rather than of
// this code, and Phase C adds GET /api/me/worlds against an existing
// GET /api/{family}/worlds - so it is asserted now, while the answer is
// obvious, rather than discovered then.
func TestTheIdentityPrefixIsNotSwallowedByTheFamilyWildcard(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore(), nil, nil)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if strings.Contains(response.Body.String(), "WORLD_FAMILY_NOT_FOUND") {
		t.Fatalf("/api/me was matched by the family wildcard; body=%s", response.Body.String())
	}
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 from the identity group; body=%s", response.Code, response.Body.String())
	}
}
