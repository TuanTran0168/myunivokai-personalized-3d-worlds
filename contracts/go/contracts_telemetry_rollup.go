package contracts

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// This file is the HTTP/NATS/cache rollup contract. It is deliberately
// separate from contracts_telemetry.go, which carries fleet start telemetry —
// the two share a word and nothing else. A service start is one row per boot
// answering "how often did this restart"; a rollup is an aggregate over every
// request in an interval answering "what is the platform doing". Different
// producers, different volumes, different owning service.
//
// Every type below has a hand-maintained mirror in contracts/rust, and both
// are decoded from contracts/fixtures/telemetry-http-rollup-event.v1.json by
// their own test suite. That fixture is the only thing keeping the two
// languages honest — see notes/plans/services/telemetry-service-plan.md#rust-contracts.

const (
	// TelemetryHTTPRollupEventSubject needed no stream or ACL change: it
	// already matches MYUNIVOKAI_EVENTS's existing "myunivokai.events.>"
	// filter, the same free ride world.changed got.
	//
	// It is published through JetStream rather than Core NATS, unlike what
	// the first draft of the plan proposed. telemetry-service sleeps on the
	// free tier, and Core NATS delivers to whoever is subscribed right now or
	// not at all — which would lose every interval for as long as the service
	// slept, not merely one interval on an unclean shutdown. See
	// notes/plans/services/telemetry-service-plan.md#durability-and-wake.
	TelemetryHTTPRollupEventSubject = "myunivokai.events.telemetry.http.v1"

	// The query subjects follow the same "myunivokai.queries.<service>.*"
	// shape as everyone else's, which is the whole reason
	// wake.ServiceForSubject needs no telemetry-specific branch.
	TelemetryOverviewGetQuerySubject = "myunivokai.queries.telemetry.overview.get.v1"
	TelemetryRouteListQuerySubject   = "myunivokai.queries.telemetry.route.list.v1"

	// Sink names, on the wire because the admin app has to render a different
	// screen depending on which one answered — a missing chart must read as
	// "look elsewhere", never as a broken screen.
	TelemetrySinkPostgres = "postgres"
	TelemetrySinkOTLP     = "otlp"

	// The request funnel's stages. Each one is a strict subset of the one
	// before it — everything that arrived, the part of it that was a valid
	// request, and the part of THAT the platform actually answered.
	//
	// The nesting is the whole contract. An earlier version of this funnel put
	// backend round trips in the middle two stages, which produced
	// 302 -> 19 -> 19 -> 302 on a real window: most traffic is health checks
	// and 404s that never reach a backend, so the shape collapsed and then
	// fully recovered. Four counters in a row are not a funnel unless each
	// contains the next, and a chart that implies containment it does not have
	// is worse than four separate numbers. Backend fan-out is a ratio, not a
	// stage, and is reported on its own.
	//
	// Stable keys rather than the labels beside them: the admin app colours and
	// orders by these, so a reworded label must not become a new stage.
	TelemetryFunnelStageReceived = "received"
	TelemetryFunnelStageAccepted = "accepted"
	TelemetryFunnelStageServed   = "served"

	// Windows are in hours rather than the days analytics uses: a bucket here
	// is one minute wide and the questions are operational ("what happened
	// this afternoon"), not historical. The maximum matches
	// MYUNIVOKAI_EVENTS's own 7-day retention — asking for more than the
	// stream could ever have delivered is a question with no honest answer.
	TelemetryDefaultHours = 24
	TelemetryMaximumHours = 168

	// TelemetryStatusClassMinimum and TelemetryStatusClassMaximum bound the
	// leading digit of an HTTP status. 1xx is included because a bucket key
	// that silently drops a class is worse than one that reports a class
	// nobody expected.
	TelemetryStatusClassMinimum = 1
	TelemetryStatusClassMaximum = 5

	// TelemetryHistogramBucketCount is fixed at 8 on purpose: a histogram
	// whose bucket count can vary per message cannot be summed across
	// messages, and summing across messages is the only thing this histogram
	// exists for.
	TelemetryHistogramBucketCount = 8
)

