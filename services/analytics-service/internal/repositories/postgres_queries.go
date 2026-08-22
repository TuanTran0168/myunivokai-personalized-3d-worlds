package repositories

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

// distributionLimit bounds every top-N chart. A distribution with hundreds of
// bars is unreadable long before it is slow, so this is a product bound that
// happens to also be a performance one.
const distributionLimit = 8

// worldJobHistoryLimit bounds the detail page's job list. A world normally
// accumulates a handful of jobs — one creation, one per variant, one publish —
// so this is far above the real shape and exists only so a pathological world
// cannot push the response past the 2500ms request/reply deadline.
const worldJobHistoryLimit = 50

// postgresInvalidTextCode is invalid_text_representation, raised when a value
// that is not a UUID reaches a ::uuid cast.
const postgresInvalidTextCode = "22P02"

// comparisonPeriod is how wide each half of the "vs yesterday" card is. It is
// deliberately independent of the range picker: the distributions and the
// funnel answer "what has this platform been doing lately", and the comparison
// answers "is today different from yesterday". Tying the second to the first
// would turn a 90-day view into a comparison against the 90 days before it,
// which is a different — and much less useful — question.
const comparisonPeriod = 24 * time.Hour

// Overview answers the whole dashboard in one round trip. Every count, rate
// and percentile below is computed by PostgreSQL; the gateway and the admin
// app sum nothing, which is the rule this service exists to enforce.
func (store *PostgresStore) Overview(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsOverviewResponseData, error) {
	days := contracts.NormalizeDays(filter.Days)
	now := time.Now().UTC()
	since := now.AddDate(0, 0, -days)
	family := string(filter.Family)

	// "Today vs yesterday" is a rolling 24 hours against the 24 before it, not
	// two calendar days. A calendar comparison at 09:00 would put nine hours
	// against twenty-four and report a collapse every morning.
	comparisonSince := now.Add(-comparisonPeriod)
	comparisonPreviousSince := comparisonSince.Add(-comparisonPeriod)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE is_published),
			COUNT(*) FILTER (WHERE world_created_at >= $2),
			COALESCE(AVG(trait_creativity), 0), COALESCE(AVG(trait_discipline), 0),
			COALESCE(AVG(trait_curiosity), 0), COALESCE(AVG(trait_energy), 0), COALESCE(AVG(trait_focus), 0),
			MIN(world_created_at),
			COUNT(*) FILTER (WHERE world_created_at >= $2 AND variant_seed = '')
		FROM world_projections
		WHERE ($1 = '' OR family = $1)`, family, since)
	batch.Queue(`SELECT w.family,
			COUNT(*), COUNT(*) FILTER (WHERE w.is_published), COALESCE(SUM(w.variant_count), 0)
		FROM world_projections w
		WHERE ($1 = '' OR w.family = $1)
		GROUP BY w.family
		ORDER BY w.family`, family)
	batch.Queue(`SELECT family,
			COUNT(*), COUNT(*) FILTER (WHERE status = 'failed')
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2
		GROUP BY family
		ORDER BY family`, family, since)
	batch.Queue(`SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'completed'),
			COUNT(*) FILTER (WHERE status = 'failed'),
			COUNT(*) FILTER (WHERE status NOT IN ('completed','failed')),
			COUNT(*) FILTER (WHERE duration_ms IS NOT NULL),
			COALESCE(AVG(duration_ms), 0),
			COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms), 0),
			COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0),
			COALESCE(MAX(duration_ms), 0)
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2`, family, since)
	batch.Queue(distributionQuery("archetype"), family, since, distributionLimit)
	batch.Queue(distributionQuery("world_style"), family, since, distributionLimit)
	batch.Queue(distributionQuery("mood"), family, since, distributionLimit)
	batch.Queue(`SELECT error_code, COUNT(*)
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2 AND error_code <> ''
		GROUP BY error_code
		ORDER BY COUNT(*) DESC, error_code
		LIMIT $3`, family, since, distributionLimit)
	batch.Queue(`SELECT
			COUNT(*) FILTER (WHERE variant_count > 1),
			COUNT(*)
		FROM world_projections
		WHERE ($1 = '' OR family = $1)`, family)

	// The "vs yesterday" pair, on a fixed 24-hour period regardless of the
	// range picker above. Both halves come from one scan with FILTER clauses
	// rather than two round trips, and the previous period is half-open —
	// [dayBefore, yesterday) — so a row exactly on the boundary belongs to one
	// period, never to both.
	//
	// Published counts by published_at, not by "created in this period and now
	// published". The question is "how many did we publish today", and a world
	// created last week and published this morning is a yes.
	batch.Queue(`SELECT
			COUNT(*) FILTER (WHERE world_created_at >= $2),
			COUNT(*) FILTER (WHERE world_created_at >= $3 AND world_created_at < $2),
			COUNT(*) FILTER (WHERE published_at >= $2),
			COUNT(*) FILTER (WHERE published_at >= $3 AND published_at < $2)
		FROM world_projections
		WHERE ($1 = '' OR family = $1)`, family, comparisonSince, comparisonPreviousSince)
	batch.Queue(`SELECT
			COUNT(*) FILTER (WHERE created_at >= $2),
			COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $2),
			COUNT(*) FILTER (WHERE created_at >= $2 AND status = 'failed'),
			COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $2 AND status = 'failed')
		FROM job_projections
		WHERE ($1 = '' OR family = $1)`, family, comparisonSince, comparisonPreviousSince)

	// The generation funnel. Every stage is measured over the SAME set of jobs
	// — the ones submitted inside the window — which is what makes the four
	// counts a funnel instead of four unrelated totals. Publishing is joined
	// back through source_job_id rather than counted over world_projections
	// directly, so a world published today from a job submitted last month
	// cannot appear under a stage its job never entered.
	batch.Queue(`WITH windowed AS (
			SELECT job_id, status, world_id
			FROM job_projections
			WHERE ($1 = '' OR family = $1) AND created_at >= $2
		)
		SELECT
			(SELECT COUNT(*) FROM windowed),
			(SELECT COUNT(*) FROM windowed WHERE status = 'completed'),
			(SELECT COUNT(*) FROM windowed WHERE world_id IS NOT NULL),
			(SELECT COUNT(*) FROM world_projections w
				JOIN windowed ON w.source_job_id = windowed.job_id
				WHERE w.is_published)`, family, since)

	// When the generator is reliably busy, which the day-by-day timeline
	// cannot answer. The zone is stated rather than inherited: without it the
	// same row lands in a different hour depending on the session's TimeZone.
	batch.Queue(`SELECT
			EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::INT AS hour_of_day,
			COUNT(*)
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2
		GROUP BY 1
		ORDER BY 1`, family, since)

	// The rare-feature lottery, measured. The catalogue travels in as two
	// parallel arrays and is unnested into a join table rather than being
	// interpolated into the SQL, so the probabilities are bound parameters and
	// adding a feature never changes the statement text.
	//
	// The comparison is `roll < probability`, evaluated HERE against the
	// catalogue's current value rather than baked in when the row was written.
	// Re-tuning the black hole from 40% to 20% therefore re-derives the whole
	// history on the next request instead of stranding every row.
	featureKeys, featureProbabilities, featureSpeciesCounts := rarityCatalogueArrays()
	batch.Queue(`SELECT r.feature_key,
			COUNT(*),
			COUNT(*) FILTER (WHERE r.roll < p.probability)
		FROM world_rare_rolls r
		JOIN world_projections w ON w.world_id = r.world_id
		JOIN unnest($3::text[], $4::float8[]) AS p(feature_key, probability) ON p.feature_key = r.feature_key
		WHERE ($1 = '' OR w.family = $1) AND w.world_created_at >= $2
		GROUP BY r.feature_key`, family, since, featureKeys, featureProbabilities)

	// Which variety the worlds that DID hit ended up with. Restricted to the
	// hits for the same reason the share is expressed against them: a species
	// breakdown over every world would report that 96% of forests got "no
	// firebird", which is a fact about the first draw, not about the second.
	batch.Queue(`SELECT r.feature_key,
			FLOOR(r.species_roll * p.species_count)::INT,
			COUNT(*)
		FROM world_rare_rolls r
		JOIN world_projections w ON w.world_id = r.world_id
		JOIN unnest($3::text[], $4::float8[], $5::int[]) AS p(feature_key, probability, species_count)
			ON p.feature_key = r.feature_key
		WHERE ($1 = '' OR w.family = $1) AND w.world_created_at >= $2
			AND r.species_roll IS NOT NULL AND p.species_count > 0 AND r.roll < p.probability
		GROUP BY 1, 2
		ORDER BY 1, 2`, family, since, featureKeys, featureProbabilities, featureSpeciesCounts)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	overview := contracts.AnalyticsOverviewResponseData{Days: days, GeneratedAt: time.Now().UTC()}
	var averageCreativity, averageDiscipline, averageCuriosity, averageEnergy, averageFocus float64
	var oldestWorld *time.Time
	var unmeasuredWorlds int
	if err := results.QueryRow().Scan(
		&overview.TotalWorlds, &overview.TotalPublished, &overview.WorldsInWindow,
		&averageCreativity, &averageDiscipline, &averageCuriosity, &averageEnergy, &averageFocus,
		&oldestWorld, &unmeasuredWorlds,
	); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.AverageTraitScores = contracts.TraitScores{
		Creativity: roundToInt(averageCreativity),
		Discipline: roundToInt(averageDiscipline),
		Curiosity:  roundToInt(averageCuriosity),
		Energy:     roundToInt(averageEnergy),
		Focus:      roundToInt(averageFocus),
	}
	overview.OldestProjectedWorld = oldestWorld

	familyTotals, err := scanFamilyWorldTotals(results)
	if err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	if err := mergeFamilyJobTotals(results, familyTotals); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.Families = orderFamilyTotals(familyTotals)

	var averageDuration, percentile50Duration, percentile95Duration, slowestDuration float64
	if err := results.QueryRow().Scan(
		&overview.JobHealth.TotalJobs, &overview.JobHealth.CompletedJobs, &overview.JobHealth.FailedJobs,
		&overview.JobHealth.InFlightJobs, &overview.JobHealth.MeasuredJobCount,
		&averageDuration, &percentile50Duration, &percentile95Duration, &slowestDuration,
	); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.JobHealth.AverageDurationMs = roundToInt(averageDuration)
	overview.JobHealth.P50DurationMs = roundToInt(percentile50Duration)
	overview.JobHealth.P95DurationMs = roundToInt(percentile95Duration)
	overview.JobHealth.SlowestDurationMs = roundToInt(slowestDuration)
	overview.JobHealth.FailureRatePercent = percentageOf(overview.JobHealth.FailedJobs, overview.JobHealth.TotalJobs)

	for _, target := range []*[]contracts.AnalyticsDistributionSlice{
		&overview.ArchetypeTop, &overview.WorldStyleTop, &overview.MoodTop, &overview.ErrorCodeTop,
	} {
		slices, scanError := scanDistribution(results)
		if scanError != nil {
			return contracts.AnalyticsOverviewResponseData{}, scanError
		}
		*target = slices
	}

	var multiVariantWorlds, countedWorlds int
	if err := results.QueryRow().Scan(&multiVariantWorlds, &countedWorlds); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.JobHealth.MultiVariantPercent = percentageOf(multiVariantWorlds, countedWorlds)
	overview.JobHealth.PublishRatePercent = percentageOf(overview.TotalPublished, overview.TotalWorlds)

	var worldsNow, worldsBefore, publishedNow, publishedBefore int
	if err := results.QueryRow().Scan(&worldsNow, &worldsBefore, &publishedNow, &publishedBefore); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	var jobsNow, jobsBefore, failedNow, failedBefore int
	if err := results.QueryRow().Scan(&jobsNow, &jobsBefore, &failedNow, &failedBefore); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.Comparison = contracts.AnalyticsComparison{
		PeriodHours:     int(comparisonPeriod / time.Hour),
		Worlds:          newDelta(worldsNow, worldsBefore),
		PublishedWorlds: newDelta(publishedNow, publishedBefore),
		Jobs:            newDelta(jobsNow, jobsBefore),
		FailedJobs:      newDelta(failedNow, failedBefore),
	}

	var submitted, completed, projected, published int
	if err := results.QueryRow().Scan(&submitted, &completed, &projected, &published); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.GenerationFunnel = generationFunnel(submitted, completed, projected, published)

	hourly, err := scanHourOfDay(results)
	if err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.HourOfDay = hourly
	overview.PeakHour = peakHour(hourly)

	featureCounts, err := scanRarityFeatureCounts(results)
	if err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	speciesCounts, err := scanRaritySpeciesCounts(results)
	if err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.Rarity = rarityReport(filter.Family, unmeasuredWorlds, featureCounts, speciesCounts)
	return overview, nil
}

// rarityCatalogueArrays flattens the catalogue into the parallel arrays the two
// rarity queries unnest. Built from contracts.RarityCatalogue on every call so
// a feature added there needs no change here at all.
func rarityCatalogueArrays() (keys []string, probabilities []float64, speciesCounts []int32) {
	for _, feature := range contracts.RarityCatalogue {
		keys = append(keys, feature.Key)
		probabilities = append(probabilities, feature.Probability)
		speciesCounts = append(speciesCounts, int32(len(feature.Species)))
	}
	return keys, probabilities, speciesCounts
}

type rarityFeatureCount struct {
	eligible int
	observed int
}

func scanRarityFeatureCounts(results pgx.BatchResults) (map[string]rarityFeatureCount, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]rarityFeatureCount{}
	for rows.Next() {
		var key string
		var count rarityFeatureCount
		if err := rows.Scan(&key, &count.eligible, &count.observed); err != nil {
			return nil, err
		}
		counts[key] = count
	}
	return counts, rows.Err()
}

// scanRaritySpeciesCounts keys on the feature and the species INDEX rather than
// a species key, because the index is what the draw selects — resolving it to a
// name is the catalogue's job, and doing it here would put the ordered list in
// two places.
func scanRaritySpeciesCounts(results pgx.BatchResults) (map[string]map[int]int, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]map[int]int{}
	for rows.Next() {
		var featureKey string
		var speciesIndex, count int
		if err := rows.Scan(&featureKey, &speciesIndex, &count); err != nil {
			return nil, err
		}
		if counts[featureKey] == nil {
			counts[featureKey] = map[int]int{}
		}
		counts[featureKey][speciesIndex] += count
	}
	return counts, rows.Err()
}

// rarityReport assembles the panel from the catalogue outwards rather than from
// the query results inwards: a feature nothing has rolled yet must still appear,
// with a zero and its denominator, or a reader would take its absence for a
// feature that does not exist.
func rarityReport(
	family contracts.WorldFamily,
	unmeasuredWorlds int,
	featureCounts map[string]rarityFeatureCount,
	speciesCounts map[string]map[int]int,
) contracts.AnalyticsRarityReport {
	report := contracts.AnalyticsRarityReport{
		Features:         make([]contracts.AnalyticsRarityFeatureRate, 0, len(contracts.RarityCatalogue)),
		UnmeasuredWorlds: unmeasuredWorlds,
	}
	for _, feature := range contracts.RarityCatalogue {
		// A universe feature under a nature filter is not a zero — it is not
		// applicable, and a row of zeroes reads as "we tried and found none".
		if family != "" && feature.Family != family {
			continue
		}
		counts := featureCounts[feature.Key]
		rate := contracts.AnalyticsRarityFeatureRate{
			Key:               feature.Key,
			Label:             feature.Label,
			Family:            feature.Family,
			ConfiguredPercent: math.Round(feature.Probability*10000) / 100,
			EligibleWorlds:    counts.eligible,
			ObservedCount:     counts.observed,
			ObservedPercent:   percentageOf(counts.observed, counts.eligible),
		}
		for index, species := range feature.Species {
			count := speciesCounts[feature.Key][index]
			rate.Species = append(rate.Species, contracts.AnalyticsRaritySpeciesShare{
				Key:           species.Key,
				Label:         species.Label,
				Count:         count,
				PercentOfHits: percentageOf(count, counts.observed),
			})
		}
		report.Features = append(report.Features, rate)
	}
	return report
}

// newDelta is the one place a percentage change is computed, so that "vs
// yesterday" cannot mean two different arithmetics on two cards.
//
// A previous value of zero yields 0 with HasBaseline false rather than a
// division by it or an invented 100%: going from nothing to something is a
// fact the screen states in words, not a percentage.
func newDelta(current, previous int) contracts.AnalyticsDelta {
	delta := contracts.AnalyticsDelta{
		Current:     current,
		Previous:    previous,
		HasBaseline: previous != 0,
	}
	if previous != 0 {
		delta.ChangePercent = math.Round(float64(current-previous)*100/float64(previous)*100) / 100
	}
	return delta
}

// generationFunnel labels the four counts and expresses each as a share of the
// first, never of the one before it — so the whole funnel reads end to end
// without multiplying percentages in your head.
func generationFunnel(submitted, completed, projected, published int) []contracts.AnalyticsFunnelStage {
	stages := []struct {
		stage string
		label string
		count int
	}{
		{contracts.AnalyticsFunnelStageSubmitted, "Jobs submitted", submitted},
		{contracts.AnalyticsFunnelStageCompleted, "Finished without failing", completed},
		{contracts.AnalyticsFunnelStageProjected, "Produced a world", projected},
		{contracts.AnalyticsFunnelStagePublished, "World published", published},
	}
	funnel := make([]contracts.AnalyticsFunnelStage, 0, len(stages))
	for _, stage := range stages {
		funnel = append(funnel, contracts.AnalyticsFunnelStage{
			Stage:          stage.stage,
			Label:          stage.label,
			Count:          stage.count,
			PercentOfEntry: percentageOf(stage.count, submitted),
		})
	}
	return funnel
}

func scanHourOfDay(results pgx.BatchResults) ([]contracts.AnalyticsHourBucket, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// Only hours that actually saw a job are returned. The admin app fills the
	// other twenty-something with zeroes, because a bar chart of the day needs
	// all 24 slots and this service has no business inventing rows.
	buckets := make([]contracts.AnalyticsHourBucket, 0, 24)
	for rows.Next() {
		var bucket contracts.AnalyticsHourBucket
		if err := rows.Scan(&bucket.Hour, &bucket.JobCount); err != nil {
			return nil, err
		}
		buckets = append(buckets, bucket)
	}
	return buckets, rows.Err()
}

// peakHour returns the busiest hour, or nil when nothing was submitted. Nil
// rather than hour zero: "the busiest hour was midnight with no jobs" is a
// claim about traffic that no traffic can support.
func peakHour(buckets []contracts.AnalyticsHourBucket) *contracts.AnalyticsHourBucket {
	var peak *contracts.AnalyticsHourBucket
	for index := range buckets {
		if buckets[index].JobCount == 0 {
			continue
		}
		if peak == nil || buckets[index].JobCount > peak.JobCount {
			peak = &buckets[index]
		}
	}
	if peak == nil {
		return nil
	}
	found := *peak
	return &found
}

// Timeseries fills empty days with explicit zeroes via generate_series, so a
// chart draws a flat line through a quiet week instead of interpolating
// across a hole that never existed.
func (store *PostgresStore) Timeseries(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsTimeseriesResponseData, error) {
	days := contracts.NormalizeDays(filter.Days)
	family := string(filter.Family)
	rows, err := store.pool.Query(ctx, `WITH calendar AS (
			SELECT generate_series(
				date_trunc('day', NOW() AT TIME ZONE 'UTC') - MAKE_INTERVAL(days => $2 - 1),
				date_trunc('day', NOW() AT TIME ZONE 'UTC'),
				INTERVAL '1 day'
			) AS day
		),
		worlds AS (
			SELECT date_trunc('day', world_created_at AT TIME ZONE 'UTC') AS day,
				COUNT(*) AS world_count,
				COUNT(*) FILTER (WHERE is_published) AS published_count
			FROM world_projections
			WHERE ($1 = '' OR family = $1)
			GROUP BY 1
		),
		jobs AS (
			SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
				COUNT(*) AS job_count,
				COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
			FROM job_projections
			WHERE ($1 = '' OR family = $1)
			GROUP BY 1
		)
		SELECT calendar.day,
			COALESCE(worlds.world_count, 0), COALESCE(worlds.published_count, 0),
			COALESCE(jobs.job_count, 0), COALESCE(jobs.failed_count, 0)
		FROM calendar
		LEFT JOIN worlds ON worlds.day = calendar.day
		LEFT JOIN jobs ON jobs.day = calendar.day
		ORDER BY calendar.day`, family, days)
	if err != nil {
		return contracts.AnalyticsTimeseriesResponseData{}, err
	}
	defer rows.Close()
	points := make([]contracts.AnalyticsTimeseriesPoint, 0, days)
	for rows.Next() {
		var point contracts.AnalyticsTimeseriesPoint
		if err := rows.Scan(&point.Day, &point.WorldCount, &point.PublishedCount, &point.JobCount, &point.FailedJobCount); err != nil {
			return contracts.AnalyticsTimeseriesResponseData{}, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return contracts.AnalyticsTimeseriesResponseData{}, err
	}
	return contracts.AnalyticsTimeseriesResponseData{Days: days, Points: points}, nil
}

// ListWorlds pages by keyset on (world_created_at, world_id) DESC. It fetches
// pageSize+1 rows and returns pageSize: the extra row is how "is there a next
// page" is answered without a second query and without a COUNT the client
// would then have to trust.
func (store *PostgresStore) ListWorlds(ctx context.Context, filter models.WorldListFilter) (contracts.AnalyticsWorldListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR family = $1)", "($2 = '' OR archetype = $2)", "($3 = '' OR world_style = $3)", "($4 = '' OR mood = $4)"}
	arguments := []any{string(filter.Family), filter.Archetype, filter.WorldStyle, filter.Mood}
	if filter.Published != nil {
		arguments = append(arguments, *filter.Published)
		conditions = append(conditions, fmt.Sprintf("is_published = $%d", len(arguments)))
	}
	if filter.Since != nil {
		arguments = append(arguments, *filter.Since)
		conditions = append(conditions, fmt.Sprintf("world_created_at >= $%d", len(arguments)))
	}
	if filter.Until != nil {
		arguments = append(arguments, *filter.Until)
		conditions = append(conditions, fmt.Sprintf("world_created_at <= $%d", len(arguments)))
	}
	if strings.TrimSpace(filter.Search) != "" {
		arguments = append(arguments, "%"+strings.TrimSpace(filter.Search)+"%")
		conditions = append(conditions, fmt.Sprintf("nickname ILIKE $%d", len(arguments)))
	}
	// "Show me the worlds behind that number." The predicate is the same
	// `roll < probability` the rarity panel counts with, evaluated against the
	// same catalogue value, so the list and the count can never disagree —
	// which they would the moment one of them cached a resolved boolean.
	//
	// An unknown key matches nothing rather than being ignored. A filter the
	// service silently drops returns a full, plausible list for a question
	// nobody asked, and that is worse than an empty one.
	if filter.RareFeature != "" {
		feature, found := contracts.RarityFeatureByKey(filter.RareFeature)
		if !found {
			return contracts.AnalyticsWorldListResponseData{PageSize: pageSize, Worlds: []contracts.WorldProjectionSummary{}}, nil
		}
		arguments = append(arguments, feature.Key, feature.Probability)
		conditions = append(conditions, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM world_rare_rolls r WHERE r.world_id = world_projections.world_id AND r.feature_key = $%d AND r.roll < $%d)`,
			len(arguments)-1, len(arguments)))
	}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorCreatedAt, cursorWorldID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.AnalyticsWorldListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorCreatedAt, cursorWorldID)
		conditions = append(conditions, fmt.Sprintf("(world_created_at, world_id) < ($%d, $%d::uuid)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT world_id::text, family, nickname, role, archetype, scene_name, mood, world_style,
			favorite_colors, trait_creativity, trait_discipline, trait_curiosity, trait_energy, trait_focus,
			variant_count, selected_variant_no, is_published, published_at, revision, source_job_id,
			world_created_at, projected_at
		FROM world_projections
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY world_created_at DESC, world_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM world_projections WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	worlds := make([]contracts.WorldProjectionSummary, 0, pageSize)
	for rows.Next() {
		world, scanError := scanWorldProjection(rows)
		if scanError != nil {
			rows.Close()
			return contracts.AnalyticsWorldListResponseData{}, scanError
		}
		worlds = append(worlds, world)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	rows.Close()

	response := contracts.AnalyticsWorldListResponseData{PageSize: pageSize}
	if len(worlds) > pageSize {
		last := worlds[pageSize-1]
		response.NextCursor = encodeCursor(last.WorldCreatedAt, last.WorldID)
		worlds = worlds[:pageSize]
	}
	response.Worlds = worlds
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	return response, nil
}

// GetWorld answers the world detail page in one round trip: the projection
// row, and every job that ever touched that world. Both halves travel together
// because they are read together — splitting them into two queries would let
// the page render a world beside a job list that belongs to an older read.
func (store *PostgresStore) GetWorld(ctx context.Context, worldID string) (contracts.AnalyticsWorldGetResponseData, error) {
	batch := &pgx.Batch{}
	batch.Queue(`SELECT world_id::text, family, nickname, role, archetype, scene_name, mood, world_style,
			favorite_colors, trait_creativity, trait_discipline, trait_curiosity, trait_energy, trait_focus,
			variant_count, selected_variant_no, is_published, published_at, revision, source_job_id,
			world_created_at, projected_at, profile_id::text, dna_version_id::text
		FROM world_projections
		WHERE world_id = $1::uuid`, worldID)
	batch.Queue(`SELECT job_id, family, status, error_code, error_message,
			COALESCE(world_id::text, ''), COALESCE(profile_id::text, ''), COALESCE(dna_version_id::text, ''),
			created_at, completed_at, duration_ms
		FROM job_projections
		WHERE world_id = $1::uuid
		ORDER BY created_at DESC, job_id DESC
		LIMIT $2`, worldID, worldJobHistoryLimit)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	detail, err := scanWorldProjectionDetail(results.QueryRow())
	if err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, mapWorldLookupError(err)
	}

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, err
	}
	defer rows.Close()
	jobs := make([]contracts.JobProjectionSummary, 0, 4)
	for rows.Next() {
		job, scanError := scanJobProjection(rows)
		if scanError != nil {
			return contracts.AnalyticsWorldGetResponseData{}, scanError
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, err
	}
	return contracts.AnalyticsWorldGetResponseData{World: detail, Jobs: jobs}, nil
}

// mapWorldLookupError folds "no such row" and "not a UUID at all" into the
// same ErrNotFound. 22P02 is invalid_text_representation, which is what
// Postgres raises when a hand-typed id reaches the ::uuid cast — surfacing
// that as a 500 would blame the service for a bad URL.
func mapWorldLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == postgresInvalidTextCode {
		return ErrNotFound
	}
	return err
}

