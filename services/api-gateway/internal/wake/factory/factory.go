// Package factory turns the configured platform name into a wake
// coordinator, and is the only place that knows which adapter goes with which
// name — the same job services/dna-service/internal/aifactory does for AI
// providers, kept in its own package for the same reason: config must not
// import the adapters, and the adapters must not import config.
package factory

import (
	"fmt"
	"net/http"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake/platforms"
)

// NewCoordinator fails on an unknown platform name rather than falling back to
// "none". A typo in SERVICE_WAKE_PLATFORM should stop the deploy, not quietly
// produce a gateway that never wakes anything and reports plain 503s months
// later.
//
// That is the only fatal case. An unknown name is a mistake — nothing the
// operator can do makes it mean something. Missing targets are a stage: the
// URLs are real, they are simply not known yet. The distinction is what
// decides which of the two stops a deploy; see the http case below.
func NewCoordinator(serviceConfig config.Config, lock wake.SingleFlightLock, stats wake.StatsRecorder) (*wake.Coordinator, error) {
	platform, err := newPlatform(serviceConfig.ServiceWakePlatform, serviceConfig)
	if err != nil {
		return nil, err
	}
	return wake.NewCoordinator(
		platform,
		lock,
		stats,
		serviceConfig.ServiceWakeTimeout,
		serviceConfig.ServiceWakeLockTimeToLive,
		serviceConfig.ServiceWakeRetryAfter,
	), nil
}

func newPlatform(platformName string, serviceConfig config.Config) (wake.Platform, error) {
	switch wake.PlatformName(platformName) {
	case wake.PlatformNone:
		return platforms.NewNone(), nil
	case wake.PlatformHTTP:
		// Deliberately builds with no targets at all. An earlier version made
		// that fatal, which crash-looped the gateway on the first deploy of
		// the blueprint: Render free instances cannot be woken over the
		// private network, so the targets must be public .onrender.com URLs,
		// and those do not exist until the services they name have been
		// created by that very deploy. Fatal there is a startup ordering
		// requirement the platform makes impossible to satisfy.
		//
		// It was also inconsistent with the design either side of it. Four
		// missing URLs out of five is already handled gracefully — Supports
		// answers false and those services keep reporting plain
		// SERVICE_UNAVAILABLE — so making the fifth one fatal drew a cliff
		// where the design says there is a slope. And the same question was
		// already settled once in this codebase: ADMIN_ROUTES_ENABLED
		// defaults false precisely so "a fresh deploy of this binary must not
		// crash-loop the product edge over admin-only vars nobody has filled
		// in yet" (internal/config/config.go). Waking is likewise an optional
		// capability of the edge, not a precondition for serving traffic.
		//
		// The state is not silent: cmd/gateway logs at startup exactly which
		// services this deploy can reach, and warns when the answer is none.
		return platforms.NewHTTP(serviceConfig.ServiceWakeTargets, &http.Client{Timeout: serviceConfig.ServiceWakeTimeout}), nil
	default:
		return nil, fmt.Errorf("unsupported service wake platform %q", platformName)
	}
}