// TelemetryHistogramUpperBoundsMS are the seven finite bucket edges; the
// eighth bucket is everything above the last one. These numbers are duplicated
// in contracts/rust and asserted by a test on both sides, because a percentile
// interpolated against the wrong edges is wrong in a way that looks right.
//
// The edges are cumulative-exclusive: bucket i counts observations with
// duration <= TelemetryHistogramUpperBoundsMS[i] that did not already fall
// into an earlier bucket, so the buckets partition the range rather than
// nesting the way a Prometheus `le` series does.
var TelemetryHistogramUpperBoundsMS = [TelemetryHistogramBucketCount - 1]int64{5, 10, 25, 50, 100, 250, 1000}

// TelemetryHistogram is the fixed-width latency histogram carried by every
// bucket type below.
//
// It is an array rather than a slice so a producer cannot construct one of the
// wrong length. Note the asymmetry with the Rust mirror, which is worth
// knowing before trusting it: serde rejects a JSON array of the wrong length
// outright, while encoding/json silently zero-fills a short one and discards a
// long one. Validate below closes that gap for anything this side decodes.
type TelemetryHistogram [TelemetryHistogramBucketCount]int64

// HTTPRollupBucket is one {route, method, status class} cell of one interval.
//
// RoutePattern is chi's route TEMPLATE — "/api/universe/worlds/{worldID}" —
// and never request.URL.Path. This is the single rule that decides whether
// this system stays inside a free metrics tier or grows series without bound;
// see notes/evolution/telemetry-architecture-research.md, which measured ~200
// series for the whole gateway under this rule.
type HTTPRollupBucket struct {
	RoutePattern  string             `json:"routePattern"`
	Method        string             `json:"method"`
	StatusClass   int                `json:"statusClass"`
	RequestCount  int64              `json:"requestCount"`
	DurationSumMS int64              `json:"durationSumMs"`
	DurationMaxMS int64              `json:"durationMaxMs"`
	Histogram     TelemetryHistogram `json:"histogram"`
	// ErrorCodes counts the gateway's own error codes inside this bucket —
	// SERVICE_WAKING, SERVICE_TIMEOUT, RATE_LIMITED. It is what makes the
	// wake-conversion rate answerable at all, and it is omitted rather than
	// sent empty because most buckets are 2xx and carry none.
	ErrorCodes map[string]int64 `json:"errorCodes,omitempty"`
}

// NATSBackendBucket measures the gateway's round trip to one backend service.
//
// It exists because end-to-end response time is not the same question as
// "which backend is slow": a request under /api/{family}/worlds reaches
// universe or nature depending on the family, and the HTTP route alone cannot
// tell them apart. Service is wake.ServiceForSubject's answer, which the
// gateway already computes on every request/reply call.
type NATSBackendBucket struct {
	Service       string             `json:"service"`
	RequestCount  int64              `json:"requestCount"`
	DurationSumMS int64              `json:"durationSumMs"`
	DurationMaxMS int64              `json:"durationMaxMs"`
	Histogram     TelemetryHistogram `json:"histogram"`
	// ErrorCount includes no-responders and deadline exceeded, which are the
	// two failures a sleeping service actually produces.
	ErrorCount int64 `json:"errorCount"`
}

// CacheBucket answers whether a Redis namespace earns its keep. The three
// namespaces (job:v1, world:v1, share:v1) are documented in README.md but
// their hit rate has never been measured.
type CacheBucket struct {
	Namespace string `json:"namespace"`
	Hits      int64  `json:"hits"`
	Misses    int64  `json:"misses"`
}

