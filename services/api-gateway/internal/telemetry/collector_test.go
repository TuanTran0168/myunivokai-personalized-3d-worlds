package telemetry

import (
	"strconv"
	"sync"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const testInstanceID = "01K0EXAMPLE000000000000021"

func testBucketStart() time.Time {
	return time.Date(2026, time.August, 13, 9, 14, 0, 0, time.UTC)
}

// A nil collector is how the whole request path behaves with telemetry off.
// Every method has to tolerate it, or the "no branching at the call site"
// promise in internal/handlers becomes a nil dereference in production rather
// than a compile error in review.
func TestANilCollectorRecordsNothingAndDoesNotPanic(t *testing.T) {
	var collector *Collector
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 201, time.Second, "")
	collector.RecordBackendCall("universe", time.Second, true)
	collector.RecordCacheLookup("world:v1", true)

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if !data.IsEmpty() {
		t.Fatal("a nil collector produced buckets")
	}
	if data.InstanceID != testInstanceID || data.BucketDurationMS != time.Minute.Milliseconds() {
		t.Fatalf("a nil collector must still describe the interval: %+v", data)
	}
}

func TestRequestsWithTheSameKeyAccumulateIntoOneBucket(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds/{worldID}", "GET", 200, 8*time.Millisecond, "")
	collector.RecordHTTPRequest("/api/universe/worlds/{worldID}", "GET", 204, 30*time.Millisecond, "")
	collector.RecordHTTPRequest("/api/universe/worlds/{worldID}", "GET", 503, 4*time.Millisecond, "SERVICE_WAKING")

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if len(data.Buckets) != 2 {
		t.Fatalf("expected one bucket per status class, got %d: %+v", len(data.Buckets), data.Buckets)
	}
	// Sorted output: 2xx before 5xx for the same route and method.
	successBucket, failureBucket := data.Buckets[0], data.Buckets[1]
	if successBucket.StatusClass != 2 || successBucket.RequestCount != 2 {
		t.Fatalf("2xx bucket = %+v, want 2 requests", successBucket)
	}
	if successBucket.DurationSumMS != 38 || successBucket.DurationMaxMS != 30 {
		t.Fatalf("2xx durations = sum %d max %d, want 38 and 30", successBucket.DurationSumMS, successBucket.DurationMaxMS)
	}
	// 8ms lands in the 10ms bucket, 30ms in the 50ms bucket.
	if successBucket.Histogram[1] != 1 || successBucket.Histogram[3] != 1 {
		t.Fatalf("2xx histogram = %v, want one observation in bucket 1 and one in bucket 3", successBucket.Histogram)
	}
	if failureBucket.StatusClass != 5 || failureBucket.ErrorCodes["SERVICE_WAKING"] != 1 {
		t.Fatalf("5xx bucket = %+v, want one SERVICE_WAKING", failureBucket)
	}
	// The overwhelmingly common case must not allocate a map it never uses.
	if successBucket.ErrorCodes != nil {
		t.Fatalf("a bucket that saw no error code carries %v", successBucket.ErrorCodes)
	}
}

func TestSnapshotDrainsSoEachEnvelopeIsItsOwnInterval(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	collector.RecordBackendCall("dna", time.Millisecond, false)
	collector.RecordCacheLookup("job:v1", true)

	first := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if first.IsEmpty() {
		t.Fatal("the first snapshot lost everything that was recorded")
	}
	second := collector.Snapshot(testInstanceID, testBucketStart().Add(time.Minute), time.Minute)
	if !second.IsEmpty() {
		t.Fatalf("the second snapshot repeated the first interval's counters: %+v", second)
	}
}

