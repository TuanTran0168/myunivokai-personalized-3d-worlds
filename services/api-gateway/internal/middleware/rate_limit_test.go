package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeDistributedLimiter struct {
	allowances []bool
	error      error
	calls      int
	routeKeys  []string
}

func (limiter *fakeDistributedLimiter) Allow(_ context.Context, routeKey string, _ string, _ float64, _ int) (bool, time.Duration, error) {
	limiter.calls++
	limiter.routeKeys = append(limiter.routeKeys, routeKey)
	if limiter.error != nil {
		return false, 0, limiter.error
	}
	allowed := limiter.allowances[limiter.calls-1]
	return allowed, time.Second, nil
}

func TestRateLimitUsesDistributedPolicyAcrossRoutes(t *testing.T) {
	distributedLimiter := &fakeDistributedLimiter{allowances: []bool{true, false}}
	handler := RequestContext(false)(RateLimit(distributedLimiter, "product", 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/nature/worlds", nil))
	if firstResponse.Code != http.StatusOK || secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("status codes = %d, %d; want 200 then 429", firstResponse.Code, secondResponse.Code)
	}
}

// Product and admin route groups must never share a token bucket: if they
// did, one group's requestsPerSecond/burst would silently govern the other
// whenever it wrote to the shared key last.
func TestRateLimitPassesItsOwnRouteKeyToTheDistributedLimiter(t *testing.T) {
	distributedLimiter := &fakeDistributedLimiter{allowances: []bool{true, true}}
	productHandler := RequestContext(false)(RateLimit(distributedLimiter, "product", 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))
	adminHandler := RequestContext(false)(RateLimit(distributedLimiter, "admin", 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))
	productHandler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	adminHandler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", nil))
	if len(distributedLimiter.routeKeys) != 2 || distributedLimiter.routeKeys[0] != "product" || distributedLimiter.routeKeys[1] != "admin" {
		t.Fatalf("route keys = %v; want [product admin]", distributedLimiter.routeKeys)
	}
}

func TestRateLimitFallsBackLocallyWhenRedisFails(t *testing.T) {
	distributedLimiter := &fakeDistributedLimiter{error: errors.New("redis unavailable")}
	handler := RequestContext(false)(RateLimit(distributedLimiter, "product", 1, 1)(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
	})))
	firstResponse := httptest.NewRecorder()
	handler.ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, "/api/universe/worlds", nil))
	secondResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/nature/worlds", nil))
	if firstResponse.Code != http.StatusOK || secondResponse.Code != http.StatusTooManyRequests {
		t.Fatalf("fallback status codes = %d, %d; want 200 then 429", firstResponse.Code, secondResponse.Code)
	}
}