// HTTPRollupData is one flush: everything one gateway instance observed in one
// interval, in one message.
//
// All three concerns ride in the same envelope rather than in three publishes,
// so a flush is one message, one ack and one idempotency check — the same
// discipline the base rollup already established.
type HTTPRollupData struct {
	// InstanceID names which gateway instance flushed this. Two instances
	// during a rolling deploy produce two envelopes for the same bucket start,
	// and the consumer must add them rather than treat the second as a
	// duplicate of the first.
	InstanceID string `json:"instanceId"`
	// BucketStart is the interval's start, truncated to the interval so two
	// instances agree on a boundary without coordinating.
	BucketStart time.Time `json:"bucketStart"`
	// BucketDurationMS is how wide that interval was. Without it a reader
	// cannot turn a count into a rate, and the flush interval is
	// operator-configurable — so inferring the width from the gap between two
	// bucket starts would be wrong on exactly the deploys where it matters.
	BucketDurationMS   int64               `json:"bucketDurationMs"`
	Buckets            []HTTPRollupBucket  `json:"buckets"`
	NATSBackendBuckets []NATSBackendBucket `json:"natsBackendBuckets"`
	CacheBuckets       []CacheBucket       `json:"cacheBuckets"`
}

// Validate rejects an envelope that would corrupt a rollup rather than merely
// look odd. It is strict about identity and the bucket keys — those become
// primary-key columns — and lenient about counts being zero, because an
// interval in which nothing happened to a route is a real thing to report.
func (data HTTPRollupData) Validate() error {
	if strings.TrimSpace(data.InstanceID) == "" {
		return errors.New("instanceId is required")
	}
	if data.BucketStart.IsZero() {
		return errors.New("bucketStart is required")
	}
	if data.BucketDurationMS <= 0 {
		return errors.New("bucketDurationMs must be positive")
	}
	for bucketIndex, bucket := range data.Buckets {
		if strings.TrimSpace(bucket.RoutePattern) == "" {
			return fmt.Errorf("buckets.%d.routePattern is required", bucketIndex)
		}
		if strings.TrimSpace(bucket.Method) == "" {
			return fmt.Errorf("buckets.%d.method is required", bucketIndex)
		}
		if bucket.StatusClass < TelemetryStatusClassMinimum || bucket.StatusClass > TelemetryStatusClassMaximum {
			return fmt.Errorf("buckets.%d.statusClass must be %d-%d", bucketIndex, TelemetryStatusClassMinimum, TelemetryStatusClassMaximum)
		}
		if bucket.RequestCount < 0 || bucket.DurationSumMS < 0 || bucket.DurationMaxMS < 0 {
			return fmt.Errorf("buckets.%d counters must not be negative", bucketIndex)
		}
	}
	for bucketIndex, bucket := range data.NATSBackendBuckets {
		if strings.TrimSpace(bucket.Service) == "" {
			return fmt.Errorf("natsBackendBuckets.%d.service is required", bucketIndex)
		}
		if bucket.RequestCount < 0 || bucket.ErrorCount < 0 {
			return fmt.Errorf("natsBackendBuckets.%d counters must not be negative", bucketIndex)
		}
	}
	for bucketIndex, bucket := range data.CacheBuckets {
		if strings.TrimSpace(bucket.Namespace) == "" {
			return fmt.Errorf("cacheBuckets.%d.namespace is required", bucketIndex)
		}
		if bucket.Hits < 0 || bucket.Misses < 0 {
			return fmt.Errorf("cacheBuckets.%d counters must not be negative", bucketIndex)
		}
	}
	return nil
}

// IsEmpty reports an interval in which nothing at all was observed. The
// gateway skips publishing one: an envelope carrying no bucket costs a
// JetStream write and a consumer wake-up to say nothing.
func (data HTTPRollupData) IsEmpty() bool {
	return len(data.Buckets) == 0 && len(data.NATSBackendBuckets) == 0 && len(data.CacheBuckets) == 0
}

