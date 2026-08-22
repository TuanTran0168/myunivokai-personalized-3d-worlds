package repositories

import (
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The arithmetic behind the dashboard's cards, tested without a database
// because none of it touches one. What a database IS needed for — that the
// funnel's four counts come from the same set of jobs, that the comparison's
// two periods do not overlap — is the SQL's own business and is asserted in
// the comments beside those queries, not here.

func TestADeltaWithoutABaselineReportsNoPercentageRatherThanInventingOne(t *testing.T) {
	// A platform deployed this morning has no yesterday. "+100%" against
	// nothing is a trend that never happened.
	fresh := newDelta(12, 0)
	if fresh.HasBaseline {
		t.Error("a previous value of zero was treated as a baseline")
	}
	if fresh.ChangePercent != 0 {
		t.Errorf("changePercent = %v, want 0 when there is nothing to compare against", fresh.ChangePercent)
	}
	if fresh.Current != 12 || fresh.Previous != 0 {
		t.Errorf("the absolute values did not survive: %+v", fresh)
	}

	// Both sides zero is still no baseline — a quiet day against a quiet day
	// has nothing to say, and 0% would read as "unchanged", which claims more.
	if newDelta(0, 0).HasBaseline {
		t.Error("two empty periods were treated as a comparison")
	}
}

func TestADeltaRoundsToTwoPlacesAndKeepsItsSign(t *testing.T) {
	cases := []struct {
		name     string
		current  int
		previous int
		want     float64
	}{
		{"growth", 30, 20, 50},
		{"decline", 20, 30, -33.33},
		{"unchanged", 20, 20, 0},
		{"collapse to nothing", 0, 8, -100},
		{"one third", 4, 3, 33.33},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			delta := newDelta(testCase.current, testCase.previous)
			if delta.ChangePercent != testCase.want {
				t.Errorf("changePercent = %v, want %v", delta.ChangePercent, testCase.want)
			}
			if !delta.HasBaseline {
				t.Error("a non-zero previous value must count as a baseline")
			}
		})
	}
}

func TestTheFunnelMeasuresEveryStageAgainstTheEntryStage(t *testing.T) {
	funnel := generationFunnel(200, 180, 175, 40)
	if len(funnel) != 4 {
		t.Fatalf("funnel has %d stages, want 4", len(funnel))
	}

	expectedStages := []string{
		contracts.AnalyticsFunnelStageSubmitted,
		contracts.AnalyticsFunnelStageCompleted,
		contracts.AnalyticsFunnelStageProjected,
		contracts.AnalyticsFunnelStagePublished,
	}
	for index, expected := range expectedStages {
		if funnel[index].Stage != expected {
			t.Errorf("stage %d = %q, want %q", index, funnel[index].Stage, expected)
		}
		if funnel[index].Label == "" {
			t.Errorf("stage %q carries no label for a chart to print", expected)
		}
	}

	// Against the ENTRY, not the previous stage. 40 of 200 is 20%; 40 of the
	// 175 before it would be 22.86%, which reads as a healthier funnel than
	// the one that happened.
	if funnel[3].PercentOfEntry != 20 {
		t.Errorf("published = %v%% of entry, want 20", funnel[3].PercentOfEntry)
	}
	if funnel[0].PercentOfEntry != 100 {
		t.Errorf("the entry stage is %v%% of itself, want 100", funnel[0].PercentOfEntry)
	}

	// A funnel over an empty window must not divide by its own entry count.
	for _, stage := range generationFunnel(0, 0, 0, 0) {
		if stage.PercentOfEntry != 0 {
			t.Errorf("stage %q reported %v%% of an empty window", stage.Stage, stage.PercentOfEntry)
		}
	}
}

func TestThePeakHourIsAbsentRatherThanMidnightWhenNothingWasSubmitted(t *testing.T) {
	if peak := peakHour(nil); peak != nil {
		t.Errorf("peak hour = %+v, want absent", peak)
	}
	// Hours are returned only when they saw a job, but a zero row arriving
	// from anywhere must not win the maximum by default.
	if peak := peakHour([]contracts.AnalyticsHourBucket{{Hour: 0, JobCount: 0}}); peak != nil {
		t.Errorf("peak hour = %+v, want absent", peak)
	}

	peak := peakHour([]contracts.AnalyticsHourBucket{
		{Hour: 3, JobCount: 4},
		{Hour: 14, JobCount: 31},
		{Hour: 22, JobCount: 30},
	})
	if peak == nil {
		t.Fatal("peak hour is absent from a window that saw jobs")
	}
	if peak.Hour != 14 || peak.JobCount != 31 {
		t.Errorf("peak hour = %+v, want hour 14 with 31 jobs", *peak)
	}
}

// The rarity panel's arithmetic. Everything below is about the SHAPE of the
// answer rather than the lottery itself — that the denominators are the right
// ones, that a feature nobody has rolled still appears, and that a percentage
// against nothing stays absent instead of becoming zero.

