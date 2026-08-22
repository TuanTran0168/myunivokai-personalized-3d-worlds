package middleware

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/rs/zerolog/log"
	"golang.org/x/time/rate"
)

const (
	clientIdleTimeToLive = 10 * time.Minute
	cleanupInterval      = time.Minute
	fallbackRetrySeconds = 1
)

type DistributedLimiter interface {
	Allow(context.Context, string, string, float64, int) (bool, time.Duration, error)
}

type clientLimiterEntry struct {
	limiter      *rate.Limiter
	lastSeenTime time.Time
}

type perClientRateLimiter struct {
	requestsPerSecond float64
	burst             int
	mutex             sync.Mutex
	clients           map[string]*clientLimiterEntry
	lastCleanupTime   time.Time
}

// RateLimit builds a rate-limit middleware bucketed by routeKey and client
// IP. routeKey must differ between independently-policed route groups (the
// product group and the admin group use "product" and "admin") — the
// underlying Redis key is <prefix>:rate:<routeKey>:<clientIP>, so two groups
// sharing a routeKey would share one token bucket even with different
// requestsPerSecond/burst arguments, silently applying whichever group's
// parameters wrote to it last.
func RateLimit(distributedLimiter DistributedLimiter, routeKey string, requestsPerSecond float64, burst int) func(http.Handler) http.Handler {
	fallbackLimiter := &perClientRateLimiter{
		requestsPerSecond: requestsPerSecond,
		burst:             burst,
		clients:           make(map[string]*clientLimiterEntry),
		lastCleanupTime:   time.Now(),
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			clientIdentifier := httpx.ClientIP(request.Context())
			allowed, retryDelay, err := distributedLimiter.Allow(request.Context(), routeKey, clientIdentifier, requestsPerSecond, burst)
			if err != nil {
				log.Warn().Err(err).Msg("Redis rate limiter unavailable; using local fallback")
				allowed = fallbackLimiter.allow(clientIdentifier)
				retryDelay = fallbackRetrySeconds * time.Second
			}
			if !allowed {
				responseWriter.Header().Set("Retry-After", strconv.Itoa(edge.RetryAfterSeconds(retryDelay)))
				httpx.WriteError(responseWriter, request, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.")
				return
			}
			next.ServeHTTP(responseWriter, request)
		})
	}
}

func (limiter *perClientRateLimiter) allow(clientIP string) bool {
	return limiter.entryForClient(clientIP).limiter.Allow()
}

func (limiter *perClientRateLimiter) entryForClient(clientIP string) *clientLimiterEntry {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	now := time.Now()
	limiter.removeIdleClientsLocked(now)
	entry, exists := limiter.clients[clientIP]
	if !exists {
		entry = &clientLimiterEntry{limiter: rate.NewLimiter(rate.Limit(limiter.requestsPerSecond), limiter.burst)}
		limiter.clients[clientIP] = entry
	}
	entry.lastSeenTime = now
	return entry
}

func (limiter *perClientRateLimiter) removeIdleClientsLocked(now time.Time) {
	if now.Sub(limiter.lastCleanupTime) < cleanupInterval {
		return
	}
	limiter.lastCleanupTime = now
	for clientIP, entry := range limiter.clients {
		if now.Sub(entry.lastSeenTime) > clientIdleTimeToLive {
			delete(limiter.clients, clientIP)
		}
	}
}