// TelemetryRollupMessageID is the identity of one flush, used in three places
// that must agree: the envelope's jobId, the JetStream Msg-Id header, and the
// consumer's inbox row.
//
// It is {instance, bucket start} rather than a random id because that pair is
// exactly what makes a redelivery distinguishable from a genuine second
// envelope: two gateway instances flushing the same interval are two facts and
// must both be stored, while the same instance's interval arriving twice is
// one fact delivered twice. A random id would make the second case
// indistinguishable from the first.
func TelemetryRollupMessageID(instanceID string, bucketStart time.Time) string {
	return instanceID + ":" + bucketStart.UTC().Format(time.RFC3339)
}

// TelemetryOverviewQueryData scopes the Telemetry screen's top half. Hours is
// clamped by NormalizeTelemetryHours in the service, never at the edge.
type TelemetryOverviewQueryData struct {
	Hours int `json:"hours,omitempty"`
}

// TelemetryRouteListQueryData scopes the per-route table. It carries no cursor
// because the row count is bounded by the gateway's route table — roughly 50
// templates — rather than by traffic, so there is nothing to paginate.
type TelemetryRouteListQueryData struct {
	Hours int `json:"hours,omitempty"`
}

// TelemetrySinkDescriptor is on every telemetry response, not only the ones
// that fail to answer.
//
// The OTLP sink cannot answer a range query — once data is pushed to Grafana,
// Grafana owns the query surface — and the admin app must show that as "the
// charts are over there", never as an empty chart or a 501. Putting the
// descriptor on every response means the screen reads one field to decide,
// instead of inferring intent from a missing array.
type TelemetrySinkDescriptor struct {
	Sink string `json:"sink"`
	// ChartsAvailable is false when this sink stores nothing locally.
	ChartsAvailable bool `json:"chartsAvailable"`
	// DashboardURL is where to look instead, when ChartsAvailable is false.
	// Empty means nobody configured one, which the screen states plainly
	// rather than rendering a dead link.
	DashboardURL string `json:"dashboardUrl,omitempty"`
}

// TelemetryVolumePoint is one time bucket of the volume chart. Buckets with no
// traffic are returned as explicit zeroes rather than omitted, so a chart
// renders a flat line instead of interpolating across a gap — the same rule
// AnalyticsTimeseriesPoint follows.
type TelemetryVolumePoint struct {
	BucketStart   time.Time `json:"bucketStart"`
	RequestCount  int64     `json:"requestCount"`
	ErrorCount    int64     `json:"errorCount"`
	P95DurationMS int       `json:"p95DurationMs"`
}

// TelemetryStatusClassCount is one slice of the status mix. StatusClass is the
// leading digit, so there are at most five of these.
type TelemetryStatusClassCount struct {
	StatusClass  int   `json:"statusClass"`
	RequestCount int64 `json:"requestCount"`
}

type TelemetryErrorCodeCount struct {
	ErrorCode string `json:"errorCode"`
	Count     int64  `json:"count"`
}

// TelemetryBackendSummary is one backend service's round-trip summary.
type TelemetryBackendSummary struct {
	Service           string `json:"service"`
	RequestCount      int64  `json:"requestCount"`
	ErrorCount        int64  `json:"errorCount"`
	AverageDurationMS int    `json:"averageDurationMs"`
	P50DurationMS     int    `json:"p50DurationMs"`
	P95DurationMS     int    `json:"p95DurationMs"`
	SlowestDurationMS int    `json:"slowestDurationMs"`
}

// TelemetryCacheSummary is one Redis namespace's hit rate.
type TelemetryCacheSummary struct {
	Namespace      string  `json:"namespace"`
	Hits           int64   `json:"hits"`
	Misses         int64   `json:"misses"`
	HitRatePercent float64 `json:"hitRatePercent"`
}