// Sorted output is not cosmetic. Map iteration order would make two identical
// intervals publish different bytes, which turns any comparison of two
// envelopes - in a test, in a diff, in a log - into a coin flip.
func TestSnapshotOrdersEveryBucketDeterministically(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	collector.RecordHTTPRequest("/api/admin/telemetry/overview", "GET", 200, time.Millisecond, "")
	collector.RecordHTTPRequest("/api/nature/worlds", "GET", 200, time.Millisecond, "")
	collector.RecordBackendCall("universe", time.Millisecond, false)
	collector.RecordBackendCall("analytics", time.Millisecond, false)
	collector.RecordCacheLookup("world:v1", true)
	collector.RecordCacheLookup("job:v1", false)

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	expectedRoutes := []string{"/api/admin/telemetry/overview", "/api/nature/worlds", "/api/universe/worlds"}
	for index, expectedRoute := range expectedRoutes {
		if data.Buckets[index].RoutePattern != expectedRoute {
			t.Fatalf("buckets[%d] = %q, want %q", index, data.Buckets[index].RoutePattern, expectedRoute)
		}
	}
	if data.NATSBackendBuckets[0].Service != "analytics" || data.NATSBackendBuckets[1].Service != "universe" {
		t.Fatalf("backend buckets are unsorted: %+v", data.NATSBackendBuckets)
	}
	if data.CacheBuckets[0].Namespace != "job:v1" || data.CacheBuckets[1].Namespace != "world:v1" {
		t.Fatalf("cache buckets are unsorted: %+v", data.CacheBuckets)
	}
}

func TestBackendCallsSeparateFailuresFromLatency(t *testing.T) {
	collector := NewCollector()
	collector.RecordBackendCall("universe", 12*time.Millisecond, false)
	collector.RecordBackendCall("universe", 900*time.Millisecond, true)
	// A subject naming nobody this gateway knows is dropped rather than
	// bucketed under an empty service name.
	collector.RecordBackendCall("", time.Millisecond, false)

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if len(data.NATSBackendBuckets) != 1 {
		t.Fatalf("expected exactly one backend bucket, got %+v", data.NATSBackendBuckets)
	}
	bucket := data.NATSBackendBuckets[0]
	if bucket.RequestCount != 2 || bucket.ErrorCount != 1 {
		t.Fatalf("backend bucket = %+v, want 2 requests and 1 error", bucket)
	}
	// A failed call is still a measured round trip: its latency is what makes
	// "slow then gave up" distinguishable from "refused instantly".
	if bucket.DurationSumMS != 912 || bucket.DurationMaxMS != 900 {
		t.Fatalf("backend durations = sum %d max %d, want 912 and 900", bucket.DurationSumMS, bucket.DurationMaxMS)
	}
}

func TestCacheLookupsCountHitsAndMissesSeparately(t *testing.T) {
	collector := NewCollector()
	collector.RecordCacheLookup("world:v1", true)
	collector.RecordCacheLookup("world:v1", true)
	collector.RecordCacheLookup("world:v1", false)
	collector.RecordCacheLookup("", true)

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if len(data.CacheBuckets) != 1 {
		t.Fatalf("expected exactly one cache bucket, got %+v", data.CacheBuckets)
	}
	if data.CacheBuckets[0].Hits != 2 || data.CacheBuckets[0].Misses != 1 {
		t.Fatalf("cache bucket = %+v, want 2 hits and 1 miss", data.CacheBuckets[0])
	}
}

// The backstop exists for a future bug that lets a raw path through. It must
// bound memory without losing the fact that requests happened, because "the
// counters stopped" and "the process died" are very different things to be
// looking at during an incident.
func TestKeyGrowthIsBoundedAndTheOverflowStaysVisible(t *testing.T) {
	collector := NewCollector()
	for routeIndex := 0; routeIndex < maximumTrackedRoutePatterns+50; routeIndex++ {
		collector.RecordHTTPRequest("/api/universe/worlds/"+strconv.Itoa(routeIndex), "GET", 200, time.Millisecond, "")
	}

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if len(data.Buckets) > maximumTrackedRoutePatterns+1 {
		t.Fatalf("bucket count = %d, want it bounded near %d", len(data.Buckets), maximumTrackedRoutePatterns)
	}
	var overflowCount int64
	var totalCount int64
	for _, bucket := range data.Buckets {
		totalCount += bucket.RequestCount
		if bucket.RoutePattern == OverflowRoutePattern {
			overflowCount = bucket.RequestCount
		}
	}
	if overflowCount == 0 {
		t.Fatal("nothing landed in the overflow bucket, so the excess was silently dropped")
	}
	if totalCount != int64(maximumTrackedRoutePatterns+50) {
		t.Fatalf("total requests counted = %d, want every one of them kept", totalCount)
	}
}

