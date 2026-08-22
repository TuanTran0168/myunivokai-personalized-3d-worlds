package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

var errTestInvalidToken = errors.New("invalid token")

type fakeAdminVerifier struct {
	claims contracts.AccessTokenClaims
	err    error
}

func (verifier fakeAdminVerifier) Verify(string) (contracts.AccessTokenClaims, error) {
	return verifier.claims, verifier.err
}

type fakeAdminRevocationChecker struct {
	revoked bool
	err     error
}

func (checker fakeAdminRevocationChecker) IsRevoked(context.Context, string, int) (bool, error) {
	return checker.revoked, checker.err
}

func adminAccessTestHandler() http.Handler {
	return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		claims, ok := AdminClaims(request.Context())
		if !ok {
			responseWriter.WriteHeader(http.StatusInternalServerError)
			return
		}
		responseWriter.Header().Set("X-Subject", claims.Subject)
		responseWriter.WriteHeader(http.StatusOK)
	})
}

func TestRequireAdminAccessTokenRejectsAMissingCookie(t *testing.T) {
	handler := RequireAdminAccessToken(fakeAdminVerifier{}, fakeAdminRevocationChecker{})(adminAccessTestHandler())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/admin/anything", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestRequireAdminAccessTokenRejectsAnInvalidToken(t *testing.T) {
	handler := RequireAdminAccessToken(fakeAdminVerifier{err: errTestInvalidToken}, fakeAdminRevocationChecker{})(adminAccessTestHandler())
	request := httptest.NewRequest(http.MethodGet, "/api/admin/anything", nil)
	request.AddCookie(&http.Cookie{Name: AdminAccessCookieName, Value: "not-a-real-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestRequireAdminAccessTokenRejectsARevokedSession(t *testing.T) {
	verifier := fakeAdminVerifier{claims: contracts.AccessTokenClaims{Subject: "account-1", Audience: contracts.AccountAudienceAdmin, TokenVersion: 1}}
	handler := RequireAdminAccessToken(verifier, fakeAdminRevocationChecker{revoked: true})(adminAccessTestHandler())
	request := httptest.NewRequest(http.MethodGet, "/api/admin/anything", nil)
	request.AddCookie(&http.Cookie{Name: AdminAccessCookieName, Value: "a-valid-looking-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestRequireAdminAccessTokenPassesVerifiedClaimsThrough(t *testing.T) {
	verifier := fakeAdminVerifier{claims: contracts.AccessTokenClaims{Subject: "account-1", Audience: contracts.AccountAudienceAdmin, TokenVersion: 4}}
	handler := RequireAdminAccessToken(verifier, fakeAdminRevocationChecker{revoked: false})(adminAccessTestHandler())
	request := httptest.NewRequest(http.MethodGet, "/api/admin/anything", nil)
	request.AddCookie(&http.Cookie{Name: AdminAccessCookieName, Value: "a-valid-looking-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("X-Subject") != "account-1" {
		t.Fatalf("status=%d subject=%q", response.Code, response.Header().Get("X-Subject"))
	}
}

func TestRequireAdminAccessTokenRejectsAWebAudienceToken(t *testing.T) {
	verifier := fakeAdminVerifier{claims: contracts.AccessTokenClaims{Subject: "account-1", Audience: contracts.AccountAudienceWeb, TokenVersion: 1}}
	handler := RequireAdminAccessToken(verifier, fakeAdminRevocationChecker{})(adminAccessTestHandler())
	request := httptest.NewRequest(http.MethodGet, "/api/admin/anything", nil)
	request.AddCookie(&http.Cookie{Name: AdminAccessCookieName, Value: "a-valid-looking-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for a web-audience token on an admin route", response.Code)
	}
}

func TestRequireAdminRefreshCookieRejectsAMissingCookie(t *testing.T) {
	handler := RequireAdminRefreshCookie(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/refresh", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestRequireAdminRefreshCookiePassesTheTokenThrough(t *testing.T) {
	var seenToken string
	handler := RequireAdminRefreshCookie(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		seenToken = AdminRefreshToken(request.Context())
		responseWriter.WriteHeader(http.StatusOK)
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/admin/auth/refresh", nil)
	request.AddCookie(&http.Cookie{Name: AdminRefreshCookieName, Value: "raw-refresh-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || seenToken != "raw-refresh-token" {
		t.Fatalf("status=%d seenToken=%q", response.Code, seenToken)
	}
}
