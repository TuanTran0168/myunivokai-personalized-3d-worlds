package telemetry

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

type recordingPublisher struct {
	mutex     sync.Mutex
	envelopes []contracts.Envelope[contracts.HTTPRollupData]
	err       error
}

func (publisher *recordingPublisher) PublishHTTPRollup(_ context.Context, envelope contracts.Envelope[contracts.HTTPRollupData]) error {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	publisher.envelopes = append(publisher.envelopes, envelope)
	return publisher.err
}

func (publisher *recordingPublisher) published() []contracts.Envelope[contracts.HTTPRollupData] {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	return append([]contracts.Envelope[contracts.HTTPRollupData](nil), publisher.envelopes...)
}

func newTestFlusher(collector *Collector, publisher RollupPublisher, startedAt time.Time) *Flusher {
	return NewFlusher(collector, publisher, testInstanceID, time.Minute, time.Second, startedAt)
}

func TestAnIntervalWithNoTrafficIsNotPublishedAtAll(t *testing.T) {
	publisher := &recordingPublisher{}
	flusher := newTestFlusher(NewCollector(), publisher, testBucketStart())

	flusher.FlushFinal(context.Background())

	if published := publisher.published(); len(published) != 0 {
		t.Fatalf("published %d envelopes for an interval in which nothing happened", len(published))
	}
}

func TestAFlushCarriesTheIntervalIdentityTheConsumerKeysOn(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, 12*time.Millisecond, "")
	publisher := &recordingPublisher{}
	flusher := newTestFlusher(collector, publisher, testBucketStart())

	flusher.FlushFinal(context.Background())

	published := publisher.published()
	if len(published) != 1 {
		t.Fatalf("expected one envelope, got %d", len(published))
	}
	envelope := published[0]
	if envelope.Data.InstanceID != testInstanceID {
		t.Fatalf("instance id = %q, want %q", envelope.Data.InstanceID, testInstanceID)
	}
	expectedMessageID := contracts.TelemetryRollupMessageID(testInstanceID, envelope.Data.BucketStart)
	if envelope.JobID != expectedMessageID {
		t.Fatalf("jobId = %q, want the {instance, bucket start} message id %q", envelope.JobID, expectedMessageID)
	}
	if envelope.Data.BucketDurationMS <= 0 {
		t.Fatalf("bucketDurationMs = %d, want the observed width", envelope.Data.BucketDurationMS)
	}
	if err := envelope.Data.Validate(); err != nil {
		t.Fatalf("the flusher published a rollup its own contract rejects: %v", err)
	}
}

// The bucket start is truncated to the interval so two gateway instances
// flushing the same minute produce the same timestamp and the read model adds
// them into one chart point, rather than scattering them across offsets.
func TestTheFirstBucketStartIsAlignedToTheInterval(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	publisher := &recordingPublisher{}
	unalignedStart := testBucketStart().Add(37*time.Second + 412*time.Millisecond)
	flusher := newTestFlusher(collector, publisher, unalignedStart)

	flusher.FlushFinal(context.Background())

	bucketStart := publisher.published()[0].Data.BucketStart
	if !bucketStart.Equal(testBucketStart()) {
		t.Fatalf("bucketStart = %s, want it truncated to %s", bucketStart, testBucketStart())
	}
}