func TestRarityReportKeepsAFeatureNobodyHasRolledYet(t *testing.T) {
	// A feature missing from the query result is a feature no world has
	// entered — a brand-new species, or an empty window. Dropping it would
	// read as "this feature does not exist", which is a different claim from
	// "nothing has rolled it".
	report := rarityReport("", 0, map[string]rarityFeatureCount{}, map[string]map[int]int{})
	if len(report.Features) != len(contracts.RarityCatalogue) {
		t.Fatalf("report carries %d features, the catalogue has %d", len(report.Features), len(contracts.RarityCatalogue))
	}
	for _, feature := range report.Features {
		if feature.EligibleWorlds != 0 || feature.ObservedCount != 0 {
			t.Errorf("%s invented counts out of an empty result: %+v", feature.Key, feature)
		}
		if feature.ObservedPercent != 0 {
			t.Errorf("%s reported %v%% against a denominator of zero", feature.Key, feature.ObservedPercent)
		}
		if feature.ConfiguredPercent <= 0 {
			t.Errorf("%s lost its configured rate: %v", feature.Key, feature.ConfiguredPercent)
		}
	}
}

// 0.05 * 100 is 5.000000000000001 in float64. A card that renders the
// configured rate straight from the wire would print that.
func TestConfiguredPercentDoesNotLeakFloatNoise(t *testing.T) {
	report := rarityReport("", 0, map[string]rarityFeatureCount{}, map[string]map[int]int{})
	expected := map[string]float64{
		"meteor-shower":         5,
		"binary-sun":            3,
		"black-hole":            40,
		"forest-special-bird":   35,
		"forest-special-animal": 40,
	}
	for _, feature := range report.Features {
		if want, known := expected[feature.Key]; known && feature.ConfiguredPercent != want {
			t.Errorf("%s configured percent = %v, want exactly %v", feature.Key, feature.ConfiguredPercent, want)
		}
	}
}

// A forest cannot roll a black hole. Listing it under a nature filter with a
// zero would read as "we looked and found none", which is a measurement; the
// truth is that the question does not apply.
func TestRarityReportDropsFeaturesTheFilteredFamilyCannotRoll(t *testing.T) {
	report := rarityReport(contracts.WorldFamilyNature, 0, map[string]rarityFeatureCount{}, map[string]map[int]int{})
	for _, feature := range report.Features {
		if feature.Family != contracts.WorldFamilyNature {
			t.Errorf("a nature-filtered report carries %s, which belongs to %s", feature.Key, feature.Family)
		}
	}
	if len(report.Features) == 0 {
		t.Error("filtering to nature removed every feature")
	}
}

// The species share is against the feature's HITS, not against every eligible
// world. Dividing by the population would make three species that must account
// for all of one lottery's hits sum to that lottery's own rate instead of 100%.
func TestSpeciesSharesAreAgainstTheFeaturesOwnHits(t *testing.T) {
	report := rarityReport(
		contracts.WorldFamilyNature,
		0,
		map[string]rarityFeatureCount{"forest-special-bird": {eligible: 200, observed: 70}},
		map[string]map[int]int{"forest-special-bird": {0: 35, 1: 21, 2: 14}},
	)
	var bird contracts.AnalyticsRarityFeatureRate
	for _, feature := range report.Features {
		if feature.Key == "forest-special-bird" {
			bird = feature
		}
	}
	if bird.ObservedPercent != 35 {
		t.Fatalf("observed percent = %v, want 35 (70 of 200)", bird.ObservedPercent)
	}
	if len(bird.Species) != 3 {
		t.Fatalf("species breakdown has %d entries, want 3", len(bird.Species))
	}
	var total float64
	for _, species := range bird.Species {
		total += species.PercentOfHits
	}
	if total != 100 {
		t.Fatalf("species shares sum to %v%%, want 100 — they are shares of the hits, not of the population", total)
	}
	if bird.Species[0].Key != "firebird" || bird.Species[0].Count != 35 || bird.Species[0].PercentOfHits != 50 {
		t.Fatalf("first species resolved wrong: %+v", bird.Species[0])
	}
}

// Worlds with no seed are not misses. They are worlds whose lottery cannot be
// replayed at all, and folding them into a denominator would report a rate that
// falls as history grows.
func TestUnmeasuredWorldsAreCountedSeparatelyFromMisses(t *testing.T) {
	report := rarityReport(
		contracts.WorldFamilyUniverse,
		17,
		map[string]rarityFeatureCount{"black-hole": {eligible: 40, observed: 16}},
		map[string]map[int]int{},
	)
	if report.UnmeasuredWorlds != 17 {
		t.Fatalf("unmeasuredWorlds = %d, want 17", report.UnmeasuredWorlds)
	}
	for _, feature := range report.Features {
		if feature.Key != "black-hole" {
			continue
		}
		if feature.EligibleWorlds != 40 {
			t.Fatalf("eligible worlds = %d — the seedless worlds leaked into the denominator", feature.EligibleWorlds)
		}
		if feature.ObservedPercent != 40 {
			t.Fatalf("observed percent = %v, want 40 (16 of 40)", feature.ObservedPercent)
		}
	}
}