// ListJobs is ListWorlds' twin over (created_at, job_id).
func (store *PostgresStore) ListJobs(ctx context.Context, filter models.JobListFilter) (contracts.AnalyticsJobListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR family = $1)", "($2 = '' OR status = $2)", "($3 = '' OR error_code = $3)"}
	arguments := []any{string(filter.Family), string(filter.Status), filter.ErrorCode}
	if filter.Since != nil {
		arguments = append(arguments, *filter.Since)
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", len(arguments)))
	}
	if filter.Until != nil {
		arguments = append(arguments, *filter.Until)
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", len(arguments)))
	}
	if strings.TrimSpace(filter.Search) != "" {
		arguments = append(arguments, "%"+strings.TrimSpace(filter.Search)+"%")
		conditions = append(conditions, fmt.Sprintf("(job_id ILIKE $%d OR error_message ILIKE $%d)", len(arguments), len(arguments)))
	}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorCreatedAt, cursorJobID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.AnalyticsJobListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorCreatedAt, cursorJobID)
		conditions = append(conditions, fmt.Sprintf("(created_at, job_id) < ($%d, $%d)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT job_id, family, status, error_code, error_message,
			COALESCE(world_id::text, ''), COALESCE(profile_id::text, ''), COALESCE(dna_version_id::text, ''),
			created_at, completed_at, duration_ms
		FROM job_projections
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY created_at DESC, job_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM job_projections WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsJobListResponseData{}, err
	}
	jobs := make([]contracts.JobProjectionSummary, 0, pageSize)
	for rows.Next() {
		job, scanError := scanJobProjection(rows)
		if scanError != nil {
			rows.Close()
			return contracts.AnalyticsJobListResponseData{}, scanError
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.AnalyticsJobListResponseData{}, err
	}
	rows.Close()

	response := contracts.AnalyticsJobListResponseData{PageSize: pageSize}
	if len(jobs) > pageSize {
		last := jobs[pageSize-1]
		response.NextCursor = encodeCursor(last.CreatedAt, last.JobID)
		jobs = jobs[:pageSize]
	}
	response.Jobs = jobs
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.AnalyticsJobListResponseData{}, err
	}
	return response, nil
}

