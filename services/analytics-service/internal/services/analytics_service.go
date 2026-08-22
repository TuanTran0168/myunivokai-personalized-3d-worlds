package services

import (
	"context"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/repositories"
)

// AnalyticsService is the read half. It normalises the request, hands one
// call to the store, and returns what the store computed — there is
// deliberately no aggregation, filtering or sorting in Go here, because every
// one of those belongs in the SQL the store already runs.
type AnalyticsService struct {
	store repositories.Store
}

func NewAnalyticsService(store repositories.Store) *AnalyticsService {
	return &AnalyticsService{store: store}
}

func (service *AnalyticsService) Overview(ctx context.Context, query contracts.AnalyticsOverviewQueryData) (contracts.AnalyticsOverviewResponseData, error) {
	return service.store.Overview(ctx, models.OverviewFilter{
		Family: normalizeFamily(query.Family),
		Days:   contracts.NormalizeDays(query.Days),
	})
}

func (service *AnalyticsService) Timeseries(ctx context.Context, query contracts.AnalyticsTimeseriesQueryData) (contracts.AnalyticsTimeseriesResponseData, error) {
	return service.store.Timeseries(ctx, models.OverviewFilter{
		Family: normalizeFamily(query.Family),
		Days:   contracts.NormalizeDays(query.Days),
	})
}

func (service *AnalyticsService) ListWorlds(ctx context.Context, query contracts.AnalyticsWorldListQueryData) (contracts.AnalyticsWorldListResponseData, error) {
	return service.store.ListWorlds(ctx, models.WorldListFilter{
		Family:      normalizeFamily(query.Family),
		Archetype:   query.Archetype,
		WorldStyle:  query.WorldStyle,
		Mood:        query.Mood,
		Published:   query.Published,
		Since:       query.Since,
		Until:       query.Until,
		Search:      query.Search,
		RareFeature: query.RareFeature,
		Cursor:      query.Cursor,
		PageSize:    contracts.NormalizePageSize(query.PageSize),
	})
}

// GetWorld reads one world. The id is passed through untouched: validating it
// here would duplicate a check the store already has to make, and the store's
// version is the one that cannot drift from the column type.
func (service *AnalyticsService) GetWorld(ctx context.Context, query contracts.AnalyticsWorldGetQueryData) (contracts.AnalyticsWorldGetResponseData, error) {
	return service.store.GetWorld(ctx, query.WorldID)
}

func (service *AnalyticsService) ListJobs(ctx context.Context, query contracts.AnalyticsJobListQueryData) (contracts.AnalyticsJobListResponseData, error) {
	return service.store.ListJobs(ctx, models.JobListFilter{
		Family:    normalizeFamily(query.Family),
		Status:    normalizeStatus(query.Status),
		ErrorCode: query.ErrorCode,
		Since:     query.Since,
		Until:     query.Until,
		Search:    query.Search,
		Cursor:    query.Cursor,
		PageSize:  contracts.NormalizePageSize(query.PageSize),
	})
}

// ListServiceStarts reads the boot history. An unknown service name is
// dropped to "" for the same reason as normalizeFamily below: an
// unrecognised filter returning an empty table reads as "nothing ever
// restarted", which is the most misleading answer available.
func (service *AnalyticsService) ListServiceStarts(ctx context.Context, query contracts.ServiceStartListQueryData) (contracts.ServiceStartListResponseData, error) {
	return service.store.ListServiceStarts(ctx, models.ServiceStartListFilter{
		Service:  normalizeServiceName(query.Service),
		Cursor:   query.Cursor,
		PageSize: contracts.NormalizePageSize(query.PageSize),
	})
}

func normalizeServiceName(serviceName string) string {
	for _, known := range contracts.ServiceNames {
		if known == serviceName {
			return serviceName
		}
	}
	return ""
}

// normalizeFamily and normalizeStatus drop values outside the known set
// rather than passing them to SQL. An unrecognised filter becomes "no
// filter", which returns a superset — the alternative, letting it through,
// would silently return an empty table and read as "there is no data".
func normalizeFamily(family contracts.WorldFamily) contracts.WorldFamily {
	if family.Valid() {
		return family
	}
	return ""
}

func normalizeStatus(status contracts.JobStatus) contracts.JobStatus {
	switch status {
	case contracts.JobStatusQueued, contracts.JobStatusProcessing, contracts.JobStatusCompleted, contracts.JobStatusFailed:
		return status
	default:
		return ""
	}
}
