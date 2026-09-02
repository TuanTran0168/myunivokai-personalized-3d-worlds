package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/admin/auth"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
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
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
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
func registerProductAuthRoutes(router chi.Router, serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore, transport *RPCTransport) {
	authHandler := NewProductAuthHandler(serviceConfig, transport, edgeStore)
	router.Post(productAuthRoutePrefix+"/signup", authHandler.SignUp)
	router.Post(productAuthRoutePrefix+"/login", authHandler.LogIn)
	router.Post(productAuthRoutePrefix+"/refresh", authHandler.Refresh)
	router.Post(productAuthRoutePrefix+"/logout", authHandler.LogOut)

	// The same two primitives the admin edge is built from, with the same
	// public keys and the same revocation cache. Only the audience demanded
	// differs, which is the whole of the separation at this layer - see
	// middleware.RequireProductAccessToken.
	requireProductAccessToken := middleware.RequireProductAccessToken(
		auth.NewTokenVerifier(serviceConfig.AccessTokenPublicKeys),
		auth.NewRevocationChecker(edgeStore, brokerClient, serviceConfig.NATSRequestTimeout, serviceConfig.TokenVersionCacheTTL),
	)
	router.Group(func(sessionRouter chi.Router) {
		sessionRouter.Use(requireProductAccessToken)
		sessionRouter.Get(productMeRoutePrefix, authHandler.Me)
	})
}
