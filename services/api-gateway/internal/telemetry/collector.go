// Package telemetry aggregates what this gateway is doing, in memory, and
// hands one summary per interval to whoever flushes it.
//
// The design rule that matters more than every other one here: publishing an
// event per request is the obvious approach and the wrong one. It puts a
// broker publish on the hot path and multiplies stream volume by three orders
// of magnitude. Everything below exists so that volume drops to one message
// per interval per instance regardless of traffic — see
// notes/evolution/platform-evolution-research.md#b2--http-rollups-aggregated-in-the-gateway.
//
// # The cardinality rule
//
// Every bucket key is a route TEMPLATE, a service name or a cache namespace.
// None of them is derived from a request's content. Putting a world id, a job
// id, a share slug or a client address into a key would give every one of them
// its own time series and grow the store without bound; it is the single most
// common way a home-grown metrics pipeline dies, and
// notes/evolution/telemetry-architecture-research.md measured this system at ~200
// series under the rule and unbounded without it.
//
// # Removing this
//
// This is instrumentation, not product behaviour, and it is built to be
// switched off rather than surgically removed. TELEMETRY_ENABLED=false means
// no middleware is registered, no collector is constructed, no ticker runs and
// nothing is published — the gateway's request path is then exactly what it
// was before this package existed. Every method here also tolerates a nil
// receiver, so the call sites in internal/handlers hold one unconditionally
// instead of branching, the same way *wake.Coordinator is used.
package telemetry

