package middleware

import (
	"context"
	"net/http"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

const (
	// AdminAccessCookieName and AdminRefreshCookieName are the httpOnly,
	// Secure, SameSite=Lax cookies the admin session travels in - never a
	// header, so an XSS in the admin app cannot exfiltrate them into
	// localStorage. AdminRefreshCookieName matches
	// contracts/openapi-admin.yaml's refreshTokenCookie security scheme name.
	AdminAccessCookieName  = "myunivokai_admin_access"
	AdminRefreshCookieName = "myunivokai_admin_refresh"
)

type adminClaimsKey struct{}
type adminRefreshTokenKey struct{}

func WithAdminClaims(ctx context.Context, claims contracts.AccessTokenClaims) context.Context {
	return context.WithValue(ctx, adminClaimsKey{}, claims)
}

// AdminClaims returns the verified access-token claims a downstream handler
// or permission check can read once RequireAdminAccessToken has run.
func AdminClaims(ctx context.Context) (contracts.AccessTokenClaims, bool) {
	claims, ok := ctx.Value(adminClaimsKey{}).(contracts.AccessTokenClaims)
	return claims, ok
}

func withAdminRefreshToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, adminRefreshTokenKey{}, token)
}

// AdminRefreshToken returns the raw refresh token RequireAdminRefreshCookie
// already confirmed was present. auth-service is the sole authority that
// validates it (hash lookup, expiry, reuse detection); the gateway only
// proves a cookie was presented before spending a NATS round trip on one
// that obviously was not.
func AdminRefreshToken(ctx context.Context) string {
	token, _ := ctx.Value(adminRefreshTokenKey{}).(string)
	return token
}

type AdminAccessVerifier interface {
	Verify(tokenString string) (contracts.AccessTokenClaims, error)
}

type AdminRevocationChecker interface {
	IsRevoked(ctx context.Context, accountID string, claimedTokenVersion int) (bool, error)
}

func writeAdminUnauthenticated(responseWriter http.ResponseWriter, request *http.Request) {
	httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid admin session is required.")
}

// RequireAdminAccessToken verifies the Ed25519 signature and expiry locally,
// then checks the Redis-cached tokenVersion (falling back to one
// auth-service call on a cache miss) - see
// notes/plans/services/auth-and-admin-plan.md#how-b-works. No route in this phase is
// wired to it yet: the first permission-gated admin route is
// S4-ANALYTICS-005, which this primitive is built and tested ahead of.
func RequireAdminAccessToken(verifier AdminAccessVerifier, revocation AdminRevocationChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			cookie, err := request.Cookie(AdminAccessCookieName)
			if err != nil || strings.TrimSpace(cookie.Value) == "" {
				writeAdminUnauthenticated(responseWriter, request)
				return
			}
			claims, err := verifier.Verify(cookie.Value)
			if err != nil || claims.Audience != contracts.AccountAudienceAdmin {
				writeAdminUnauthenticated(responseWriter, request)
				return
			}
			revoked, err := revocation.IsRevoked(request.Context(), claims.Subject, claims.TokenVersion)
			if err != nil {
				httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "SESSION_CHECK_UNAVAILABLE", "Could not verify the session right now.")
				return
			}
			if revoked {
				httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "SESSION_REVOKED", "This session is no longer valid. Please log in again.")
				return
			}
			next.ServeHTTP(responseWriter, request.WithContext(WithAdminClaims(request.Context(), claims)))
		})
	}
}

// RequireAdminRefreshCookie only proves a refresh cookie was presented;
// auth-service is the sole authority that validates the token itself - see
// contracts/openapi-admin.yaml's refreshTokenCookie security scheme.
func RequireAdminRefreshCookie(next http.Handler) http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		cookie, err := request.Cookie(AdminRefreshCookieName)
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			writeAdminUnauthenticated(responseWriter, request)
			return
		}
		next.ServeHTTP(responseWriter, request.WithContext(withAdminRefreshToken(request.Context(), cookie.Value)))
	})
}
