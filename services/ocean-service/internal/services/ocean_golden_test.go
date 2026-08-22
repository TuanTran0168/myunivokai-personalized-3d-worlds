package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The golden fixtures are the compatibility contract in executable form
// (mirrored descriptively by contracts/scenes/ocean-scene-config.schema.json):
// saved oceans must render forever, so a byte-level change to what the builder
// emits for an existing seed is a BREAKING change. If this test fails after an
// intentional contract change, bump oceanSchemaVersion, keep a reader for the
// old version, and regenerate deliberately with:
//
//	UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures
//
// These same four files pin the FRONTEND preview builder
// (apps/myunivokai-web/src/lib/oceanScene.ts). The depth curve is implemented
// twice — once in Go and once in TypeScript — and a shared fixture is the only
// thing that stops the two drifting.
var goldenCases = []struct {
	Name          string
	Seed          string
	Mood          string
	LandmarkCount int
}{
	// One case per mood, and since each mood now pins one depth, these four ARE
	// the create form's four DEPTH & MOOD options — the whole axis, in order,
	// with the fixture name matching the mood that produces it.
	//
	//	focused     OCN-GOLDEN-TWILIGHT   above water     -22.62 m   sun 4.0 deg
	//	energetic   OCN-GOLDEN-SURGE      sunlitShallows      ~24 m
	//	dreamy      OCN-GOLDEN-BLOOM      twilightReach      ~120 m
	//	reflective  OCN-GOLDEN-DEEP       abyss             ~3000 m
	//
	// The seeds are inherited from when the zone was rolled rather than pinned,
	// so the names no longer describe the depths they used to land in — kept
	// anyway, because a fixture's value is that it does not move, and renaming
	// the seeds would throw away the one property they exist for.
	{Name: "reflective", Seed: "OCN-GOLDEN-DEEP", Mood: "reflective", LandmarkCount: 5},
	{Name: "focused", Seed: "OCN-GOLDEN-TWILIGHT", Mood: "focused", LandmarkCount: 3},
	{Name: "dreamy", Seed: "OCN-GOLDEN-BLOOM", Mood: "dreamy", LandmarkCount: 7},
	{Name: "energetic", Seed: "OCN-GOLDEN-SURGE", Mood: "energetic", LandmarkCount: 4},

	// ---- ABOVE THE WATERLINE ---------------------------------------------
	// Not covered until recently, and that gap is why the surface view stayed
	// broken through several rounds of work: every golden world was underwater,
	// so the entire negative half of this family's own axis was outside the
	// compatibility contract. A path no fixture exercises is a path that drifts.
	//
	//	surface-golden-hour  OCN-GOLDEN-SURFACE-1  -10.07 m   sun  4.6 deg
	//	surface-daylight     OCN-GOLDEN-SURFACE-4   -9.51 m   sun 37.2 deg
	//
	// The two bracket the sun band an above-water world can draw from, because
	// the low end is a different photograph from the high end and both have to
	// keep working. Both are "focused", the only mood that can be above the
	// water — they are two more samples of that one preset, not a fifth and
	// sixth option. "-SURFACE-7" was the golden-hour seed through 1.3; since
	// 1.4 made "focused" a weighted roll rather than an absolute pin, that
	// particular seed's roll now lands underwater, so "-SURFACE-1" replaces it
	// as the seed that still surfaces at a similarly low sun. It is a seed
	// swap, not a band change: nothing about what the golden-hour bracket is
	// FOR moved, only which fixed string still demonstrates it.
	{Name: "surface-golden-hour", Seed: "OCN-GOLDEN-SURFACE-1", Mood: "focused", LandmarkCount: 4},
	{Name: "surface-daylight", Seed: "OCN-GOLDEN-SURFACE-4", Mood: "focused", LandmarkCount: 4},
}

func TestGoldenFixtures(t *testing.T) {
	builder := NewOceanConfigBuilder()
	updateGolden := os.Getenv("UPDATE_GOLDEN") == "1"
	for _, goldenCase := range goldenCases {
		config := builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount))
		got, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			t.Fatalf("marshal config for %s: %v", goldenCase.Name, err)
		}
		got = append(got, '\n')
		fixturePath := filepath.Join("testdata", "ocean-golden-"+goldenCase.Name+".json")
		if updateGolden {
			if err := os.MkdirAll("testdata", 0o755); err != nil {
				t.Fatalf("create testdata dir: %v", err)
			}
			if err := os.WriteFile(fixturePath, got, 0o644); err != nil {
				t.Fatalf("write golden %s: %v", fixturePath, err)
			}
			continue
		}
		want, err := os.ReadFile(fixturePath)
		if err != nil {
			t.Fatalf("read golden %s (create it with UPDATE_GOLDEN=1): %v", fixturePath, err)
		}
		// The repo checks files out with CRLF on Windows; normalize before the
		// byte comparison so the contract check is about content, not line
		// endings.
		normalizedWant := strings.ReplaceAll(string(want), "\r\n", "\n")
		if string(got) != normalizedWant {
			t.Fatalf("golden fixture %s no longer matches the builder output — this is a breaking contract change; bump oceanSchemaVersion (or regenerate deliberately with UPDATE_GOLDEN=1)", fixturePath)
		}
	}
}

// The four goldens must not all land in one zone, or they would pin a third of
// the family and quietly stop covering the rest of it.
func TestGoldenFixturesCoverEveryDepthZone(t *testing.T) {
	builder := NewOceanConfigBuilder()
	zones := map[string]bool{}
	for _, goldenCase := range goldenCases {
		zones[builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount)).Depth.Zone] = true
	}
	for _, zone := range zoneKindsInOrder {
		if !zones[zone] {
			t.Fatalf("no golden fixture lands in %q; the goldens pin only %v — pick different seeds", zone, zones)
		}
	}
}
