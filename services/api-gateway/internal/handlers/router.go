package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/admin/auth"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/quota"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/settings"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/telemetry"
)

const corsMaximumAgeSeconds = 300

type EdgeStore interface {
	cacheStore
	wakeStatsReader
	middleware.DistributedLimiter
	auth.TokenVersionCache
	settings.SettingCache
	quota.GenerationCounter
	IdentityFailureCounter
	Ping(context.Context) error
	Close() error
}

// The three route groups' independent Redis token buckets. No two may ever be
// equal - the underlying key is <prefix>:rate:<routeKey>:<clientIP>, so a
// shared value would silently apply whichever group's parameters wrote last.
// See middleware.RateLimit.
//
// authRateLimitRouteKey is much tighter than the product one (plan section
// 5.5) because the traffic is genuinely different: a person signs in a handful
// of times a day, while the product bucket has to be sized for every world
// read. Config.Validate refuses a configuration where it is the looser of the
// two.
const (
	productRateLimitRouteKey = "product"
	adminRateLimitRouteKey   = "admin"
	authRateLimitRouteKey    = "auth"
)

// NewRouter builds the gateway's whole HTTP surface.
//
// collector may be nil, and is whenever TELEMETRY_ENABLED is off. Nil means no
// telemetry middleware is registered at all - not a middleware that checks a
// flag on every request - so the shipped default costs the request path
// nothing. See internal/telemetry.
func NewRouter(serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore, waker ServiceWaker, collector *telemetry.Collector) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestContext(serviceConfig.TrustProxyHeaders))
	if collector != nil {
		// Registered at the top level, not per group, so that a 404 and a
		// rate-limited request are counted too - both are things the gateway
		// did, and both are invisible from inside a route group.
		//
		// Registered OUTSIDE Recover, deliberately. A panicking handler never
		// returns to a middleware nested inside Recover, so a telemetry
		// middleware placed below it would miss precisely the 500s worth
		// looking at. From out here, Recover has already turned the panic into
		// a written 500 by the time the recording runs.
		router.Use(middleware.Telemetry(collector))
	}
	router.Use(middleware.Recover)
	router.Use(middleware.Logging)
	router.Use(middleware.SecurityHeaders)
	// Built once here rather than inside the identity group, because the
	// business group needs the same two primitives: the identity group to
	// REQUIRE a session, the business group to notice one when it is there.
	// Two constructions would mean two revocation caches for one rule.
	accessTokenVerifier := auth.NewTokenVerifier(serviceConfig.AccessTokenPublicKeys)
	revocationChecker := auth.NewRevocationChecker(edgeStore, brokerClient, serviceConfig.NATSRequestTimeout, serviceConfig.TokenVersionCacheTTL)
	healthHandler := NewHealthHandler(serviceConfig.AppName, brokerClient, edgeStore)
	rpcTransport := NewRPCTransport(serviceConfig, brokerClient, edgeStore, waker, collector)
	dnaJobHandler := NewDNAJobHandler(serviceConfig, rpcTransport)
	// One quota for all three families, because the allowance is per caller:
	// five worlds is five worlds whether they are oceans or forests. It is
	// also the gateway's FIRST reader of a settings row - deliberately, since
	// section 9.3 batch 2 leaves every existing gateway value an environment
	// variable until its handler is restructured.
	dailyAIQuota := quota.NewDailyAIQuota(edgeStore, settings.NewReader(edgeStore))
	universeHandler := NewUniverseHandler(serviceConfig, brokerClient, dailyAIQuota, rpcTransport)
	natureHandler := NewNatureHandler(serviceConfig, brokerClient, dailyAIQuota, rpcTransport)
	oceanHandler := NewOceanHandler(serviceConfig, brokerClient, dailyAIQuota, rpcTransport)
	landingHandler := func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteJSON(responseWriter, http.StatusOK, map[string]any{"service": serviceConfig.AppName, "status": "ok", "architecture": "nats-redis"})
	}
	router.Get("/", landingHandler)
	router.Head("/", landingHandler)
	router.Get("/api/v1/healthz", healthHandler.Liveness)
	router.Get("/api/v1/readyz", healthHandler.Readiness)
	router.Get("/api/v1/statusz", healthHandler.Readiness)

	// The identity group: the same origin and the same CORS policy as the
	// business group below, its own rate-limit bucket, and no response cache
	// anywhere near it. Registered ABOVE the business group for the reason
	// that group's own comment gives about /api/{family}: chi prefers a static
	// segment to a parameter one, but relying on that instead of on
	// registration order is how /api/me/worlds becomes the nature family's
	// problem in Phase C.
	router.Group(func(identityRouter chi.Router) {
		identityRouter.Use(cors.Handler(productCORSOptions(serviceConfig)))
		identityRouter.Use(middleware.RateLimit(edgeStore, authRateLimitRouteKey, serviceConfig.AuthRateLimitRequestsPerSecond, serviceConfig.AuthRateLimitBurst))
		identityRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))
		registerProductAuthRoutes(identityRouter, serviceConfig, edgeStore, rpcTransport, brokerClient, accessTokenVerifier, revocationChecker)
	})

	// The product CORS handler is scoped to this group, not global - it must
	// never reach /api/admin, which mounts its own further down. See
	// agent-system/plans/services/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
	router.Group(func(businessRouter chi.Router) {
		businessRouter.Use(cors.Handler(productCORSOptions(serviceConfig)))
		businessRouter.Use(middleware.RateLimit(edgeStore, productRateLimitRouteKey, serviceConfig.RateLimitRequestsPerSecond, serviceConfig.RateLimitBurst))
		businessRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))
		// Attached to the WRITES only, inside registerWorldRoutes, and not to
		// this group. Applying it here breaks the share page: it is a public
		// URL that has to behave identically for everyone, and a visitor
		// carrying an expired token would be answered 401 on a page that has
		// nothing to do with their session.
		attachProductIdentity := middleware.OptionalProductAccessToken(accessTokenVerifier, revocationChecker)
		businessRouter.Get("/api/jobs/{jobID}", dnaJobHandler.GetJob)
		businessRouter.Route("/api/universe", func(familyRouter chi.Router) {
			registerWorldRoutes(familyRouter, universeHandler, attachProductIdentity)
		})
		businessRouter.Route("/api/nature", func(familyRouter chi.Router) {
			registerWorldRoutes(familyRouter, natureHandler, attachProductIdentity)
		})
		businessRouter.Route("/api/ocean", func(familyRouter chi.Router) {
			registerWorldRoutes(familyRouter, oceanHandler, attachProductIdentity)
		})
		// Every supported family must be registered ABOVE this line: chi
		// matches in registration order, so a family mounted after the
		// wildcard would answer WORLD_FAMILY_NOT_FOUND for routes that exist.
		businessRouter.Route("/api/{family}", registerUnsupportedFamilyRoutes)
	})
	if serviceConfig.AdminRoutesEnabled {
		router.Mount("/api/admin", newAdminRouter(serviceConfig, brokerClient, edgeStore, rpcTransport, waker))
	}
	router.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	router.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return router
}

