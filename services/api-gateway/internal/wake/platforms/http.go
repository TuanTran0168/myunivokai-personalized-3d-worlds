package platforms

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/myunivokai/myunivokai/services/api-gateway/internal/wake"
)

// HealthPath is the route each service binds purely so a scale-to-zero host
// sees an open port (agent-system/skills/production-deployment-guide.md §5.6). It is
// the cheapest thing to request and, being unauthenticated, the only route a
// wake could use before a session exists.
const HealthPath = "/healthz"

// HTTP wakes an instance by requesting it, which is the mechanism behind
// every scale-to-zero host this project has considered: Render free, Koyeb,
// Fly.io auto-start, Railway trial. Switching between them is a change of
// URL, not of code, which is why there is one adapter and not four.
//
// Targets are operator-supplied base URLs, never request-derived, so no user
// input reaches the outbound URL. They are validated at configuration load
// (internal/config) so a typo fails at startup instead of becoming a silent
// no-op at the moment it is needed.
type HTTP struct {
	targets    map[string]string
	httpClient *http.Client
}

func NewHTTP(targets map[string]string, httpClient *http.Client) *HTTP {
	return &HTTP{targets: targets, httpClient: httpClient}
}

func (platform *HTTP) Name() wake.PlatformName { return wake.PlatformHTTP }

func (platform *HTTP) Supports(service string) bool {
	_, found := platform.targets[service]
	return found
}

// Wake requests the target's health route and discards the body. The status
// code still decides nothing — the wake happened when the connection arrived,
// and a booting instance can legitimately answer 502 or nothing at all while
// it starts, so reading a verdict out of this response would be reading
// readiness out of a start signal.
//
// It is now REPORTED, which is a different thing from being judged. Discarding
// it made two opposite outcomes indistinguishable in production: a host that
// held the request for twelve seconds while it started the instance, and a
// host that answered instantly without starting anything. Both logged
// "wake call sent". See wake.WakeObservation.
func (platform *HTTP) Wake(ctx context.Context, service string) (wake.WakeObservation, error) {
	target, found := platform.targets[service]
	if !found {
		return wake.WakeObservation{}, fmt.Errorf("no wake target configured for service %q", service)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(target, "/")+HealthPath, nil)
	if err != nil {
		return wake.WakeObservation{}, fmt.Errorf("build wake request for %q: %w", service, err)
	}
	// Recorded even on the error path below, because a wake that ran out the
	// client's whole timeout and one that was refused in a millisecond are
	// the two cases an operator most needs to tell apart, and both arrive
	// here as a non-nil error.
	observation := wake.WakeObservation{Host: request.URL.Host}
	startedAt := time.Now()
	response, err := platform.httpClient.Do(request)
	observation.Elapsed = time.Since(startedAt)
	if err != nil {
		return observation, fmt.Errorf("send wake request to %q: %w", service, err)
	}
	defer func() { _ = response.Body.Close() }()
	observation.StatusCode = response.StatusCode
	// Drain so the connection returns to the pool instead of being dropped
	// mid-body; the payload itself is of no interest.
	_, _ = io.Copy(io.Discard, response.Body)
	return observation, nil
}
