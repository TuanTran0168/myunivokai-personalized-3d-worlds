package contracts

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

// telemetryRollupFixturePath is decoded by this test and by
// contracts/rust/tests/telemetry_fixture.rs. Two languages, one file: if the
// wire shape changes on one side only, one of the two suites fails in CI
// rather than a production decode failing silently.
const telemetryRollupFixturePath = "../fixtures/telemetry-http-rollup-event.v1.json"

func TestTelemetryRollupFixtureDecodesIntoTheContract(t *testing.T) {
	var envelope Envelope[HTTPRollupData]
	if err := json.Unmarshal(readFixture(t, telemetryRollupFixturePath), &envelope); err != nil {
		t.Fatalf("decode %s: %v", telemetryRollupFixturePath, err)
	}
	if err := envelope.Validate(); err != nil {
		t.Fatalf("envelope is not valid: %v", err)
	}
	if err := envelope.Data.Validate(); err != nil {
		t.Fatalf("rollup data is not valid: %v", err)
	}

	expectedBucketStart := time.Date(2026, time.August, 13, 9, 14, 0, 0, time.UTC)
	if !envelope.Data.BucketStart.Equal(expectedBucketStart) {
		t.Errorf("bucketStart = %s, want %s", envelope.Data.BucketStart, expectedBucketStart)
	}
	if envelope.Data.BucketDurationMS != 60000 {
		t.Errorf("bucketDurationMs = %d, want 60000", envelope.Data.BucketDurationMS)
	}
	if envelope.JobID != TelemetryRollupMessageID(envelope.Data.InstanceID, expectedBucketStart) {
		t.Errorf("jobId = %q, want the {instance, bucket start} message id", envelope.JobID)
	}
	if len(envelope.Data.Buckets) != 4 || len(envelope.Data.NATSBackendBuckets) != 3 || len(envelope.Data.CacheBuckets) != 3 {
		t.Fatalf("fixture shape changed: %d http, %d nats, %d cache buckets",
			len(envelope.Data.Buckets), len(envelope.Data.NATSBackendBuckets), len(envelope.Data.CacheBuckets))
	}

	// The route-pattern rule is the one thing this contract exists to enforce.
	// A raw path would carry a world id, and every world id would become its
	// own series - see notes/evolution/telemetry-architecture-research.md.
	worldGetBucket := envelope.Data.Buckets[1]
	if worldGetBucket.RoutePattern != "/api/universe/worlds/{worldID}" {
		t.Errorf("routePattern = %q, want the chi template", worldGetBucket.RoutePattern)
	}
	if worldGetBucket.RequestCount != 34 || worldGetBucket.DurationMaxMS != 128 {
		t.Errorf("world get bucket = %+v, want 34 requests peaking at 128ms", worldGetBucket)
	}

	wakingBucket := envelope.Data.Buckets[2]
	if wakingBucket.ErrorCodes["SERVICE_WAKING"] != 3 {
		t.Errorf("SERVICE_WAKING count = %d, want 3", wakingBucket.ErrorCodes["SERVICE_WAKING"])
	}
	if envelope.Data.NATSBackendBuckets[0].Service != "universe" || envelope.Data.NATSBackendBuckets[0].ErrorCount != 3 {
		t.Errorf("universe backend bucket = %+v, want 3 errors", envelope.Data.NATSBackendBuckets[0])
	}
	if envelope.Data.CacheBuckets[0].Namespace != "job:v1" || envelope.Data.CacheBuckets[0].Hits != 21 {
		t.Errorf("job cache bucket = %+v, want 21 hits on job:v1", envelope.Data.CacheBuckets[0])
	}
}

