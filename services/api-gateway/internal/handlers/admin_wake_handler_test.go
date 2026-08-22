package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

func decodeWakeStats(t *testing.T, body []byte) adminWakeStatsResponse {
	t.Helper()
	var decoded adminWakeStatsResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode wake stats %q: %v", body, err)
	}
	return decoded
}

// A service with no URL configured is never woken, so its count is always
// zero - which reads identically to a service that simply never slept. The
// flag is what stops the dashboard drawing the same picture for "healthy" and
// "not covered".
func TestWakeStatsSeparatesNeverSleptFromNotCovered(t *testing.T) {
	lastSeen := time.Date(2026, 8, 12, 9, 30, 0, 0, time.UTC)
	store := newFakeEdgeStore()
	store.wakeStats = map[string]edge.ServiceWakeStats{
		wake.ServiceDNA:  {Service: wake.ServiceDNA, TotalWakes: 7, LastSeenAt: &lastSeen},
		wake.ServiceAuth: {Service: wake.ServiceAuth},
	}
	// Only dna has a wake target; auth is deployed but unconfigured.
	handler := NewAdminWakeHandler(store, newFakeWaker(wake.ServiceDNA), "http")
	response := httptest.NewRecorder()
	handler.Stats(response, httptest.NewRequest(http.MethodGet, "/api/admin/wake-stats", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	decoded := decodeWakeStats(t, response.Body.Bytes())
	if len(decoded.Services) != len(wake.Services) {
		t.Fatalf("returned %d services, want every one of %d", len(decoded.Services), len(wake.Services))
	}
	byService := make(map[string]adminWakeServiceStats, len(decoded.Services))
	for _, service := range decoded.Services {
		byService[service.Service] = service
	}
	if dna := byService[wake.ServiceDNA]; !dna.Wakeable || dna.TotalWakes != 7 {
		t.Fatalf("dna = %+v, want wakeable with 7 wakes", dna)
	}
	if auth := byService[wake.ServiceAuth]; auth.Wakeable || auth.TotalWakes != 0 {
		t.Fatalf("auth = %+v, want unwakeable with 0 wakes", auth)
	}
	if decoded.Platform.WakeableService != 1 {
		t.Fatalf("wakeable count = %d, want 1", decoded.Platform.WakeableService)
	}
}

// The window is a dashboard control, so an unusable value is corrected rather
// than rejected. A range input that returns 400 teaches the operator to leave
// it alone.
func TestWakeStatsClampsTheRequestedWindow(t *testing.T) {
	testCases := map[string]int{
		"":     defaultWakeStatsDays,
		"7":    7,
		"0":    defaultWakeStatsDays,
		"-3":   defaultWakeStatsDays,
		"soon": defaultWakeStatsDays,
		"5000": maximumWakeStatsDays,
	}
	for raw, expected := range testCases {
		t.Run("days="+raw, func(t *testing.T) {
			handler := NewAdminWakeHandler(newFakeEdgeStore(), newFakeWaker(wake.Services...), "http")
			response := httptest.NewRecorder()
			handler.Stats(response, httptest.NewRequest(http.MethodGet, "/api/admin/wake-stats?days="+raw, nil))
			if days := decodeWakeStats(t, response.Body.Bytes()).Days; days != expected {
				t.Fatalf("days = %d, want %d", days, expected)
			}
		})
	}
}

// Redis holds these counters, and Redis is allowed to be down. The route says
// so plainly instead of returning an empty chart that reads as "no service
// ever slept".
func TestWakeStatsReportsAnUnreadableStore(t *testing.T) {
	store := newFakeEdgeStore()
	store.wakeStatsError = errors.New("redis is down")
	handler := NewAdminWakeHandler(store, newFakeWaker(wake.Services...), "http")
	response := httptest.NewRecorder()
	handler.Stats(response, httptest.NewRequest(http.MethodGet, "/api/admin/wake-stats", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}
	if code := errorCodeOf(t, response.Body.Bytes()); code != "SERVICE_UNAVAILABLE" {
		t.Fatalf("error code = %q, want SERVICE_UNAVAILABLE", code)
	}
}

// Reading this page must not start anything. It reports on services being
// asleep, so waking one to answer would corrupt the very number it returns -
// which is the reason the counters live in the gateway's Redis rather than in
// analytics-service.
func TestReadingWakeStatsWakesNothing(t *testing.T) {
	waker := newFakeWaker(wake.Services...)
	handler := NewAdminWakeHandler(newFakeEdgeStore(), waker, "http")
	handler.Stats(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/admin/wake-stats", nil))

	if woken := waker.wokenServices(); len(woken) != 0 {
		t.Fatalf("reading wake statistics woke %v", woken)
	}
	if seen := waker.seenServices(); len(seen) != 0 {
		t.Fatalf("reading wake statistics stamped %v as seen", seen)
	}
}
