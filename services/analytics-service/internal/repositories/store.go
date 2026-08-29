package repositories

import (
	"context"
	"errors"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

// ErrMalformedCursor is returned rather than silently restarting from page
// one, so a client that corrupts a cursor learns about it instead of quietly
// re-reading rows it already showed.
var ErrMalformedCursor = errors.New("malformed cursor")

// ErrNotFound covers both "no row with that id" and "that id is not even a
// UUID". They are deliberately the same answer: a projection is eventually
// consistent, so a world that exists upstream but has not been projected yet
// is also legitimately absent here, and an admin reading a 404 needs to know
// only that this service cannot show it.
var ErrNotFound = errors.New("not found")

// Store is deliberately asymmetric: exactly one write method, and it is only
// ever called by the event consumer. Every other method reads. That asymmetry
// is the design rule of this service — see
// notes/plans/services/analytics-service-plan.md#what-this-service-is-in-one-sentence.
type Store interface {
	// Apply writes one event's inbox row and its projection in a single
	// transaction, and reports whether the message was new. A false means
	// the message had already been processed and nothing was written.
	Apply(ctx context.Context, projection models.Projection) (applied bool, err error)

	// RecordOwnStart writes this service's own boot. It is separate from
	// Apply because no event carries it: analytics-service is the consumer,
	// so it records itself directly rather than publishing to itself.
	RecordOwnStart(ctx context.Context, start models.ServiceStart) error

	Overview(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsOverviewResponseData, error)
	ListWorlds(ctx context.Context, filter models.WorldListFilter) (contracts.AnalyticsWorldListResponseData, error)

	// GetWorld returns one world and its job history, or ErrNotFound.
	GetWorld(ctx context.Context, worldID string) (contracts.AnalyticsWorldGetResponseData, error)

	ListJobs(ctx context.Context, filter models.JobListFilter) (contracts.AnalyticsJobListResponseData, error)
	Timeseries(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsTimeseriesResponseData, error)
	ListServiceStarts(ctx context.Context, filter models.ServiceStartListFilter) (contracts.ServiceStartListResponseData, error)

	// Ping reports whether the backing storage is reachable.
	Ping(ctx context.Context) error
}
