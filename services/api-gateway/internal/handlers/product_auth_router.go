package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

// The two route prefixes the identity group owns. They are registered as an
// inline chi.Group on the top-level router rather than mounted as a
// sub-router the way /api/admin is, and the difference is deliberate: the
// admin group is a different ORIGIN with its own credentialed CORS handler,
// while these two are the same origin as the product group and differ only in
// which rate-limit bucket polices them.
const (
	productAuthRoutePrefix = "/api/auth"
	productMeRoutePrefix   = "/api/me"
	// The account's own page. A static segment under /api/me, which chi
	// resolves ahead of any parameter segment - the same reason /api/me itself
	// is not swallowed by /api/{family}, asserted in
	// product_auth_router_test.go.
	productProfileRoutePath = productMeRoutePrefix + "/profile"
	// The claim. A static two-segment path under /api/me, and the plural is
	// deliberate: it claims every world one anonymous visitor made, and there
	// is no single-world form of it. Claiming one world would mean naming it,
	// and a world id is the URL a visitor sends to a friend.
	productWorldClaimRoutePath = productMeRoutePrefix + "/worlds/claim"
)

// productCORSOptions is the product surface's CORS policy, shared by the
// business group and the identity group so the two cannot drift.
//
// Nothing here changes for the bearer session, and that is the point of the
// plan's §4.1: `Authorization` was already in AllowedHeaders before this
// sprint, so login became an ordinary API call with no CORS change, no cookie,
// no domain purchase and no backend-for-frontend.
func productCORSOptions(serviceConfig config.Config) cors.Options {
	return cors.Options{
		AllowedOrigins: serviceConfig.AllowedOrigins,
		// PATCH is here for the account page's save, and for nothing else on
		// this surface yet. It is the verb the admin router already uses for
		// "change this resource", so the product edge does not introduce a
		// second convention for the same act. Widening the method list creates
		// no route: chi answers 405 for a PATCH at any path that has not
		// declared one.
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodOptions},
		// X-Anonymous-Id is here for the claim and for an anonymous create.
		// Without it the browser refuses the preflight and both fail with no
		// server-side error at all - every Go test in this repository would
		// still pass, which is why it is called out rather than just added.
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Anonymous-Id", "X-Request-Id"},
		ExposedHeaders: []string{"Cache-Control", "Retry-After", "X-Cache", "X-Request-Id"},
		MaxAge:         corsMaximumAgeSeconds,
	}
}

// registerProductAuthRoutes wires /api/auth and /api/me.
//
// Default-deny by construction, in the same three shapes the admin group
// uses: the four /api/auth routes are public because a caller with no session
// is exactly who needs them, and everything under /api/me sits behind
// RequireProductAccessToken. product_auth_router_test.go enumerates both sets
// so a route added later without its middleware fails the build rather than
// shipping open.
//
// No AllowCredentials, unlike the admin router: the browser is never asked to
// attach anything on its own, so there is nothing to credential. That absence
// is what leaves this design with no CSRF surface (plan §4.3).
func registerProductAuthRoutes(router chi.Router, serviceConfig config.Config, edgeStore EdgeStore, transport *RPCTransport, claimPublisher WorldClaimPublisher, accessTokenVerifier middleware.AdminAccessVerifier, revocationChecker middleware.AdminRevocationChecker) {
	authHandler := NewProductAuthHandler(serviceConfig, transport, edgeStore)
	worldClaimHandler := NewProductWorldClaimHandler(serviceConfig, claimPublisher, transport)
	router.Post(productAuthRoutePrefix+"/signup", authHandler.SignUp)
	router.Post(productAuthRoutePrefix+"/login", authHandler.LogIn)
	router.Post(productAuthRoutePrefix+"/refresh", authHandler.Refresh)
	router.Post(productAuthRoutePrefix+"/logout", authHandler.LogOut)

	// The same two primitives the admin edge is built from, with the same
	// public keys and the same revocation cache. Only the audience demanded
	// differs, which is the whole of the separation at this layer - see
	// middleware.RequireProductAccessToken. They are constructed by NewRouter
	// and passed in, because the business group needs the same two.
	requireProductAccessToken := middleware.RequireProductAccessToken(accessTokenVerifier, revocationChecker)
	router.Group(func(sessionRouter chi.Router) {
		sessionRouter.Use(requireProductAccessToken)
		sessionRouter.Get(productMeRoutePrefix, authHandler.Me)
		sessionRouter.Get(productProfileRoutePath, authHandler.Profile)
		sessionRouter.Patch(productProfileRoutePath, authHandler.UpdateProfile)
		sessionRouter.Post(productWorldClaimRoutePath, worldClaimHandler.ClaimWorlds)
	})
}