// A histogram whose buckets do not add up to the request count is a counting
// bug, and it is the kind that produces a plausible-looking percentile rather
// than an obvious failure. The fixture is checked for it so that a hand-edited
// fixture cannot teach either language the wrong shape.
func TestTelemetryRollupFixtureHistogramsSumToTheirRequestCount(t *testing.T) {
	var envelope Envelope[HTTPRollupData]
	if err := json.Unmarshal(readFixture(t, telemetryRollupFixturePath), &envelope); err != nil {
		t.Fatalf("decode %s: %v", telemetryRollupFixturePath, err)
	}
	for bucketIndex, bucket := range envelope.Data.Buckets {
		if total := sumHistogram(bucket.Histogram); total != bucket.RequestCount {
			t.Errorf("buckets.%d histogram sums to %d, want requestCount %d", bucketIndex, total, bucket.RequestCount)
		}
	}
	for bucketIndex, bucket := range envelope.Data.NATSBackendBuckets {
		if total := sumHistogram(bucket.Histogram); total != bucket.RequestCount {
			t.Errorf("natsBackendBuckets.%d histogram sums to %d, want requestCount %d", bucketIndex, total, bucket.RequestCount)
		}
	}
}

// The edges are asserted literally rather than derived, because the whole
// point of pinning them is that changing one is a deliberate act. The Rust
// mirror asserts the same seven numbers.
func TestTelemetryHistogramEdgesAreTheDocumentedOnes(t *testing.T) {
	expectedEdges := [TelemetryHistogramBucketCount - 1]int64{5, 10, 25, 50, 100, 250, 1000}
	if TelemetryHistogramUpperBoundsMS != expectedEdges {
		t.Fatalf("histogram edges = %v, want %v", TelemetryHistogramUpperBoundsMS, expectedEdges)
	}
}

func TestTelemetryHistogramIndexOfPlacesBoundariesInTheLowerBucket(t *testing.T) {
	cases := []struct {
		durationMS    int64
		expectedIndex int
	}{
		{durationMS: 0, expectedIndex: 0},
		{durationMS: 5, expectedIndex: 0},
		{durationMS: 6, expectedIndex: 1},
		{durationMS: 25, expectedIndex: 2},
		{durationMS: 26, expectedIndex: 3},
		{durationMS: 1000, expectedIndex: 6},
		{durationMS: 1001, expectedIndex: 7},
		{durationMS: 90000, expectedIndex: 7},
	}
	for _, testCase := range cases {
		if actualIndex := TelemetryHistogramIndexOf(testCase.durationMS); actualIndex != testCase.expectedIndex {
			t.Errorf("TelemetryHistogramIndexOf(%d) = %d, want %d", testCase.durationMS, actualIndex, testCase.expectedIndex)
		}
	}
}

func TestStatusClassOfKeepsUnexpectedStatusesVisible(t *testing.T) {
	cases := map[int]int{
		200: 2,
		204: 2,
		302: 3,
		404: 4,
		503: 5,
		// Outside 100-599 nothing legitimate exists, so it is reported as a
		// server error rather than dropped: a handler producing one is broken
		// and losing the observation would hide exactly that.
		0:   5,
		99:  5,
		600: 5,
	}
	for statusCode, expectedClass := range cases {
		if actualClass := StatusClassOf(statusCode); actualClass != expectedClass {
			t.Errorf("StatusClassOf(%d) = %d, want %d", statusCode, actualClass, expectedClass)
		}
	}
}

func TestHTTPRollupDataValidateRejectsWhatWouldCorruptARollup(t *testing.T) {
	valid := func() HTTPRollupData {
		return HTTPRollupData{
			InstanceID:       "01K0EXAMPLE000000000000021",
			BucketStart:      time.Date(2026, time.August, 13, 9, 14, 0, 0, time.UTC),
			BucketDurationMS: 60000,
			Buckets: []HTTPRollupBucket{{
				RoutePattern: "/api/universe/worlds",
				Method:       "POST",
				StatusClass:  2,
				RequestCount: 1,
			}},
			CacheBuckets: []CacheBucket{{Namespace: "job:v1", Hits: 1}},
		}
	}
	if err := valid().Validate(); err != nil {
		t.Fatalf("the valid case must pass, otherwise the rejections below prove nothing: %v", err)
	}

	mutations := map[string]func(*HTTPRollupData){
		"no instance id":              func(data *HTTPRollupData) { data.InstanceID = "  " },
		"no bucket start":             func(data *HTTPRollupData) { data.BucketStart = time.Time{} },
		"zero bucket width":           func(data *HTTPRollupData) { data.BucketDurationMS = 0 },
		"no route pattern":            func(data *HTTPRollupData) { data.Buckets[0].RoutePattern = "" },
		"no method":                   func(data *HTTPRollupData) { data.Buckets[0].Method = "" },
		"status class out of range":   func(data *HTTPRollupData) { data.Buckets[0].StatusClass = 6 },
		"negative request count":      func(data *HTTPRollupData) { data.Buckets[0].RequestCount = -1 },
		"backend bucket with no name": func(data *HTTPRollupData) { data.NATSBackendBuckets = []NATSBackendBucket{{}} },
		"cache bucket with no name":   func(data *HTTPRollupData) { data.CacheBuckets[0].Namespace = "" },
		"negative cache hit count":    func(data *HTTPRollupData) { data.CacheBuckets[0].Hits = -1 },
	}
	for mutationName, mutate := range mutations {
		t.Run(mutationName, func(t *testing.T) {
			data := valid()
			mutate(&data)
			if err := data.Validate(); err == nil {
				t.Fatal("expected Validate to reject this rollup, but it passed")
			}
		})
	}
}

