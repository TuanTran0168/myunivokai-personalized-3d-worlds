package contracts

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"runtime/debug"
	"strings"
	"time"
)

// Service names as they appear on the wire. They double as the subject token,
// so a service cannot claim to be another one: the NATS ACL grants each user
// exactly its own literal started subject, which means identity is enforced by
// the broker rather than trusted from a payload field.
const (
	ServiceNameGateway   = "gateway"
	ServiceNameDNA       = "dna"
	ServiceNameUniverse  = "universe"
	ServiceNameNature    = "nature"
	ServiceNameOcean     = "ocean"
	ServiceNameAuth      = "auth"
	ServiceNameAnalytics = "analytics"
)

// ServiceNames is every process that announces itself, in a fixed order so
// dashboards and tests do not depend on map iteration.
var ServiceNames = []string{
	ServiceNameGateway,
	ServiceNameDNA,
	ServiceNameUniverse,
	ServiceNameNature,
	ServiceNameOcean,
	ServiceNameAuth,
	ServiceNameAnalytics,
}

// ServiceStartedEventSubject returns the subject a process announces itself
// on.
//
// A process cannot observe its own death - an OOM kill or SIGKILL runs no
// handler - so nothing here tries to report a stop. It reports the start
// instead, and a start nobody scheduled is the evidence that a stop happened.
// That inference works on every host, which is why this lives beside the
// domain contracts and not inside the gateway's wake mechanism: waking is a
// property of one hosting tier, restarting is a property of running software.
//
// analytics-service is the one process that never calls this. It is the
// consumer, so it already owns the only table involved and writes its own row
// directly - publishing to itself would buy nothing except an exception in
// the one ACL entry permitted to publish no myunivokai subject at all, and
// that absolute is worth more than the symmetry. See
// infra/nats/nats-server.conf and notes/knowledge/backend/source-overview.md.
func ServiceStartedEventSubject(serviceName string) (string, error) {
	for _, known := range ServiceNames {
		if known == serviceName {
			return fmt.Sprintf("myunivokai.events.%s.service.started.v1", serviceName), nil
		}
	}
	return "", fmt.Errorf("unknown service name %q", serviceName)
}

// AnalyticsServiceStartListQuerySubject reads the announcements back through
// the same admin path as every other analytics list.
const AnalyticsServiceStartListQuerySubject = "myunivokai.queries.analytics.service.start.list.v1"

// ServiceNameForStartedSubject is the inverse of ServiceStartedEventSubject,
// returning "" for anything else.
//
// A consumer needs this because the announcements are five literal subjects
// rather than one shared subject with the name in the body - which is what
// lets the broker enforce identity, at the cost of the reader having to map
// back. Deriving the name from the subject also means a payload claiming to
// be another service is caught rather than trusted.
func ServiceNameForStartedSubject(subject string) string {
	for _, serviceName := range ServiceNames {
		if candidate, err := ServiceStartedEventSubject(serviceName); err == nil && candidate == subject {
			return serviceName
		}
	}
	return ""
}

// ServiceStartedData is what a process knows about itself at boot, and
// deliberately nothing more.
//
// It carries no reason for the restart because no process has one: from
// inside, a cold start on a scale-to-zero host, a deploy and a recovery from
// an OOM kill are indistinguishable. Attributing a cause is the reader's job,
// by correlating this with the deploy history and - while the platform makes
// it necessary - with the gateway's wake records.
type ServiceStartedData struct {
	// Service is redundant with the subject on purpose: a consumer reading a
	// stored row should not have to re-parse a subject to know whose row it
	// is, and the two disagreeing is a contract violation worth failing on.
	Service string `json:"service"`
	// InstanceID is generated fresh at every boot. It is what separates "one
	// process running for a week" from "seven crash-restarts", which a
	// timestamp alone cannot express.
	InstanceID string `json:"instanceId"`
	// Version is the build this process is running - a commit SHA where CI
	// supplies one, otherwise "unknown". Never fabricated: a wrong version is
	// worse than an absent one when the question is which build broke.
	Version string `json:"version"`
	// BootDurationMS is process start to ready-to-serve. On a scale-to-zero
	// host this is the number that decides whether the client's Retry-After
	// is long enough, which is otherwise guesswork.
	BootDurationMS int64 `json:"bootDurationMs"`
}