func distributionQuery(column string) string {
	// The column name is a compile-time constant supplied by this file, never
	// by a caller — no request value is ever interpolated into SQL here.
	return `SELECT ` + column + `, COUNT(*)
		FROM world_projections
		WHERE ($1 = '' OR family = $1) AND world_created_at >= $2 AND ` + column + ` <> ''
		GROUP BY ` + column + `
		ORDER BY COUNT(*) DESC, ` + column + `
		LIMIT $3`
}

type rowScanner interface {
	Scan(destinations ...any) error
}

// scanWorldProjectionDetail reads the summary columns in the same order
// scanWorldProjection does, then the two identifiers appended for the detail
// view. The orders must stay in step with each other and with both SELECT
// lists — that coupling is why the extra columns go last rather than beside
// the ids they relate to.
func scanWorldProjectionDetail(scanner rowScanner) (contracts.WorldProjectionDetail, error) {
	var detail contracts.WorldProjectionDetail
	var favoriteColorsJSON []byte
	if err := scanner.Scan(
		&detail.WorldID, &detail.Family, &detail.Nickname, &detail.Role, &detail.Archetype, &detail.SceneName,
		&detail.Mood, &detail.WorldStyle, &favoriteColorsJSON,
		&detail.TraitScores.Creativity, &detail.TraitScores.Discipline, &detail.TraitScores.Curiosity,
		&detail.TraitScores.Energy, &detail.TraitScores.Focus,
		&detail.VariantCount, &detail.SelectedVariantNo, &detail.IsPublished, &detail.PublishedAt,
		&detail.Revision, &detail.SourceJobID, &detail.WorldCreatedAt, &detail.ProjectedAt,
		&detail.ProfileID, &detail.DNAVersionID,
	); err != nil {
		return contracts.WorldProjectionDetail{}, err
	}
	if err := json.Unmarshal(favoriteColorsJSON, &detail.FavoriteColors); err != nil {
		return contracts.WorldProjectionDetail{}, fmt.Errorf("decode favorite colors for %s: %w", detail.WorldID, err)
	}
	return detail, nil
}

