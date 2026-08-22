package middleware

import (
	"encoding/json"
	"net/http"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

// AdminPermissionRequester is the one method of *handlers.RPCTransport this
// middleware needs. Declared locally (not imported from handlers) for the
// same reason AdminAccessVerifier/AdminRevocationChecker are in
// admin_auth.go: handlers already imports middleware, so importing the
// concrete type back would cycle.
type AdminPermissionRequester interface {
	Request(responseWriter http.ResponseWriter, request *http.Request, subject string, data any) (contracts.Envelope[contracts.RPCResponseData], bool)
}

// RequireAdminPermission must run after RequireAdminAccessToken (it reads
// AdminClaims from context) and checks ONE specific permission per request
// via a fresh auth-service query — not a cache. Admin-management traffic is
// low-volume staff usage, not the hot path S4-AUTH-003's Redis tokenVersion
// cache exists for; adding a cache here would be solving a load problem
// this route group does not have. See
// contracts/go/contracts_auth.go's AuthAccountPermissionsQuerySubject.
func RequireAdminPermission(requester AdminPermissionRequester, code contracts.PermissionCode) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			claims, ok := AdminClaims(request.Context())
			if !ok {
				writeAdminUnauthenticated(responseWriter, request)
				return
			}
			response, ok := requester.Request(responseWriter, request, contracts.AuthAccountPermissionsQuerySubject,
				contracts.AccountPermissionsQueryData{AccountID: claims.Subject})
			if !ok {
				return
			}
			var permissionsResponse contracts.AccountPermissionsResponseData
			if err := json.Unmarshal(response.Data.Payload, &permissionsResponse); err != nil {
				httpx.WriteError(responseWriter, request, http.StatusBadGateway, "INVALID_SERVICE_RESPONSE", "The service returned an invalid response.")
				return
			}
			if !permissionsResponse.IsSuperAdmin && !hasPermissionCode(permissionsResponse.Permissions, code) {
				httpx.WriteError(responseWriter, request, http.StatusForbidden, "PERMISSION_DENIED", "You do not have permission to perform this action.")
				return
			}
			next.ServeHTTP(responseWriter, request)
		})
	}
}

func hasPermissionCode(permissions []string, code contracts.PermissionCode) bool {
	for _, permission := range permissions {
		if permission == string(code) {
			return true
		}
	}
	return false
}
