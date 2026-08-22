package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/edge"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/httpx"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

const (
	defaultWakeStatsDays = 30
	maximumWakeStatsDays = 90
	wakeStatsReadTimeout = 2 * time.Second
)

// wakeStatsReader is the gateway's own Redis, narrowed to the one call this
// handler makes.
type wakeStatsReader interface {
	WakeStats(ctx context.Context, services []string, endDay time.Time, days int) (map[string]edge.ServiceWakeStats, error)
}

// AdminWakeHandler serves the only admin screen whose data does not come from
// analytics-service - and the only one that wakes nothing to answer.
//
// That is the whole point of where it reads from. These numbers describe
// services being asleep, so fetching them from a scale-to-zero read model
// would start one in order to report on starts. The gateway is awake by
// definition while serving this request and Redis is managed, so the
// measurement stays outside what it measures.
//
// It is also why this handler computes rather than relays, unlike every other
// route in the admin group. The rule those follow - the gateway sums nothing,
// every aggregate is SQL inside analytics-service - exists so business
// aggregates have exactly one implementation. There is no service behind this
// data to relay from; the gateway is the only process that observes it.
type AdminWakeHandler struct {
	stats        wakeStatsReader
	waker        ServiceWaker
	platformName string
}

// NewAdminWakeHandler takes the platform name as a value rather than asking
// the waker for it. Configuration is where that name comes from, so reading
// it from configuration keeps one source of truth - and it spares ServiceWaker
// a method the request path would never call.
func NewAdminWakeHandler(stats wakeStatsReader, waker ServiceWaker, platformName string) *AdminWakeHandler {
	return &AdminWakeHandler{stats: stats, waker: waker, platformName: platformName}
}

type adminWakeStatsResponse struct {
	Days     int                          `json:"days"`
	Services []adminWakeServiceStats      `json:"services"`
	Platform adminWakePlatformDescription `json:"platform"`
}

type adminWakeServiceStats struct {
	edge.ServiceWakeStats
	// Wakeable restates, per service, what the startup log says once: a
	// service with no URL configured is never woken, so a flat zero here
	// means "not covered", not "never slept". Without this the two are
	// indistinguishable and the chart quietly lies.
	Wakeable bool `json:"wakeable"`
}

type adminWakePlatformDescription struct {
	Name            string `json:"name"`
	RetryAfterHint  int    `json:"retryAfterSeconds"`
	WakeableService int    `json:"wakeableServiceCount"`
}

// Stats answers GET /api/admin/wake-stats.
func (handler *AdminWakeHandler) Stats(responseWriter http.ResponseWriter, request *http.Request) {
	days := parseWakeStatsDays(request.URL.Query().Get("days"))
	readContext, cancel := context.WithTimeout(request.Context(), wakeStatsReadTimeout)
	defer cancel()
	stats, err := handler.stats.WakeStats(readContext, wake.Services, time.Now().UTC(), days)
	if err != nil {
		httpx.WriteError(responseWriter, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Wake statistics are temporarily unavailable.")
		return
	}
	services := make([]adminWakeServiceStats, 0, len(wake.Services))
	wakeableCount := 0
	for _, service := range wake.Services {
		wakeable := handler.waker != nil && handler.waker.Supports(service)
		if wakeable {
			wakeableCount++
		}
		services = append(services, adminWakeServiceStats{ServiceWakeStats: stats[service], Wakeable: wakeable})
	}
	platform := adminWakePlatformDescription{Name: handler.platformName, WakeableService: wakeableCount}
	if platform.Name == "" {
		platform.Name = string(wake.PlatformNone)
	}
	if handler.waker != nil {
		platform.RetryAfterHint = edge.RetryAfterSeconds(handler.waker.RetryAfter())
	}
	httpx.WriteJSON(responseWriter, http.StatusOK, adminWakeStatsResponse{Days: days, Services: services, Platform: platform})
}

// parseWakeStatsDays clamps rather than rejects. This is a dashboard control,
// and a range slider that returns 400 teaches the operator to stop touching
// it; the bound exists to keep one MGET small, not to police the caller.
func parseWakeStatsDays(raw string) int {
	if raw == "" {
		return defaultWakeStatsDays
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days < 1 {
		return defaultWakeStatsDays
	}
	if days > maximumWakeStatsDays {
		return maximumWakeStatsDays
	}
	return days
}