// TelemetryDelta compares one measure against the window of the same width
// immediately before it — the "vs yesterday" on every card.
//
// Both absolute values travel with the percentage on purpose. A change of
// +100% is a different fact when it is 2 requests becoming 4 than when it is
// 20,000 becoming 40,000, and a card showing only the percentage cannot tell
// the reader which one they are looking at.
type TelemetryDelta struct {
	Current       int64   `json:"current"`
	Previous      int64   `json:"previous"`
	ChangePercent float64 `json:"changePercent"`
	// HasBaseline is false when the previous window holds no data at all,
	// which is not the same as a previous value of zero. A service that was
	// asleep, or was deployed an hour ago, has no baseline — and "+100%"
	// rendered against nothing is a fabricated comparison.
	HasBaseline bool `json:"hasBaseline"`
}

// TelemetryComparison is the whole "vs the previous window" block. Errors is
// deliberately the error COUNT rather than the rate: two rates subtract into a
// percentage-point difference, and calling that a percent change is the most
// common way this kind of card ends up lying.
type TelemetryComparison struct {
	PreviousWindowStart time.Time      `json:"previousWindowStart"`
	Requests            TelemetryDelta `json:"requests"`
	Errors              TelemetryDelta `json:"errors"`
	P95DurationMS       TelemetryDelta `json:"p95DurationMs"`
}

// TelemetryFunnelStage is one step of the request funnel. Stage is a stable
// machine key; Label is what a chart prints.
//
// PercentOfEntry is relative to the FIRST stage rather than the previous one,
// because a funnel whose every step is a percentage of the step before it
// cannot be read end to end without multiplying in your head.
type TelemetryFunnelStage struct {
	Stage          string  `json:"stage"`
	Label          string  `json:"label"`
	Count          int64   `json:"count"`
	PercentOfEntry float64 `json:"percentOfEntry"`
}

// TelemetryHourBucket is one hour of the day, summed across every day in the
// window. This answers a question the raw timeline cannot: not "when was it
// busy once" but "when is it reliably busy" — which is the one that decides
// when a deploy is cheap.
type TelemetryHourBucket struct {
	// Hour is 0-23, UTC. The admin app renders the timezone next to it
	// rather than converting, so that two operators in two countries are
	// always reading the same number.
	Hour          int   `json:"hour"`
	RequestCount  int64 `json:"requestCount"`
	ErrorCount    int64 `json:"errorCount"`
	P95DurationMS int   `json:"p95DurationMs"`
}

// TelemetryOverviewResponseData answers the Telemetry screen's top half.
//
// PercentileIsInterpolated is a field rather than a footnote in a document
// because the admin UI is required to render it: every percentile here is an
// interpolation across fixed histogram edges, and a p95 that looks exact and
// is not is worse than no p95 at all.
type TelemetryOverviewResponseData struct {
	TelemetrySinkDescriptor
	Hours             int       `json:"hours"`
	GeneratedAt       time.Time `json:"generatedAt"`
	TotalRequests     int64     `json:"totalRequests"`
	ErrorRequests     int64     `json:"errorRequests"`
	ErrorRatePercent  float64   `json:"errorRatePercent"`
	AverageDurationMS int       `json:"averageDurationMs"`
	// P50 travels beside P95 everywhere it appears. The gap between them is
	// the actual finding: a p50 of 40ms under a p95 of 900ms is a tail
	// problem, and the same p95 under a p50 of 700ms is a capacity problem.
	// One number alone cannot tell those apart.
	P50DurationMS            int                         `json:"p50DurationMs"`
	P95DurationMS            int                         `json:"p95DurationMs"`
	SlowestDurationMS        int                         `json:"slowestDurationMs"`
	PercentileIsInterpolated bool                        `json:"percentileIsInterpolated"`
	StatusMix                []TelemetryStatusClassCount `json:"statusMix"`
	VolumePoints             []TelemetryVolumePoint      `json:"volumePoints"`
	// HourlyPoints is the same traffic rolled up to the hour. VolumePoints is
	// minute-resolution and a 7-day window holds 10,080 of them, which is a
	// chart nobody can read and a payload nobody needs; this is the series
	// the trend line is actually drawn from.
	HourlyPoints []TelemetryVolumePoint `json:"hourlyPoints"`
	// PeakHour is the busiest single hour in the window, or absent when the
	// window holds nothing at all.
	PeakHour  *TelemetryVolumePoint `json:"peakHour,omitempty"`
	HourOfDay []TelemetryHourBucket `json:"hourOfDay"`
	// Comparison is absent for a window with no measurable predecessor —
	// see TelemetryDelta.HasBaseline.
	Comparison    *TelemetryComparison      `json:"comparison,omitempty"`
	TrafficFunnel []TelemetryFunnelStage    `json:"trafficFunnel"`
	ErrorCodeTop  []TelemetryErrorCodeCount `json:"errorCodeTop"`
	Backends      []TelemetryBackendSummary `json:"backends"`
	Cache         []TelemetryCacheSummary   `json:"cache"`
	// WakeSignals is the SERVICE_WAKING count per time bucket — the closest
	// this schema gets to the wake-conversion rate. It is an approximation
	// joined on time proximity, not a per-request causal trace, and the admin
	// UI must say so. An exact version is a real schema change nobody has
	// asked for yet.
	WakeSignals []TelemetryVolumePoint `json:"wakeSignals"`
	// OldestBucketStart is what actually exists in the store, which is not
	// always what was asked for: a service that has been asleep for a week has
	// no data for most of a 24-hour window, and a chart that does not say so
	// reads as "no traffic" rather than "no data".
	OldestBucketStart *time.Time `json:"oldestBucketStart,omitempty"`
}