func TestErrorCodeGrowthIsBoundedWithinOneBucket(t *testing.T) {
	collector := NewCollector()
	for codeIndex := 0; codeIndex < maximumTrackedErrorCodes+10; codeIndex++ {
		collector.RecordHTTPRequest("/api/universe/worlds", "GET", 500, time.Millisecond, "CODE_"+strconv.Itoa(codeIndex))
	}

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	errorCodes := data.Buckets[0].ErrorCodes
	if len(errorCodes) > maximumTrackedErrorCodes+1 {
		t.Fatalf("error code count = %d, want it bounded near %d", len(errorCodes), maximumTrackedErrorCodes)
	}
	if errorCodes[OverflowErrorCode] == 0 {
		t.Fatal("the excess error codes were dropped instead of folded into the overflow key")
	}
}

// The collector is shared by every goroutine serving a request. This test
// exists to be run under -race; without the mutex it fails there rather than
// here.
func TestConcurrentRecordingIsSafeAndLosesNothing(t *testing.T) {
	collector := NewCollector()
	const goroutineCount = 16
	const requestsPerGoroutine = 100

	var waitGroup sync.WaitGroup
	waitGroup.Add(goroutineCount)
	for goroutineIndex := 0; goroutineIndex < goroutineCount; goroutineIndex++ {
		go func() {
			defer waitGroup.Done()
			for requestIndex := 0; requestIndex < requestsPerGoroutine; requestIndex++ {
				collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
				collector.RecordBackendCall("dna", time.Millisecond, false)
				collector.RecordCacheLookup("job:v1", true)
			}
		}()
	}
	waitGroup.Wait()

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	expected := int64(goroutineCount * requestsPerGoroutine)
	if data.Buckets[0].RequestCount != expected {
		t.Fatalf("http requests counted = %d, want %d", data.Buckets[0].RequestCount, expected)
	}
	if data.NATSBackendBuckets[0].RequestCount != expected {
		t.Fatalf("backend calls counted = %d, want %d", data.NATSBackendBuckets[0].RequestCount, expected)
	}
	if data.CacheBuckets[0].Hits != expected {
		t.Fatalf("cache hits counted = %d, want %d", data.CacheBuckets[0].Hits, expected)
	}
}

// Everything the collector produces has to survive its own contract check,
// because a rollup that fails validation in the flusher is a rollup that is
// silently dropped.
func TestEverySnapshotSatisfiesTheContract(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest(UnmatchedRoutePattern, "GET", 404, time.Millisecond, "ROUTE_NOT_FOUND")
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	collector.RecordBackendCall("universe", time.Millisecond, false)
	collector.RecordCacheLookup("share:v1", false)

	data := collector.Snapshot(testInstanceID, testBucketStart(), time.Minute)
	if err := data.Validate(); err != nil {
		t.Fatalf("the collector produced a rollup its own contract rejects: %v", err)
	}
	for _, bucket := range data.Buckets {
		var histogramTotal int64
		for _, count := range bucket.Histogram {
			histogramTotal += count
		}
		if histogramTotal != bucket.RequestCount {
			t.Fatalf("bucket %+v histogram sums to %d", bucket, histogramTotal)
		}
	}
	if data.Buckets[0].StatusClass != contracts.StatusClassOf(202) && data.Buckets[0].StatusClass != contracts.StatusClassOf(404) {
		t.Fatalf("status class was not reduced through the contract's own helper: %+v", data.Buckets[0])
	}
}
