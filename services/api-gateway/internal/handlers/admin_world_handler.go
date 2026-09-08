package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/middleware"
	"github.com/rs/zerolog/log"
)

// AdminWorldHandler is the first admin route in this platform that WRITES to a
// family service, and the shape it takes is the one the product routes already
// use rather than a new one.
//
// One handler per family, each holding its own subject, chosen by the
// constructor. WorldHandler's own comment states the rule this follows:
// "family-to-subject routing is constructor-owned, so request data can never
// select another service." So the admin routes are registered per family too —
// `/api/admin/universe/...`, `/api/admin/nature/...`, `/api/admin/ocean/...` —
// and the family is a literal segment of a registration, never a field read
// out of a request body. Taking the family from the body would have been
// smaller and would have handed a caller the choice of which service to reach.
type AdminWorldHandler struct {
	family           contracts.WorldFamily
	unpublishSubject string
	transport        *RPCTransport
}

func NewAdminWorldHandler(family contracts.WorldFamily, unpublishSubject string, transport *RPCTransport) *AdminWorldHandler {
	return &AdminWorldHandler{family: family, unpublishSubject: unpublishSubject, transport: transport}
}

// unpublishResponsePayload is the one field this handler reads out of the
// family service's answer. It peeks rather than decoding the whole response,
// the same way shareSlugFromMutationPayload does on the product side, so the
// gateway does not take on the shape of any service's response model.
type unpublishResponsePayload struct {
	RevokedShareSlug string `json:"revokedShareSlug"`
	WasPublished     bool   `json:"wasPublished"`
}

// Unpublish revokes a world's share slug on staff authority.
//
// The order of the three steps below is the whole correctness of this handler:
// take the page down, drop the cache that would keep serving it, then record
// who did it. Reversing the last two would leave a truthful audit row beside a
// page that is still up.
func (handler *AdminWorldHandler) Unpublish(responseWriter http.ResponseWriter, request *http.Request) {
	worldID, validWorldID := worldIdentifierFromRequest(responseWriter, request)
	if !validWorldID {
		return
	}
	// The actor comes from the verified access token and never from the
	// request, exactly as the settings write does: the record of who took a
	// public page down must not be settable by whoever sent the request.
	claims, _ := middleware.AdminClaims(request.Context())
	sourceAddress := httpx.ClientIP(request.Context())

	response, ok := handler.transport.Request(responseWriter, request, handler.unpublishSubject, contracts.UnpublishWorldData{
		WorldID:        worldID,
		StaffAccountID: claims.Subject,
	})
	if !ok {
		// The transport already answered the caller. An attempt that never
		// reached the family service is still an attempt, and a log that
		// records only what succeeded cannot answer what was tried.
		handler.recordAudit(request, claims.Subject, worldID, contracts.AuditResultFailure, sourceAddress)
		return
	}
	if response.Data.StatusCode >= http.StatusBadRequest {
		handler.recordAudit(request, claims.Subject, worldID, contracts.AuditResultFailure, sourceAddress)
		httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
		return
	}

	// The share cache is keyed by slug, which the gateway cannot derive from a
	// world id — so the family service returns the slug it REVOKED, and this is
	// the only place that value is used. Without it the page just taken down
	// would keep being served from Redis for a whole SHARE_CACHE_TTL while
	// this handler answered 200.
	var payload unpublishResponsePayload
	if err := json.Unmarshal(response.Data.Payload, &payload); err != nil {
		// The takedown itself succeeded; only the slug is unreadable. Say so
		// in the log rather than failing the request, and let the cache expire
		// on its own — a 500 here would invite a second click that changes
		// nothing.
		log.Error().Err(err).Str("world_id", worldID).Msg("decode unpublish response for share cache invalidation")
	}
	handler.transport.InvalidateShare(request.Context(), handler.family, payload.RevokedShareSlug)
	handler.transport.InvalidateWorld(request.Context(), handler.family, worldID)

	handler.recordAudit(request, claims.Subject, worldID, contracts.AuditResultSuccess, sourceAddress)
	httpx.WriteRawJSON(responseWriter, response.Data.StatusCode, response.Data.Payload)
}

// recordAudit writes the row through auth-service, which owns the table.
//
// A failure is logged and does not change the answer the caller already has:
// the page is down either way, and reporting a 500 for a missing log row would
// invite a retry that takes nothing further down. It is logged at error level
// rather than swallowed because an audit log with gaps is a different problem
// from a slow one, and the gap has to be visible somewhere.
func (handler *AdminWorldHandler) recordAudit(request *http.Request, actorAccountID, worldID, result, sourceAddress string) {
	recorded, ok := handler.transport.RequestWithoutResponse(request.Context(), contracts.AuthAuditRecordQuerySubject, contracts.AuditRecordData{
		ActorAccountID: actorAccountID,
		Action:         contracts.AuditActionWorldUnpublish,
		Target:         string(handler.family) + ":" + worldID,
		Result:         result,
		SourceAddress:  sourceAddress,
	})
	if !ok || recorded >= http.StatusBadRequest {
		log.Error().
			Str("world_id", worldID).
			Str("actor_account_id", actorAccountID).
			Str("result", result).
			Int("audit_status", recorded).
			Msg("audit row for world unpublish was not written")
	}
}

// registerAdminWorldRoutes mounts one family's admin write routes.
//
// The permission is `world:unpublish`, which auth-service has declared and kept
// grantable since S4-AUTH-005 with nothing behind it —
// "Not enforced yet — no route revokes a share slug. Reserved for that screen."
// This is that route.
func registerAdminWorldRoutes(router chi.Router, handler *AdminWorldHandler, requirePermission func(contracts.PermissionCode) func(http.Handler) http.Handler) {
	router.With(requirePermission(contracts.PermissionWorldUnpublish)).
		Post("/worlds/{worldID}/unpublish", handler.Unpublish)
}