// A repeated bucket start is not a duplicate to the consumer's inbox, it is a
// real interval silently discarded. Truncation alone cannot promise this, so
// the advance is enforced.
func TestBucketStartsAlwaysAdvanceEvenWhenTheClockDoesNot(t *testing.T) {
	previous := testBucketStart()
	cases := map[string]struct {
		flushedAt time.Time
		expected  time.Time
	}{
		"a tick inside the following interval": {
			flushedAt: testBucketStart().Add(time.Minute + 300*time.Millisecond),
			expected:  testBucketStart().Add(time.Minute),
		},
		"a tick that truncates to the interval already used": {
			flushedAt: testBucketStart().Add(2 * time.Second),
			expected:  testBucketStart().Add(time.Minute),
		},
		"a clock that moved backwards": {
			flushedAt: testBucketStart().Add(-5 * time.Minute),
			expected:  testBucketStart().Add(time.Minute),
		},
		"a long pause that skipped several intervals": {
			flushedAt: testBucketStart().Add(10*time.Minute + time.Second),
			expected:  testBucketStart().Add(10 * time.Minute),
		},
	}
	for caseName, testCase := range cases {
		t.Run(caseName, func(t *testing.T) {
			actual := nextBucketStart(previous, testCase.flushedAt, time.Minute)
			if !actual.Equal(testCase.expected) {
				t.Fatalf("nextBucketStart = %s, want %s", actual, testCase.expected)
			}
			if !actual.After(previous) {
				t.Fatalf("nextBucketStart = %s did not advance past %s", actual, previous)
			}
		})
	}
}

func TestConsecutiveFlushesNeverRepeatABucketStart(t *testing.T) {
	collector := NewCollector()
	publisher := &recordingPublisher{}
	flusher := newTestFlusher(collector, publisher, testBucketStart())

	for flushIndex := 0; flushIndex < 5; flushIndex++ {
		collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
		flusher.FlushFinal(context.Background())
	}

	seen := make(map[string]bool)
	for _, envelope := range publisher.published() {
		if seen[envelope.JobID] {
			t.Fatalf("message id %q was published twice; the consumer would discard the second interval", envelope.JobID)
		}
		seen[envelope.JobID] = true
	}
	if len(seen) != 5 {
		t.Fatalf("published %d distinct intervals, want 5", len(seen))
	}
}

// A shutdown arriving right behind a tick flushes twice within the same
// millisecond. Reporting that width as measured would fail the contract's own
// validation and throw away counters that are perfectly real.
func TestAZeroWidthIntervalKeepsItsCountersInsteadOfBeingDropped(t *testing.T) {
	instant := testBucketStart()
	if width := observedWidth(instant, instant); width < time.Millisecond {
		t.Fatalf("observedWidth = %s, want it floored at 1ms", width)
	}
	if width := observedWidth(instant, instant.Add(90*time.Second)); width != 90*time.Second {
		t.Fatalf("observedWidth = %s, want the measured 90s", width)
	}
}

// A publish failure must not take the gateway down and must not be retried:
// the counters are already drained, so a retry would resend an interval the
// collector no longer holds while the next one accumulates behind it.
func TestAFailedPublishIsSurvivedAndNotRetried(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	publisher := &recordingPublisher{err: errors.New("broker unreachable")}
	flusher := newTestFlusher(collector, publisher, testBucketStart())

	flusher.FlushFinal(context.Background())
	flusher.FlushFinal(context.Background())

	if published := publisher.published(); len(published) != 1 {
		t.Fatalf("publish attempts = %d, want exactly one - the failed interval must not be resent", len(published))
	}
}

// FlushFinal runs during shutdown, when the context Run used is already
// cancelled. If the publish inherited that cancellation the last interval
// would never leave the process.
func TestTheFinalFlushStillPublishesUnderACancelledContext(t *testing.T) {
	collector := NewCollector()
	collector.RecordHTTPRequest("/api/universe/worlds", "POST", 202, time.Millisecond, "")
	publisher := &recordingPublisher{}
	flusher := newTestFlusher(collector, publisher, testBucketStart())

	cancelledContext, cancel := context.WithCancel(context.Background())
	cancel()
	flusher.FlushFinal(cancelledContext)

	if published := publisher.published(); len(published) != 1 {
		t.Fatalf("published %d envelopes under a cancelled context, want 1", len(published))
	}
}

func TestRunStopsWhenItsContextIsCancelled(t *testing.T) {
	flusher := NewFlusher(NewCollector(), &recordingPublisher{}, testInstanceID, 10*time.Millisecond, time.Second, time.Now())
	runContext, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		flusher.Run(runContext)
		close(stopped)
	}()

	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}
}