func scanWorldProjection(scanner rowScanner) (contracts.WorldProjectionSummary, error) {
	var world contracts.WorldProjectionSummary
	var favoriteColorsJSON []byte
	if err := scanner.Scan(
		&world.WorldID, &world.Family, &world.Nickname, &world.Role, &world.Archetype, &world.SceneName,
		&world.Mood, &world.WorldStyle, &favoriteColorsJSON,
		&world.TraitScores.Creativity, &world.TraitScores.Discipline, &world.TraitScores.Curiosity,
		&world.TraitScores.Energy, &world.TraitScores.Focus,
		&world.VariantCount, &world.SelectedVariantNo, &world.IsPublished, &world.PublishedAt,
		&world.Revision, &world.SourceJobID, &world.WorldCreatedAt, &world.ProjectedAt,
	); err != nil {
		return contracts.WorldProjectionSummary{}, err
	}
	if err := json.Unmarshal(favoriteColorsJSON, &world.FavoriteColors); err != nil {
		return contracts.WorldProjectionSummary{}, fmt.Errorf("decode favorite colors for %s: %w", world.WorldID, err)
	}
	return world, nil
}

func scanJobProjection(scanner rowScanner) (contracts.JobProjectionSummary, error) {
	var job contracts.JobProjectionSummary
	if err := scanner.Scan(
		&job.JobID, &job.Family, &job.Status, &job.ErrorCode, &job.ErrorMessage,
		&job.WorldID, &job.ProfileID, &job.DNAVersionID,
		&job.CreatedAt, &job.CompletedAt, &job.DurationMs,
	); err != nil {
		return contracts.JobProjectionSummary{}, err
	}
	return job, nil
}