// NewServiceStartedData fills in what a process can say about itself. It
// lives here rather than in each service because six near-identical copies of
// version resolution is exactly how six services end up reporting versions in
// three different formats.
//
// bootDuration is measured by the caller, from process start to the moment it
// is ready to serve. Only the caller knows where "ready" is: for a NATS worker
// it is after its subscriptions are registered, not after main() begins.
func NewServiceStartedData(serviceName string, bootDuration time.Duration) ServiceStartedData {
	return ServiceStartedData{
		Service:        serviceName,
		InstanceID:     newInstanceID(),
		Version:        BuildVersion(),
		BootDurationMS: bootDuration.Milliseconds(),
	}
}

// BuildVersion resolves the running build without depending on any host.
//
// SERVICE_VERSION wins so a platform that knows its commit can supply it;
// otherwise the Go toolchain's VCS stamp is used, which is present for a
// plain `go build` inside the repository. When neither exists the answer is
// "unknown", never a guess - a wrong version is worse than an absent one when
// the question being asked is which build broke.
func BuildVersion() string {
	// SERVICE_VERSION is ours and wins. The rest are host conventions, tried
	// in order because a container image carries no VCS stamp - Go embeds one
	// only when it builds inside a repository, which a multi-stage Dockerfile
	// is not. Supporting another platform later is one more string here.
	for _, variable := range []string{"SERVICE_VERSION", "RENDER_GIT_COMMIT"} {
		if version := strings.TrimSpace(os.Getenv(variable)); version != "" {
			return version
		}
	}
	if buildInfo, available := debug.ReadBuildInfo(); available {
		for _, setting := range buildInfo.Settings {
			if setting.Key == "vcs.revision" && setting.Value != "" {
				return setting.Value
			}
		}
	}
	return "unknown"
}

// newInstanceID is random rather than sequential or host-derived. Two
// instances of one service can run at once during a deploy, and a container
// hostname is reused across restarts on some hosts - either would merge two
// boots into one row and hide exactly the restart this is meant to reveal.
//
// It falls back to a timestamp only if the system entropy source fails, which
// keeps a service startable in a situation where nothing else would be.
func newInstanceID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UTC().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

// Validate keeps a malformed announcement out of the read model. It is
// deliberately strict about Service and InstanceID and lenient about the rest:
// the first two are the identity of the row, while a missing version or a
// zero boot time is a gap in a chart, not a reason to reject the fact that a
// process started.
func (data ServiceStartedData) Validate() error {
	if data.InstanceID == "" {
		return errors.New("instanceId is required")
	}
	for _, known := range ServiceNames {
		if known == data.Service {
			return nil
		}
	}
	return fmt.Errorf("unknown service name %q", data.Service)
}

// ServiceStartListQueryData reads the announcements back. Keyset pagination on
// (started_at, instance_id) like every other analytics list, so the hundredth
// page costs what the first one does.
type ServiceStartListQueryData struct {
	PageQueryData
	Service string `json:"service,omitempty"`
}

type ServiceStartListResponseData struct {
	Starts     []ServiceStartRecord `json:"starts"`
	PageSize   int                  `json:"pageSize"`
	NextCursor string               `json:"nextCursor,omitempty"`
	TotalCount int                  `json:"totalCount"`
}

type ServiceStartRecord struct {
	Service        string    `json:"service"`
	InstanceID     string    `json:"instanceId"`
	Version        string    `json:"version"`
	BootDurationMS int64     `json:"bootDurationMs"`
	StartedAt      time.Time `json:"startedAt"`
}
