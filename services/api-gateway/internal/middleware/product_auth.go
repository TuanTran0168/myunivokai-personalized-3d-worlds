package middleware

import (
	"context"
	"net/http"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
)

// authorizationHeaderName and bearerSchemePrefix are the whole of the product
// session's transport. There is no cookie name to declare here, unlike the
// admin edge above: the client attaches the token by hand, which is exactly
// what makes the product session immune to third-party cookie blocking and
// gives it no CSRF surface at all — see the plan's §4.1 and §4.3.
//
// The web app does keep the token in a cookie, but a cookie it writes and
// reads itself; the gateway never sees that cookie and never sets one.
const (
	authorizationHeaderName = "Authorization"
	bearerSchemePrefix      = "Bearer "
)

type productClaimsKey struct{}

func WithProductClaims(ctx context.Context, claims contracts.AccessTokenClaims) context.Context {
	return context.WithValue(ctx, productClaimsKey{}, claims)
}

// ProductClaims returns the verified access-token claims a handler under
// /api/me can read once RequireProductAccessToken has run. A handler that
// finds none was reached without the middleware, which is the failure
// product_router_test.go exists to make impossible.
func ProductClaims(ctx context.Context) (contracts.AccessTokenClaims, bool) {
	claims, ok := ctx.Value(productClaimsKey{}).(contracts.AccessTokenClaims)
	return claims, ok
}

func writeProductUnauthenticated(responseWriter http.ResponseWriter, request *http.Request) {
	httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "UNAUTHENTICATED", "A valid session is required.")
}

// RequireProductAccessToken mirrors RequireAdminAccessToken step for step —
// local Ed25519 verification, then the Redis-cached tokenVersion check with
// one auth-service call on a miss, then the audience check — and differs in
// exactly two places, both of which are the point:
//
//  1. the credential arrives in the Authorization header rather than a
//     cookie (plan §4.1), and
//  2. the audience demanded is AccountAudienceWeb rather than
//     AccountAudienceAdmin.
//
// The second one is the missing half of the audience separation. The admin
// edge has rejected a `web` token since Sprint 4 and has a test pinning it;
// until this middleware existed there was no product edge for an `admin`
// token to be rejected by, so the separation was proven in one direction
// only. §12 is explicit that both directions or neither counts.
//
// The tokenVersion check is what makes a 7-day access token defensible at all
// (plan §4.4): revocation is instant at any TTL because it is checked here,
// on every request, and not only when the token is refreshed. Removing it to
// save a Redis read would turn a disabled account into a credential that
// keeps working for a week.
func RequireProductAccessToken(verifier AdminAccessVerifier, revocation AdminRevocationChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			presentedToken, present := bearerToken(request)
			if !present {
				writeProductUnauthenticated(responseWriter, request)
				return
			}
			claims, err := verifier.Verify(presentedToken)
			if err != nil || claims.Audience != contracts.AccountAudienceWeb {
				writeProductUnauthenticated(responseWriter, request)
				return
			}
			revoked, err := revocation.IsRevoked(request.Context(), claims.Subject, claims.TokenVersion)
			if err != nil {
				httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "SESSION_CHECK_UNAVAILABLE", "Could not verify the session right now.")
				return
			}
			if revoked {
				httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "SESSION_REVOKED", "This session is no longer valid. Please sign in again.")
				return
			}
			next.ServeHTTP(responseWriter, request.WithContext(WithProductClaims(request.Context(), claims)))
		})
	}
}

// OptionalProductAccessToken attaches the same verified claims
// RequireProductAccessToken does, on a surface where a session is allowed to be
// absent. It is what lets a world know who made it without closing the door on
// the visitor who has not signed up yet.
//
// The four cases, and the two that are decisions rather than consequences:
//
//  1. No Authorization header at all - proceed anonymously. This is the create
//     path's normal case and it costs no Redis read and no round trip.
//  2. A header that does not verify, or verifies with the wrong audience -
//     rejected with a 401. NOT anonymous, which is the decision. A stale
//     seven-day token
//     silently producing an ownerless world would give somebody a world their
//     own account can never claim, with no error anywhere to explain it, and
//     the web app already answers a 401 with one transparent refresh.
//  3. The revocation check is unavailable - 503, exactly as on the required
//     path. A disabled account must not get a free write because Redis
//     blinked.
//  4. Revoked - 401.
func OptionalProductAccessToken(verifier AdminAccessVerifier, revocation AdminRevocationChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			presentedToken, present := bearerToken(request)
			if !present {
				next.ServeHTTP(responseWriter, request)
				return
			}
			claims, err := verifier.Verify(presentedToken)
			if err != nil || claims.Audience != contracts.AccountAudienceWeb {
				writeProductUnauthenticated(responseWriter, request)
				return
			}
			revoked, err := revocation.IsRevoked(request.Context(), claims.Subject, claims.TokenVersion)
			if err != nil {
				httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "SESSION_CHECK_UNAVAILABLE", "Could not verify the session right now.")
				return
			}
			if revoked {
				httpx.WriteError(responseWriter, request, http.StatusUnauthorized, "SESSION_REVOKED", "This session is no longer valid. Please sign in again.")
				return
			}
			next.ServeHTTP(responseWriter, request.WithContext(WithProductClaims(request.Context(), claims)))
		})
	}
}

// bearerToken reads the Authorization header, case-insensitively on the
// scheme because RFC 7235 makes it so and a client sending "bearer" is not
// making a mistake worth a 401 over.
func bearerToken(request *http.Request) (string, bool) {
	header := strings.TrimSpace(request.Header.Get(authorizationHeaderName))
	if len(header) <= len(bearerSchemePrefix) || !strings.EqualFold(header[:len(bearerSchemePrefix)], bearerSchemePrefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(bearerSchemePrefix):])
	return token, token != ""
}
