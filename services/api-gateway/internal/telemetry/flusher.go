package telemetry

import (
	"context"
	"sync"
	"time"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/rs/zerolog/log"
)

// RollupPublisher is the flusher's one dependency on the outside world.
//
// It is an interface for the same reason handlers.ServiceWaker is: the flusher
// depends on "a rollup can be sent", not on NATS, so a test asserts what was
// published without a broker. broker.NATSClient satisfies it, and deliberately
// does not carry it on broker.Client — the request handlers have no business
// publishing telemetry, and widening that interface would force every test
// double in internal/handlers to grow a method none of them would call.
type RollupPublisher interface {
	PublishHTTPRollup(ctx context.Context, envelope contracts.Envelope[contracts.HTTPRollupData]) error
}

// Flusher turns the collector's running totals into one message per interval.
//
// It publishes through JetStream, never Core NATS. telemetry-service is a pure
// NATS consumer on a scale-to-zero host, and Core NATS delivers to whoever is
// subscribed at that instant or not at all — a fire-and-forget publish while
// the consumer sleeps would lose every interval for as long as it slept, not
// merely one interval on an unclean shutdown. See
// notes/plans/services/telemetry-service-plan.md#durability-and-wake.
type Flusher struct {
	collector      *Collector
	publisher      RollupPublisher
	instanceID     string
	interval       time.Duration
	publishTimeout time.Duration

	// mutex serialises the two callers of flush: the ticker goroutine and the
	// final flush on shutdown. Without it a shutdown racing a tick could
	// advance bucketStart twice and publish two envelopes claiming the same
	// interval, which the consumer's inbox would then treat as a redelivery
	// and discard — losing real counters rather than duplicating them.
	mutex            sync.Mutex
	bucketStart      time.Time
	observationStart time.Time
}

func NewFlusher(collector *Collector, publisher RollupPublisher, instanceID string, interval, publishTimeout time.Duration, startedAt time.Time) *Flusher {
	return &Flusher{
		collector:      collector,
		publisher:      publisher,
		instanceID:     instanceID,
		interval:       interval,
		publishTimeout: publishTimeout,
		// The first bucket is stamped at the aligned boundary so that two
		// gateway instances flushing the same minute produce the same
		// bucket_start and the read model can add them into one point,
		// instead of scattering a chart across offset timestamps.
		bucketStart:      startedAt.UTC().Truncate(interval),
		observationStart: startedAt.UTC(),
	}
}

// Run flushes on a ticker until ctx is cancelled. It does not flush on the way
// out: the caller does that through FlushFinal, after the HTTP server has
// drained, so the last envelope includes the requests that were still in
// flight when the signal arrived.
func (flusher *Flusher) Run(ctx context.Context) {
	ticker := time.NewTicker(flusher.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickedAt := <-ticker.C:
			flusher.flush(ctx, tickedAt)
		}
	}
}

// FlushFinal publishes whatever the last interval collected. It takes its own
// context because the one Run used is already cancelled by the time this runs.
//
// An unclean kill still loses at most one interval of counters. That is the
// accepted trade for telemetry, and it would be the wrong trade for anything
// billed — this pipeline must never be used for anything that has to be exact.
func (flusher *Flusher) FlushFinal(ctx context.Context) {
	flusher.flush(ctx, time.Now())
}

func (flusher *Flusher) flush(ctx context.Context, flushedAt time.Time) {
	flusher.mutex.Lock()
	bucketStart := flusher.bucketStart
	observationWidth := observedWidth(flusher.observationStart, flushedAt)
	flusher.bucketStart = nextBucketStart(bucketStart, flushedAt, flusher.interval)
	flusher.observationStart = flushedAt.UTC()
	flusher.mutex.Unlock()

	data := flusher.collector.Snapshot(flusher.instanceID, bucketStart, observationWidth)
	if data.IsEmpty() {
		// An interval in which nothing happened costs a JetStream write, a
		// stream slot and a consumer wake-up to say nothing at all. On a
		// service that is asleep most of the time, that is most of the
		// messages.
		return
	}
	if err := data.Validate(); err != nil {
		// Unreachable through the collector, which cannot construct a bucket
		// without a key. It is checked anyway because the alternative to
		// finding out here is finding out in the consumer, where the envelope
		// is redelivered forever.
		log.Error().Err(err).Msg("skip invalid telemetry rollup")
		return
	}
	envelope := contracts.NewEnvelope(contracts.TelemetryRollupMessageID(data.InstanceID, data.BucketStart), data)

	publishContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), flusher.publishTimeout)
	defer cancel()
	if err := flusher.publisher.PublishHTTPRollup(publishContext, envelope); err != nil {
		// Never fatal and never retried. The counters are already drained, so
		// a retry would republish an interval the collector no longer holds
		// while the next interval accumulates behind it; losing one rollup is
		// the cheaper failure by a wide margin.
		log.Error().Err(err).Time("bucket_start", data.BucketStart).Msg("publish telemetry rollup")
		return
	}
	log.Debug().
		Time("bucket_start", data.BucketStart).
		Int("http_buckets", len(data.Buckets)).
		Int("nats_buckets", len(data.NATSBackendBuckets)).
		Int("cache_buckets", len(data.CacheBuckets)).
		Msg("telemetry rollup published")
}

// observedWidth is how long the counters being flushed were actually
// collected for, which is what turns a count into a rate.
//
// It is floored at one millisecond rather than reported as measured. Two
// flushes inside the same millisecond do happen - a shutdown arriving right
// behind a tick is the ordinary case - and a zero width fails the contract's
// own validation, which would throw away real counters to avoid publishing a
// meaningless rate. Keeping the counts and admitting the rate is unusable is
// the better half of that trade.
func observedWidth(observationStart, flushedAt time.Time) time.Duration {
	width := flushedAt.UTC().Sub(observationStart)
	if width < time.Millisecond {
		return time.Millisecond
	}
	return width
}

// nextBucketStart aligns the following interval to the wall clock and
// guarantees it advances.
//
// Truncation alone is not enough: a tick that fires early relative to the
// previous one - which a coarse timer, a paused container or a clock
// adjustment can all produce - would truncate to the interval already used,
// and the consumer's inbox keys on {instance, bucket start}. A repeated key is
// not a duplicate there, it is a real interval silently dropped, so the
// advance is enforced rather than assumed.
func nextBucketStart(previousBucketStart, flushedAt time.Time, interval time.Duration) time.Time {
	candidate := flushedAt.UTC().Truncate(interval)
	if !candidate.After(previousBucketStart) {
		return previousBucketStart.Add(interval)
	}
	return candidate
}