func scanFamilyWorldTotals(results pgx.BatchResults) (map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	totals := map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals{}
	for rows.Next() {
		row := &contracts.AnalyticsFamilyTotals{}
		if err := rows.Scan(&row.Family, &row.WorldCount, &row.PublishedCount, &row.VariantCount); err != nil {
			return nil, err
		}
		totals[row.Family] = row
	}
	return totals, rows.Err()
}

func mergeFamilyJobTotals(results pgx.BatchResults, totals map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals) error {
	rows, err := results.Query()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var family contracts.WorldFamily
		var jobCount, failedJobCount int
		if err := rows.Scan(&family, &jobCount, &failedJobCount); err != nil {
			return err
		}
		row, found := totals[family]
		if !found {
			row = &contracts.AnalyticsFamilyTotals{Family: family}
			totals[family] = row
		}
		row.JobCount = jobCount
		row.FailedJobCount = failedJobCount
	}
	return rows.Err()
}

// orderFamilyTotals returns families in a stable, declared order rather than
// whatever the database happened to group first, so a dashboard's cards do
// not reorder themselves between refreshes.
func orderFamilyTotals(totals map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals) []contracts.AnalyticsFamilyTotals {
	ordered := make([]contracts.AnalyticsFamilyTotals, 0, len(totals))
	for _, family := range []contracts.WorldFamily{contracts.WorldFamilyUniverse, contracts.WorldFamilyNature, contracts.WorldFamilyOcean} {
		if row, found := totals[family]; found {
			ordered = append(ordered, *row)
			delete(totals, family)
		}
	}
	for _, row := range totals {
		ordered = append(ordered, *row)
	}
	return ordered
}

