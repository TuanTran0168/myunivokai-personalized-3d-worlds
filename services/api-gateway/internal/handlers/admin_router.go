package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/admin/auth"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/broker"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
)

const adminCORSMaximumAgeSeconds = 300

// newAdminRouter builds the /api/admin sub-router with its own middleware
// stack - a distinct CORS handler (exactly one origin, credentialed so the
// session cookies travel), its own rate limit bucket, and default-deny by
// construction: every route below requires either nothing (login, invite
// accept), a presented refresh cookie (refresh, logout), or a verified
// access token plus one specific permission (every record/management
// route). See notes/plans/services/auth-and-admin-plan.md#amended--one-gateway-two-route-groups.
func newAdminRouter(serviceConfig config.Config, brokerClient broker.Client, edgeStore EdgeStore, transport *RPCTransport, waker ServiceWaker) http.Handler {
	adminRouter := chi.NewRouter()
	adminRouter.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{serviceConfig.AdminAllowedOrigin},
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Content-Type", "X-Request-Id"},
		// Retry-After carries the wait for both SERVICE_WAKING and RATE_LIMITED.
		// Without it exposed, a caller reading the header sees nothing and
		// falls back to guessing how long to wait.
		ExposedHeaders:   []string{"Retry-After", "X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           adminCORSMaximumAgeSeconds,
	}))
	adminRouter.Use(middleware.RateLimit(edgeStore, adminRateLimitRouteKey, serviceConfig.AdminRateLimitRequestsPerSecond, serviceConfig.AdminRateLimitBurst))
	adminRouter.Use(middleware.BodyLimit(serviceConfig.MaximumRequestBodyBytes))

	authHandler := NewAdminAuthHandler(serviceConfig, transport)
	adminRouter.Post("/auth/login", authHandler.Login)
	adminRouter.Post("/auth/invite/accept", authHandler.AcceptInvite)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/refresh", authHandler.Refresh)
	adminRouter.With(middleware.RequireAdminRefreshCookie).Post("/auth/logout", authHandler.Logout)

	requireAccessToken := middleware.RequireAdminAccessToken(
		auth.NewTokenVerifier(serviceConfig.AdminAccessPublicKeys),
		auth.NewRevocationChecker(edgeStore, brokerClient, serviceConfig.NATSRequestTimeout, serviceConfig.AdminTokenVersionCacheTTL),
	)
	requirePermission := func(code contracts.PermissionCode) func(http.Handler) http.Handler {
		return middleware.RequireAdminPermission(transport, code)
	}

	accountsHandler := NewAdminAccountsHandler(transport)
	rolesHandler := NewAdminRolesHandler(transport)
	permissionsHandler := NewAdminPermissionsHandler(transport)
	auditHandler := NewAdminAuditHandler(transport)
	analyticsHandler := NewAdminAnalyticsHandler(transport)
	telemetryHandler := NewAdminTelemetryHandler(transport)
	wakeHandler := NewAdminWakeHandler(edgeStore, waker, serviceConfig.ServiceWakePlatform)

	adminRouter.Group(func(managementRouter chi.Router) {
		managementRouter.Use(requireAccessToken)

		managementRouter.With(requirePermission(contracts.PermissionAccountRead)).Get("/accounts", accountsHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionAccountRead)).Get("/accounts/{accountID}", accountsHandler.Get)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts", accountsHandler.Create)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Patch("/accounts/{accountID}", accountsHandler.Update)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/invite", accountsHandler.Invite)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/{accountID}/disable", accountsHandler.Disable)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/accounts/{accountID}/enable", accountsHandler.Enable)

		managementRouter.With(requirePermission(contracts.PermissionRoleRead)).Get("/roles", rolesHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Post("/roles", rolesHandler.Create)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Patch("/roles/{roleID}", rolesHandler.Update)
		managementRouter.With(requirePermission(contracts.PermissionRoleManage)).Delete("/roles/{roleID}", rolesHandler.Delete)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/roles/assign", rolesHandler.Assign)
		managementRouter.With(requirePermission(contracts.PermissionAccountManage)).Post("/roles/revoke", rolesHandler.Revoke)

		managementRouter.With(requirePermission(contracts.PermissionRoleRead)).Get("/permissions", permissionsHandler.List)
		managementRouter.With(requirePermission(contracts.PermissionAuditRead)).Get("/audit", auditHandler.List)

		// The analytics-backed read screens. These replace
		// auth-and-admin-plan.md's original phase-4 domain-service aggregate
		// subjects rather than adding to them: no route in this group may
		// ever publish a universe/nature/dna subject.
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/overview", analyticsHandler.Overview)
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/timeseries", analyticsHandler.Timeseries)
		managementRouter.With(requirePermission(contracts.PermissionWorldRead)).Get("/worlds", analyticsHandler.ListWorlds)
		managementRouter.With(requirePermission(contracts.PermissionWorldRead)).Get("/worlds/{worldID}", analyticsHandler.GetWorld)
		managementRouter.With(requirePermission(contracts.PermissionJobRead)).Get("/jobs", analyticsHandler.ListJobs)
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/service-starts", analyticsHandler.ListServiceStarts)

		// The operational reads, from a third service with its own data
		// boundary. They reuse chart:read for the same reason wake-stats
		// does: a new permission code would mean a contracts change, a
		// permission_sync run and a role update against a deployed
		// auth-service, to gate a page of request counts that every holder of
		// chart:read is already trusted with.
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/telemetry/overview", telemetryHandler.Overview)
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/telemetry/routes", telemetryHandler.ListRoutes)

		// The one admin read that does not come from analytics-service, and
		// the one that wakes nothing to answer - see AdminWakeHandler.
		//
		// It reuses chart:read rather than minting a system:read permission.
		// A new code would mean a contracts change, a permission_sync run and
		// a role update against a deployed auth-service, to gate a read that
		// every holder of chart:read is already trusted with: a dashboard
		// number with no personal data in it.
		managementRouter.With(requirePermission(contracts.PermissionChartRead)).Get("/wake-stats", wakeHandler.Stats)
	})

	adminRouter.NotFound(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusNotFound, "ROUTE_NOT_FOUND", "The requested gateway route was not found.")
	})
	adminRouter.MethodNotAllowed(func(responseWriter http.ResponseWriter, request *http.Request) {
		httpx.WriteError(responseWriter, request, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "The request method is not allowed for this route.")
	})
	return adminRouter
}