// TelemetryRouteSummary is one row of the per-route table.
type TelemetryRouteSummary struct {
	RoutePattern      string  `json:"routePattern"`
	Method            string  `json:"method"`
	RequestCount      int64   `json:"requestCount"`
	ErrorCount        int64   `json:"errorCount"`
	ErrorRatePercent  float64 `json:"errorRatePercent"`
	AverageDurationMS int     `json:"averageDurationMs"`
	P50DurationMS     int     `json:"p50DurationMs"`
	P95DurationMS     int     `json:"p95DurationMs"`
	SlowestDurationMS int     `json:"slowestDurationMs"`
}

type TelemetryRouteListResponseData struct {
	TelemetrySinkDescriptor
	Hours                    int                     `json:"hours"`
	GeneratedAt              time.Time               `json:"generatedAt"`
	PercentileIsInterpolated bool                    `json:"percentileIsInterpolated"`
	Routes                   []TelemetryRouteSummary `json:"routes"`
}

// NormalizeTelemetryHours is the single definition of this bound, for the same
// reason NormalizePageSize is: a caller that skips it gets whatever it sent,
// which against a minute-resolution table is how a query outlives its deadline.
func NormalizeTelemetryHours(hours int) int {
	if hours <= 0 {
		return TelemetryDefaultHours
	}
	if hours > TelemetryMaximumHours {
		return TelemetryMaximumHours
	}
	return hours
}

// StatusClassOf reduces an HTTP status to its leading digit, which is the only
// part of it this pipeline stores. Anything outside 100-599 is reported as 5:
// a handler that produced it is broken, and losing the observation would hide
// exactly that.
func StatusClassOf(statusCode int) int {
	statusClass := statusCode / 100
	if statusClass < TelemetryStatusClassMinimum || statusClass > TelemetryStatusClassMaximum {
		return TelemetryStatusClassMaximum
	}
	return statusClass
}

// TelemetryHistogramIndexOf places one observed duration into a bucket. It is
// defined here, beside the edges, so the gateway and both sinks cannot
// disagree about which bucket a 25 ms request belongs to — the boundary is
// inclusive, so 25 ms lands in the 25 ms bucket and 26 ms does not.
func TelemetryHistogramIndexOf(durationMS int64) int {
	for edgeIndex, upperBound := range TelemetryHistogramUpperBoundsMS {
		if durationMS <= upperBound {
			return edgeIndex
		}
	}
	return TelemetryHistogramBucketCount - 1
}
