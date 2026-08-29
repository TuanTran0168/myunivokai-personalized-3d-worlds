// Package wake starts hosting instances that have been put to sleep for
// being idle.
//
// It exists because of one constraint, not one vendor: on a scale-to-zero
// plan an instance wakes only on inbound traffic, and every service behind
// this gateway is a pure NATS consumer that receives none. A query against a
// sleeping service therefore gets an immediate `no-responders` reply — not a
// timeout — and nothing in normal operation ever wakes it back up. See
// agent-system/plans/architecture/service-wake-mechanism.md.
//
// The package is split the same way services/dna-service/internal/ai is:
// Platform adapters are dumb and know only their vendor's mechanism, while
// Coordinator owns the policy every platform shares (single-flight, detached
// context, fire-and-forget) — mirroring ai.Provider and ai.Orchestrator. That
// split is what keeps a second hosting platform a new file plus one switch
// case, instead of an edit to the request path.
//
// # Removing this
//
// This is a workaround for a hosting plan, not a product feature, and it is
// built to be deleted rather than maintained forever. Everything it owns —
// interface, adapters, coordinator, factory — is under this one directory so
// that "delete the mechanism" is a real instruction and not an archaeology
// exercise.
//
// Turning it off costs nothing and needs no code change: set
// SERVICE_WAKE_PLATFORM=none. Coordinator then short-circuits at Supports and
// the gateway goes back to reporting a missing responder as plain
// SERVICE_UNAVAILABLE. That is the step to take on moving to a paid plan, a
// real background worker, or any host whose instances do not sleep. Leave the
// code in place; it costs one map lookup per failed request.
//
// Deleting it is `rm -r internal/wake` plus these call sites, which are the
// complete list — a test in internal/config guards the one indirect coupling
// (serviceWakeURLKeys against Services):
//
//   - cmd/gateway/main.go — drop the factory call and the NewRouter argument
//   - internal/handlers/router.go — drop the ServiceWaker parameter
//   - internal/handlers/rpc_transport.go — drop ServiceWaker, the waker field,
//     Wake, Seen, and the ErrNoResponders case in classifyTransportError.
//     Keep the three-way error split itself if anything is kept: no-responders
//     means something different from a deadline on any host.
//   - internal/handlers/world_handler.go — drop familyService and the two
//     proactive Wake calls in CreateWorld. wakeReadModel is a different
//     question with a different answer: it exists because a scale-to-zero read
//     model can miss events permanently, so it survives on any host where
//     analytics-service still sleeps and dies with the tier that makes it
//     sleep, not with this package. See its own doc comment.
//   - internal/config/config.go — drop the four ServiceWake* fields,
//     serviceWakeURLKeys, readServiceWakeTargets, serviceWakeConfigured and
//     their validation
//   - cmd/gateway/main.go — also drop logServiceWake
//   - internal/edge/redis.go — drop AcquireWakeLock, RecordWakeSent,
//     RecordServiceSeen, ConsecutiveFailedWakes, WakeStats, ServiceWakeStats
//     and the four wake key segments
//   - internal/handlers/admin_wake_handler.go — delete the file, and drop the
//     /wake-stats route from internal/handlers/admin_router.go
//   - contracts/openapi-admin.yaml — drop /api/admin/wake-stats and WakeStats
//   - render.yaml, .env.example — drop the wake block
//   - apps/*/src — src/lib/wake-retry.ts and its call sites; keep
//     src/lib/relay-headers.ts, which Retry-After needs for rate limiting too
//
// The statistics go with it, deliberately. They count wakes and stamp the
// last moment a service answered, and on a host whose instances do not sleep
// there are no wakes to count and the stamp is always now. Durable
// service-lifecycle history is a different question with a different answer —
// startup events emitted by each service, which survive this directory
// because restarts happen on every platform. See
// agent-system/evolution/platform-evolution-research.md, Track B.
//
// # A VPS is not that host
//
// Self-hosting is the one destination where none of the above applies, and
// PlatformNone is the wrong setting. A supervisor (systemd, restart:
// unless-stopped) takes over restarting, so the wake call stops mattering —
// but no-responders stops meaning "asleep" and starts meaning "crashed", which
// makes the classification and the give-up tally worth more than they were
// here, not less. The tally is the wrinkle: it is incremented inside
// wakeDetached, which PlatformNone short-circuits, so silencing the wake also
// silences the detection. Keeping platform=http with internal targets
// (http://dna-service:8080) keeps everything working with no code change.
// See agent-system/plans/architecture/service-wake-mechanism.md#reuse-on-a-self-hosted-vps.
//
// Two things are worth keeping even then, and neither depends on this package:
// Retry-After in the admin router's exposed CORS headers, and *some*
// distinction between "nobody was subscribed" and "the broker failed" —
// no-responders is a normal production event during a rolling deploy, a
// crash-restart or an OOM-kill, and the gateway discarded that signal entirely
// before this existed. If SERVICE_WAKING goes away, log the case instead.
package wake