import (
	"sort"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const (
	// UnmatchedRoutePattern is the key for a request chi never matched to a
	// route. Without it, a 404 sweep across random URLs would create one
	// series per URL — the exact failure the cardinality rule exists to
	// prevent, arriving through the one path that has no route template.
	UnmatchedRoutePattern = "unmatched"

	// OverflowRoutePattern absorbs everything past the key limits below. A
	// bucket that says "something is creating keys faster than this design
	// expects" is far more useful than an out-of-memory kill, and far more
	// useful than silently dropping the observation.
	OverflowRoutePattern = "overflow"

	// maximumTrackedRoutePatterns is a backstop, not a budget. The gateway
	// registers roughly 50 route templates and each has at most five status
	// classes, so this is several times the real ceiling — it exists only so
	// that a future bug which lets a raw path through cannot take the process
	// down with it before anybody notices.
	maximumTrackedRoutePatterns = 400

	// maximumTrackedErrorCodes bounds the per-bucket error-code map for the
	// same reason. The gateway declares well under a dozen codes.
	maximumTrackedErrorCodes = 32

	// OverflowErrorCode is the error-code equivalent of OverflowRoutePattern.
	OverflowErrorCode = "OVERFLOW"
)

// httpBucketKey is the {route, method, status class} triple B2 specifies. It
// is a comparable struct rather than a joined string so that a separator can
// never appear inside a component and merge two different buckets.
type httpBucketKey struct {
	routePattern string
	method       string
	statusClass  int
}

type latencyBucket struct {
	requestCount  int64
	durationSumMS int64
	durationMaxMS int64
	histogram     contracts.TelemetryHistogram
}

func (bucket *latencyBucket) record(durationMS int64) {
	bucket.requestCount++
	bucket.durationSumMS += durationMS
	if durationMS > bucket.durationMaxMS {
		bucket.durationMaxMS = durationMS
	}
	bucket.histogram[contracts.TelemetryHistogramIndexOf(durationMS)]++
}

type httpBucketValue struct {
	latencyBucket
	// errorCodes is nil until a bucket actually sees one, because the
	// overwhelming majority of buckets are 2xx and allocating a map for each
	// of them would be the one genuinely hot allocation in this package.
	errorCodes map[string]int64
}

type backendBucketValue struct {
	latencyBucket
	errorCount int64
}

type cacheBucketValue struct {
	hits   int64
	misses int64
}

// Collector is the in-memory aggregate. One instance per process, shared by
// every goroutine serving a request, drained by the flusher.
type Collector struct {
	mutex        sync.Mutex
	httpBuckets  map[httpBucketKey]*httpBucketValue
	natsBuckets  map[string]*backendBucketValue
	cacheBuckets map[string]*cacheBucketValue
}

func NewCollector() *Collector {
	return &Collector{
		httpBuckets:  make(map[httpBucketKey]*httpBucketValue),
		natsBuckets:  make(map[string]*backendBucketValue),
		cacheBuckets: make(map[string]*cacheBucketValue),
	}
}

// RecordHTTPRequest folds one served request into its bucket.
//
// routePattern must be chi's template, never request.URL.Path — see the
// package comment. errorCode is the gateway's own code ("SERVICE_WAKING",
// "RATE_LIMITED", ...) and is empty for a request that produced no error body.
func (collector *Collector) RecordHTTPRequest(routePattern, method string, statusCode int, duration time.Duration, errorCode string) {
	if collector == nil {
		return
	}
	key := httpBucketKey{
		routePattern: routePattern,
		method:       method,
		statusClass:  contracts.StatusClassOf(statusCode),
	}
	durationMS := durationMilliseconds(duration)

	collector.mutex.Lock()
	defer collector.mutex.Unlock()
	bucket, found := collector.httpBuckets[key]
	if !found {
		if len(collector.httpBuckets) >= maximumTrackedRoutePatterns {
			key = httpBucketKey{routePattern: OverflowRoutePattern, method: method, statusClass: key.statusClass}
			bucket, found = collector.httpBuckets[key]
		}
		if !found {
			bucket = &httpBucketValue{}
			collector.httpBuckets[key] = bucket
		}
	}
	bucket.record(durationMS)
	if errorCode != "" {
		bucket.recordErrorCode(errorCode)
	}
}

func (bucket *httpBucketValue) recordErrorCode(errorCode string) {
	if bucket.errorCodes == nil {
		bucket.errorCodes = make(map[string]int64, 1)
	}
	if _, known := bucket.errorCodes[errorCode]; !known && len(bucket.errorCodes) >= maximumTrackedErrorCodes {
		errorCode = OverflowErrorCode
	}
	bucket.errorCodes[errorCode]++
}

// RecordBackendCall folds one NATS request/reply round trip into its service's
// bucket.
//
// service is wake.ServiceForSubject's answer, which the request path already
// computes — this reuses that value rather than parsing the subject a second
// time. An empty service means the subject named nobody this gateway knows,
// and is dropped rather than bucketed under "": a key nobody can act on is
// noise, and it is also the shape an injected subject would arrive in.
func (collector *Collector) RecordBackendCall(service string, duration time.Duration, failed bool) {
	if collector == nil || service == "" {
		return
	}
	durationMS := durationMilliseconds(duration)

	collector.mutex.Lock()
	defer collector.mutex.Unlock()
	bucket, found := collector.natsBuckets[service]
	if !found {
		bucket = &backendBucketValue{}
		collector.natsBuckets[service] = bucket
	}
	bucket.record(durationMS)
	if failed {
		bucket.errorCount++
	}
}

// RecordCacheLookup folds one Redis read into its namespace's counters. The
// three namespaces are fixed constants in internal/handlers, so this map is
// bounded by construction and needs no overflow key.
func (collector *Collector) RecordCacheLookup(namespace string, hit bool) {
	if collector == nil || namespace == "" {
		return
	}
	collector.mutex.Lock()
	defer collector.mutex.Unlock()
	bucket, found := collector.cacheBuckets[namespace]
	if !found {
		bucket = &cacheBucketValue{}
		collector.cacheBuckets[namespace] = bucket
	}
	if hit {
		bucket.hits++
		return
	}
	bucket.misses++
}

// Snapshot drains everything collected so far into one envelope's worth of
// buckets and starts the next interval empty.
//
// Draining rather than copying is what makes each envelope a delta over its
// own interval, which is what the sinks add up. Returning sorted slices is
// deliberate: map iteration order would make the published bytes differ
// between two identical intervals, which turns a diffable fixture and a
// reproducible test into a coin flip.
func (collector *Collector) Snapshot(instanceID string, bucketStart time.Time, bucketDuration time.Duration) contracts.HTTPRollupData {
	data := contracts.HTTPRollupData{
		InstanceID:       instanceID,
		BucketStart:      bucketStart.UTC(),
		BucketDurationMS: bucketDuration.Milliseconds(),
	}
	if collector == nil {
		return data
	}

	collector.mutex.Lock()
	httpBuckets := collector.httpBuckets
	natsBuckets := collector.natsBuckets
	cacheBuckets := collector.cacheBuckets
	collector.httpBuckets = make(map[httpBucketKey]*httpBucketValue, len(httpBuckets))
	collector.natsBuckets = make(map[string]*backendBucketValue, len(natsBuckets))
	collector.cacheBuckets = make(map[string]*cacheBucketValue, len(cacheBuckets))
	collector.mutex.Unlock()

	data.Buckets = make([]contracts.HTTPRollupBucket, 0, len(httpBuckets))
	for key, bucket := range httpBuckets {
		data.Buckets = append(data.Buckets, contracts.HTTPRollupBucket{
			RoutePattern:  key.routePattern,
			Method:        key.method,
			StatusClass:   key.statusClass,
			RequestCount:  bucket.requestCount,
			DurationSumMS: bucket.durationSumMS,
			DurationMaxMS: bucket.durationMaxMS,
			Histogram:     bucket.histogram,
			ErrorCodes:    bucket.errorCodes,
		})
	}
	sort.Slice(data.Buckets, func(first, second int) bool {
		left, right := data.Buckets[first], data.Buckets[second]
		if left.RoutePattern != right.RoutePattern {
			return left.RoutePattern < right.RoutePattern
		}
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		return left.StatusClass < right.StatusClass
	})

	data.NATSBackendBuckets = make([]contracts.NATSBackendBucket, 0, len(natsBuckets))
	for service, bucket := range natsBuckets {
		data.NATSBackendBuckets = append(data.NATSBackendBuckets, contracts.NATSBackendBucket{
			Service:       service,
			RequestCount:  bucket.requestCount,
			DurationSumMS: bucket.durationSumMS,
			DurationMaxMS: bucket.durationMaxMS,
			Histogram:     bucket.histogram,
			ErrorCount:    bucket.errorCount,
		})
	}
	sort.Slice(data.NATSBackendBuckets, func(first, second int) bool {
		return data.NATSBackendBuckets[first].Service < data.NATSBackendBuckets[second].Service
	})

	data.CacheBuckets = make([]contracts.CacheBucket, 0, len(cacheBuckets))
	for namespace, bucket := range cacheBuckets {
		data.CacheBuckets = append(data.CacheBuckets, contracts.CacheBucket{
			Namespace: namespace,
			Hits:      bucket.hits,
			Misses:    bucket.misses,
		})
	}
	sort.Slice(data.CacheBuckets, func(first, second int) bool {
		return data.CacheBuckets[first].Namespace < data.CacheBuckets[second].Namespace
	})
	return data
}

// durationMilliseconds floors at zero rather than truncating toward it. A
// monotonic clock cannot go backwards, but a duration arriving from a caller
// that measured it differently could, and a negative sample would corrupt a
// sum that nothing downstream can repair.
func durationMilliseconds(duration time.Duration) int64 {
	milliseconds := duration.Milliseconds()
	if milliseconds < 0 {
		return 0
	}
	return milliseconds
}