func TestHTTPRollupDataIsEmptyOnlyWhenNothingWasObserved(t *testing.T) {
	empty := HTTPRollupData{InstanceID: "instance", BucketStart: time.Now().UTC(), BucketDurationMS: 60000}
	if !empty.IsEmpty() {
		t.Error("a rollup with no buckets of any kind must report itself empty")
	}
	// A cache lookup with no HTTP bucket is unusual but not empty - an
	// envelope that reports it must still be published, or the one interval
	// where the gateway only served cache hits would silently disappear.
	cacheOnly := empty
	cacheOnly.CacheBuckets = []CacheBucket{{Namespace: "world:v1", Hits: 1}}
	if cacheOnly.IsEmpty() {
		t.Error("a rollup carrying only cache counters is not empty")
	}
}

func TestNormalizeTelemetryHoursClampsToTheStreamsOwnRetention(t *testing.T) {
	cases := map[int]int{
		0:    TelemetryDefaultHours,
		-1:   TelemetryDefaultHours,
		1:    1,
		24:   24,
		168:  168,
		9999: TelemetryMaximumHours,
	}
	for requested, expected := range cases {
		if actual := NormalizeTelemetryHours(requested); actual != expected {
			t.Errorf("NormalizeTelemetryHours(%d) = %d, want %d", requested, actual, expected)
		}
	}
}

// The message id is what separates "two instances flushed the same interval"
// from "one instance's interval arrived twice", which is the distinction the
// consumer's inbox table depends on.
func TestTelemetryRollupMessageIDSeparatesInstancesButNotRedeliveries(t *testing.T) {
	bucketStart := time.Date(2026, time.August, 13, 9, 14, 0, 0, time.UTC)
	first := TelemetryRollupMessageID("instance-a", bucketStart)
	if second := TelemetryRollupMessageID("instance-a", bucketStart.In(time.FixedZone("ICT", 7*60*60))); first != second {
		t.Errorf("the same instant in another zone produced %q and %q", first, second)
	}
	if other := TelemetryRollupMessageID("instance-b", bucketStart); other == first {
		t.Error("two instances flushing the same interval must not share a message id")
	}
	if later := TelemetryRollupMessageID("instance-a", bucketStart.Add(time.Minute)); later == first {
		t.Error("two intervals from one instance must not share a message id")
	}
}

func sumHistogram(histogram TelemetryHistogram) int64 {
	var total int64
	for _, count := range histogram {
		total += count
	}
	return total
}

// telemetryOverviewFixturePath is the READ-side twin of the event fixture
// above, and it exists for a different reason. The gateway relays telemetry
// responses as opaque bytes, so nothing in Go decodes one in production — which
// means the Go structs here and the Rust ones that produce them could drift for
// months with every test still green. Decoding the same file from both
// languages is what makes that impossible.
//
// It lives under fixtures/responses/ rather than beside the events because
// schema_conformance_test.go globs ../fixtures/*.json and requires every match
// to be a valid envelope. A response is not an envelope.
const telemetryOverviewFixturePath = "../fixtures/responses/telemetry-overview-response.v1.json"

