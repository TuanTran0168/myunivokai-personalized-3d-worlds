package contracts

import (
	"encoding/json"
	"testing"
)

func TestWorldChangedEventSubjectCoversEveryFamily(t *testing.T) {
	expectedSubjects := map[WorldFamily]string{
		WorldFamilyUniverse: UniverseWorldChangedEventSubject,
		WorldFamilyNature:   NatureWorldChangedEventSubject,
		WorldFamilyOcean:    OceanWorldChangedEventSubject,
	}
	for family, expectedSubject := range expectedSubjects {
		subject, err := family.WorldChangedEventSubject()
		if err != nil {
			t.Fatalf("family %q: %v", family, err)
		}
		if subject != expectedSubject {
			t.Fatalf("family %q resolved to %q, want %q", family, subject, expectedSubject)
		}
	}
	if _, err := WorldFamily("forest").WorldChangedEventSubject(); err == nil {
		t.Fatal("expected an unknown family to be rejected rather than defaulted")
	}
}

// The stream filter is "myunivokai.events.>" and analytics-service's NATS
// user subscribes to that same wildcard, so a subject that drifts out of the
// events namespace would silently never be delivered or never be captured.
func TestAnalyticsSubjectsStayInsideTheirNamespaces(t *testing.T) {
	eventSubjects := []string{UniverseWorldChangedEventSubject, NatureWorldChangedEventSubject, OceanWorldChangedEventSubject}
	for _, subject := range eventSubjects {
		if got := subject[:len("myunivokai.events.")]; got != "myunivokai.events." {
			t.Fatalf("%q is not under myunivokai.events.", subject)
		}
	}
	querySubjects := []string{
		AnalyticsOverviewGetQuerySubject,
		AnalyticsWorldListQuerySubject,
		AnalyticsJobListQuerySubject,
		AnalyticsTimeseriesGetQuerySubject,
	}
	for _, subject := range querySubjects {
		if got := subject[:len("myunivokai.queries.analytics.")]; got != "myunivokai.queries.analytics." {
			t.Fatalf("%q is not under myunivokai.queries.analytics.", subject)
		}
	}
}

// A completed event published before analytics-service existed must decode
// with a nil snapshot rather than a zeroed struct, which is the whole reason
// the field is a pointer.
func TestCompletedDataSnapshotIsBackwardCompatible(t *testing.T) {
	legacyPayload := []byte(`{"family":"universe","profileId":"p","dnaVersionId":"d","worldId":"w"}`)
	var completed FamilyCompletedData
	if err := json.Unmarshal(legacyPayload, &completed); err != nil {
		t.Fatalf("decode legacy completed event: %v", err)
	}
	if completed.Snapshot != nil {
		t.Fatalf("expected a nil snapshot for a pre-analytics event, got %#v", completed.Snapshot)
	}
	encoded, err := json.Marshal(completed)
	if err != nil {
		t.Fatalf("re-encode completed event: %v", err)
	}
	var reencoded map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &reencoded); err != nil {
		t.Fatalf("decode re-encoded event: %v", err)
	}
	if _, found := reencoded["snapshot"]; found {
		t.Fatal("a nil snapshot must be omitted, not written as null")
	}
}

func TestPageSizeAndDaysAreClamped(t *testing.T) {
	pageSizeCases := map[int]int{
		0:                            AnalyticsDefaultPageSize,
		-5:                           AnalyticsDefaultPageSize,
		10:                           10,
		AnalyticsMaximumPageSize:     AnalyticsMaximumPageSize,
		AnalyticsMaximumPageSize + 1: AnalyticsMaximumPageSize,
		100000:                       AnalyticsMaximumPageSize,
	}
	for requested, expected := range pageSizeCases {
		if got := NormalizePageSize(requested); got != expected {
			t.Fatalf("NormalizePageSize(%d) = %d, want %d", requested, got, expected)
		}
	}
	dayCases := map[int]int{
		0:                        AnalyticsDefaultDays,
		-1:                       AnalyticsDefaultDays,
		7:                        7,
		AnalyticsMaximumDays + 1: AnalyticsMaximumDays,
	}
	for requested, expected := range dayCases {
		if got := NormalizeDays(requested); got != expected {
			t.Fatalf("NormalizeDays(%d) = %d, want %d", requested, got, expected)
		}
	}
}

// The world-changed fixtures are the executable form of the snapshot
// contract: if a field is renamed in Go without updating them, this fails.
func TestWorldChangedFixturesDecodeIntoTheSnapshotContract(t *testing.T) {
	fixtures := map[string]WorldFamily{
		"../fixtures/universe-world-changed-event.v1.json": WorldFamilyUniverse,
		"../fixtures/nature-world-changed-event.v1.json":   WorldFamilyNature,
		"../fixtures/ocean-world-changed-event.v1.json":    WorldFamilyOcean,
	}
	for fixturePath, expectedFamily := range fixtures {
		var envelope Envelope[FamilyWorldChangedData]
		if err := json.Unmarshal(readFixture(t, fixturePath), &envelope); err != nil {
			t.Fatalf("decode %s: %v", fixturePath, err)
		}
		if err := envelope.Validate(); err != nil {
			t.Fatalf("%s: %v", fixturePath, err)
		}
		snapshot := envelope.Data.Snapshot
		if snapshot.Family != expectedFamily {
			t.Fatalf("%s: family %q, want %q", fixturePath, snapshot.Family, expectedFamily)
		}
		if snapshot.WorldID == "" || snapshot.Revision < 1 || snapshot.WorldCreatedAt.IsZero() {
			t.Fatalf("%s: snapshot is missing an identifying field: %#v", fixturePath, snapshot)
		}
		if snapshot.SelectedVariantNo < 1 || snapshot.SelectedVariantNo > snapshot.VariantCount {
			t.Fatalf("%s: selectedVariantNo %d is outside 1..%d", fixturePath, snapshot.SelectedVariantNo, snapshot.VariantCount)
		}
		// The seed is what makes the rare-feature panel possible at all. A
		// snapshot that carries one must produce a replayable lottery for its
		// own family — the gap this catches is a producer that starts sending
		// the field but sends the WORLD's seed, or a variant number, or an id.
		if snapshot.VariantSeed == "" {
			t.Fatalf("%s: no variantSeed — the rare-feature lottery cannot be replayed for this world", fixturePath)
		}
		if rolls := RarityRollsFor(snapshot.Family, snapshot.VariantSeed); len(rolls) == 0 {
			t.Fatalf("%s: family %q has no lotteries to replay", fixturePath, snapshot.Family)
		}
	}
}