type worldRouteHandler interface {
	CreateWorld(http.ResponseWriter, *http.Request)
	GetWorlds(http.ResponseWriter, *http.Request)
	GetWorld(http.ResponseWriter, *http.Request)
	CreateVariant(http.ResponseWriter, *http.Request)
	SelectVariant(http.ResponseWriter, *http.Request)
	PublishWorld(http.ResponseWriter, *http.Request)
	DeleteWorld(http.ResponseWriter, *http.Request)
	GetShare(http.ResponseWriter, *http.Request)
}

// registerWorldRoutes splits a family's routes by whether the server reads the
// caller's identity, and the split is the point rather than a tidy-up.
//
// **Exactly one route is outside it**, and it is the only one that can be:
// `/share/worlds/{slug}` is the URL a visitor sends to a friend, so it has to
// answer a stranger, a signed-in stranger and somebody holding a seven-day-old
// token identically. Attaching the identity middleware to the whole group made
// a public page 401 for anybody whose session had gone stale — the session
// being irrelevant to the page is exactly what made the failure invisible in
// every other test, and TestThePublicSharePageIgnoresTheVisitorsSessionEntirely
// is what keeps it out.
//
// **The reads used to be outside it too, and that was the bug.** The comment
// here read "the reads are open, and one of them must be" — true of the share
// route, and quietly extended to the two beside it. What it bought was
// `GET /worlds/{id}` answering 200 to a caller with no credentials at all, for
// a world that had an owner and had never been published: the nickname, the
// role, every variant and the whole DNA snapshot of somebody else's private
// world, which is strictly more than the share response is redacted down to.
// One route needing no session is not the same fact as three routes not
// wanting one.
//
// So every route but the share page carries the caller now. The writes carry it
// because each one either sets the owner or is checked against it; the reads
// carry it because each one is checked against it too. What a caller may READ
// is decided by the family service, in WorldReadPermitted, using the same
// predicate as the writes: an owned world is its owner's, an unowned world
// stays open to anyone holding its id — which is every world made before
// ownership existed, and every world made by a visitor who has not signed up.
func registerWorldRoutes(router chi.Router, handler worldRouteHandler, attachProductIdentity func(http.Handler) http.Handler) {
	router.Get("/share/worlds/{shareSlug}", handler.GetShare)
	router.Group(func(identifiedRouter chi.Router) {
		identifiedRouter.Use(attachProductIdentity)
		identifiedRouter.Get("/worlds", handler.GetWorlds)
		identifiedRouter.Get("/worlds/{worldID}", handler.GetWorld)
		identifiedRouter.Post("/worlds", handler.CreateWorld)
		identifiedRouter.Post("/worlds/{worldID}/variants", handler.CreateVariant)
		identifiedRouter.Post("/worlds/{worldID}/variants/{variantID}/select", handler.SelectVariant)
		identifiedRouter.Post("/worlds/{worldID}/publish", handler.PublishWorld)
		identifiedRouter.Post("/worlds/{worldID}/delete", handler.DeleteWorld)
	})
}

func registerUnsupportedFamilyRoutes(router chi.Router) {
	unsupported := func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "WORLD_FAMILY_NOT_FOUND", "The requested world family is not supported.")
	}
	router.Post("/worlds", unsupported)
	router.Get("/worlds", unsupported)
	router.Get("/worlds/{worldID}", unsupported)
	router.Post("/worlds/{worldID}/variants", unsupported)
	router.Post("/worlds/{worldID}/variants/{variantID}/select", unsupported)
	router.Post("/worlds/{worldID}/publish", unsupported)
	router.Post("/worlds/{worldID}/delete", unsupported)
	router.Get("/share/worlds/{shareSlug}", unsupported)
}