func scanDistribution(results pgx.BatchResults) ([]contracts.AnalyticsDistributionSlice, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	slices := make([]contracts.AnalyticsDistributionSlice, 0, distributionLimit)
	for rows.Next() {
		var slice contracts.AnalyticsDistributionSlice
		if err := rows.Scan(&slice.Value, &slice.Count); err != nil {
			return nil, err
		}
		slices = append(slices, slice)
	}
	return slices, rows.Err()
}

func percentageOf(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(int(float64(part)/float64(whole)*10000+0.5)) / 100
}

func roundToInt(value float64) int {
	if value < 0 {
		return 0
	}
	return int(value + 0.5)
}

// ListServiceStarts is the same keyset shape as ListJobs, over the one table
// here that is not a projection. Newest first, because the question this
// answers is almost always "what restarted recently".
func (store *PostgresStore) ListServiceStarts(ctx context.Context, filter models.ServiceStartListFilter) (contracts.ServiceStartListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR service = $1)"}
	arguments := []any{filter.Service}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorStartedAt, cursorInstanceID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.ServiceStartListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorStartedAt, cursorInstanceID)
		conditions = append(conditions, fmt.Sprintf("(started_at, instance_id) < ($%d, $%d)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT service, instance_id, version, boot_duration_ms, started_at
		FROM service_starts
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY started_at DESC, instance_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM service_starts WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.ServiceStartListResponseData{}, err
	}
	starts := make([]contracts.ServiceStartRecord, 0, pageSize)
	for rows.Next() {
		var start contracts.ServiceStartRecord
		if scanError := rows.Scan(&start.Service, &start.InstanceID, &start.Version, &start.BootDurationMS, &start.StartedAt); scanError != nil {
			rows.Close()
			return contracts.ServiceStartListResponseData{}, scanError
		}
		starts = append(starts, start)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.ServiceStartListResponseData{}, err
	}
	rows.Close()

	response := contracts.ServiceStartListResponseData{PageSize: pageSize}
	if len(starts) > pageSize {
		last := starts[pageSize-1]
		response.NextCursor = encodeCursor(last.StartedAt, last.InstanceID)
		starts = starts[:pageSize]
	}
	response.Starts = starts
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.ServiceStartListResponseData{}, err
	}
	return response, nil
}