import (
	"context"
	"strings"
)

// PlatformName selects the wake adapter at startup, like ai.ProviderName
// selects the AI adapter. Values are mechanisms, not brand names, because the
// mechanism is what the code differs on: several vendors share one adapter.
type PlatformName string

const (
	// PlatformNone performs no wake at all and is the default, for the same
	// reason ai.ProviderMock is the AI default: the shipped configuration
	// must make no outbound call to anybody's infrastructure until an
	// operator opts in.
	//
	// It is also the permanently correct choice on any always-on host — a
	// paid instance, a real background worker, a Kubernetes Deployment with
	// a non-zero replica count. Leaving free tier is then a config change,
	// not a code change.
	PlatformNone PlatformName = "none"

	// PlatformHTTP wakes an instance by sending it an HTTP request, which is
	// how every scale-to-zero host in this class behaves: Render free,
	// Koyeb, Fly.io auto-start, Railway's trial plan. One adapter serves all
	// of them because the vendor differs only in the URL an operator pastes
	// into configuration.
	PlatformHTTP PlatformName = "http"
)

// Service names, matching the token that follows "myunivokai.queries." in
// every request/reply subject this gateway sends.
const (
	ServiceDNA       = "dna"
	ServiceUniverse  = "universe"
	ServiceNature    = "nature"
	ServiceOcean     = "ocean"
	ServiceAuth      = "auth"
	ServiceAnalytics = "analytics"
	ServiceTelemetry = "telemetry"
)

// Services lists every service the gateway can wake, in the order an operator
// meets them in configuration. The gateway itself is deliberately absent: it
// is the one component that receives inbound HTTP in normal operation, so a
// browser request already wakes it and nothing needs to ask.
var Services = []string{ServiceDNA, ServiceUniverse, ServiceNature, ServiceOcean, ServiceAuth, ServiceAnalytics, ServiceTelemetry}

// Platform is one hosting provider's answer to "start this sleeping
// instance". Adapters stay deliberately dumb — no retry, no deduplication, no
// goroutine — exactly as ai.Provider adapters do no repair or fallback of
// their own. Coordinator supplies all of that.
type Platform interface {
	Name() PlatformName

	// Supports reports whether this platform can wake the named service,
	// which in practice means an operator supplied a target for it. The
	// gateway asks before promising a client that a service is waking up:
	// answering SERVICE_WAKING for something unreachable would send the
	// caller into a retry loop that can never succeed.
	Supports(service string) bool

	// Wake asks the platform to start the service and returns once the
	// request has been delivered.
	//
	// A nil error means the platform was told, NOT that the service can
	// answer a query — cold start continues long after this returns. Callers
	// must never treat nil as readiness; see
	// agent-system/plans/architecture/service-wake-mechanism.md#healthz-is-a-start-signal-not-a-readiness-signal.
	Wake(ctx context.Context, service string) error
}

const querySubjectPrefix = "myunivokai.queries."

// ServiceForSubject reads the responder's name out of a request/reply
// subject. Every such subject is "myunivokai.queries.<service>.<...>", so the
// name is derived rather than looked up — a table mapping each of the ~30
// subject constants to a service would be one more thing to forget to update
// when a subject is added.
//
// An unrecognised prefix or an unknown service yields "", and the gateway
// never wakes what it cannot name.
func ServiceForSubject(subject string) string {
	remainder, found := strings.CutPrefix(subject, querySubjectPrefix)
	if !found {
		return ""
	}
	service, _, _ := strings.Cut(remainder, ".")
	switch service {
	case ServiceDNA, ServiceUniverse, ServiceNature, ServiceOcean, ServiceAuth, ServiceAnalytics, ServiceTelemetry:
		return service
	default:
		return ""
	}
}