func TestTelemetryOverviewFixtureDecodesIntoTheContract(t *testing.T) {
	decoder := json.NewDecoder(bytes.NewReader(readFixture(t, telemetryOverviewFixturePath)))
	// A field the Rust side sends and this side never declared is exactly the
	// drift this fixture exists to catch, so it must fail rather than be
	// silently discarded.
	decoder.DisallowUnknownFields()
	var overview TelemetryOverviewResponseData
	if err := decoder.Decode(&overview); err != nil {
		t.Fatalf("decode %s: %v", telemetryOverviewFixturePath, err)
	}

	if overview.Sink != TelemetrySinkPostgres || !overview.ChartsAvailable {
		t.Errorf("sink descriptor did not flatten: %+v", overview.TelemetrySinkDescriptor)
	}
	if overview.P50DurationMS != 37 || overview.P95DurationMS != 910 {
		t.Errorf("p50/p95 = %d/%d, want 37/910", overview.P50DurationMS, overview.P95DurationMS)
	}
	if overview.P50DurationMS >= overview.P95DurationMS {
		t.Error("a p50 at or above the p95 means the two percentiles are swapped somewhere")
	}

	if overview.Comparison == nil {
		t.Fatal("comparison is absent — the vs-previous-window card has nothing to render")
	}
	if overview.Comparison.Requests.Current != 49 || overview.Comparison.Requests.Previous != 20 {
		t.Errorf("request delta = %+v", overview.Comparison.Requests)
	}
	if !overview.Comparison.Requests.HasBaseline {
		t.Error("hasBaseline decoded false from a fixture that sets it true")
	}

	if overview.PeakHour == nil {
		t.Fatal("peakHour is absent")
	}
	if overview.PeakHour.RequestCount != 49 {
		t.Errorf("peak hour requestCount = %d, want 49", overview.PeakHour.RequestCount)
	}
	if len(overview.HourOfDay) != 1 || overview.HourOfDay[0].Hour != 9 {
		t.Errorf("hourOfDay = %+v", overview.HourOfDay)
	}
	if len(overview.HourlyPoints) != 1 {
		t.Errorf("hourlyPoints = %+v", overview.HourlyPoints)
	}

	// The funnel's keys are what the admin app orders and colours by. A label
	// may be reworded; a key may not.
	expectedStages := []string{
		TelemetryFunnelStageReceived,
		TelemetryFunnelStageAccepted,
		TelemetryFunnelStageServed,
	}
	if len(overview.TrafficFunnel) != len(expectedStages) {
		t.Fatalf("trafficFunnel has %d stages, want %d", len(overview.TrafficFunnel), len(expectedStages))
	}
	for index, expected := range expectedStages {
		if overview.TrafficFunnel[index].Stage != expected {
			t.Errorf("stage %d = %q, want %q", index, overview.TrafficFunnel[index].Stage, expected)
		}
		if overview.TrafficFunnel[index].Label == "" {
			t.Errorf("stage %q carries no label for a chart to print", expected)
		}
	}
	if overview.TrafficFunnel[0].PercentOfEntry != 100 {
		t.Errorf("the entry stage is %.2f%% of itself, want 100", overview.TrafficFunnel[0].PercentOfEntry)
	}
	// The nesting IS the contract. Four counters in a row are only a funnel if
	// each contains the next; an earlier version of this shape did not, and
	// rendered as a collapse followed by a full recovery.
	for index := 1; index < len(overview.TrafficFunnel); index++ {
		if overview.TrafficFunnel[index].Count > overview.TrafficFunnel[index-1].Count {
			t.Errorf("stage %q (%d) exceeds the stage it is a subset of (%d)",
				overview.TrafficFunnel[index].Stage,
				overview.TrafficFunnel[index].Count,
				overview.TrafficFunnel[index-1].Count)
		}
	}

	if len(overview.Backends) != 1 || overview.Backends[0].P50DurationMS != 62 {
		t.Errorf("backend p50 did not decode: %+v", overview.Backends)
	}
}
