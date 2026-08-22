package services

import (
	"fmt"
	"math"
	"testing"
)

// The negative half of the depth axis, under test.
//
// Every one of these guards a gap that was real. The renderer could draw an
// above-water sea and a sunrise over it for several rounds while no world ever
// asked it to, because the sun's band was one number for both media and the
// altitude band put the camera inside the wave field. Nothing failed — there was
// simply nothing above the waterline to look at, and no fixture covering it.

// pearsonMoskowitzSignificantHeight is Hs = 2.14e-2 * U^2 (Pierson & Moskowitz,
// 1964), repeated here rather than imported so the test states the physics it is
// asserting against instead of trusting the same constant it is checking.
func pearsonMoskowitzSignificantHeight(windSpeedMps float64) float64 {
	return 2.14e-2 * windSpeedMps * windSpeedMps
}

// The four real moods, and the one of them that is above the water. Listed
// rather than derived so this file states the mapping it is asserting instead of
// reading it out of the table under test.
var surfaceTestMoods = []string{"focused", "dreamy", "energetic", "reflective"}

const aboveWaterMood = "focused"

func TestAboveWaterWorldsClearTheirOwnWaves(t *testing.T) {
	builder := NewOceanConfigBuilder()
	checked := 0
	for i := 0; i < 900; i++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-SURFACE-WAVE-%d", i), aboveWaterMood, 4))
		if config.Depth.Metres >= 0 {
			continue
		}
		checked++
		altitude := -config.Depth.Metres
		crest := pearsonMoskowitzSignificantHeight(config.Water.WindSpeedMetresPerSecond)
		// The reason the band moved off 1.4 m. An altitude below the wave crests is
		// not a view of the surface — it is a view from inside it, with no horizon,
		// which is what "where is my water surface" was describing.
		if altitude <= crest {
			t.Fatalf("a world %.2f m up sits inside a %.2f m sea (wind %.1f m/s)",
				altitude, crest, config.Water.WindSpeedMetresPerSecond)
		}
		if altitude < minimumBreachAltitudeMetres ||
			altitude > minimumBreachAltitudeMetres+breachAltitudeRangeMetres {
			t.Fatalf("altitude %.2f m is outside the band", altitude)
		}
	}
	if checked == 0 {
		t.Fatal("no world broke the surface in 900 seeds, so nothing was checked")
	}
}

func TestOnlyAboveWaterWorldsGetALowSun(t *testing.T) {
	builder := NewOceanConfigBuilder()
	above, below := 0, 0
	for i := 0; i < 900; i++ {
		for _, mood := range surfaceTestMoods {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-SURFACE-SUN-%d", i), mood, 4))
			elevation := config.Lighting.SurfaceElevationRadians
			if config.Depth.Metres < 0 {
				above++
				if elevation < minimumBreachedSurfaceElevation ||
					elevation > minimumBreachedSurfaceElevation+breachedSurfaceElevationRange {
					t.Fatalf("above-water sun %.3f rad is outside the breached band", elevation)
				}
				continue
			}
			below++
			// The physics the split is built on: below about 20 degrees the surface
			// reflects rather than transmits, so a low sun underwater is not moody
			// lighting, it is an unlit frame.
			if elevation < minimumSurfaceElevation {
				t.Fatalf("underwater world at %.2f m drew a %.1f degree sun, which does not "+
					"reach a water column at all",
					config.Depth.Metres, elevation*180/math.Pi)
			}
		}
	}
	if above == 0 || below == 0 {
		t.Fatalf("need both media represented, got above=%d below=%d", above, below)
	}
}

func TestGoldenHourIsReachable(t *testing.T) {
	// The user-visible claim, as an assertion: somewhere in this family there is a
	// world with the sea seen from above and the sun near the horizon. It was
	// unreachable by construction before — the sun's floor was 31.5 degrees — and
	// a renderer feature no seed can produce is a feature that does not exist.
	builder := NewOceanConfigBuilder()
	for i := 0; i < 900; i++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-GOLDEN-SURFACE-%d", i), aboveWaterMood, 4))
		if config.Depth.Metres < 0 && config.Lighting.SurfaceElevationRadians < 0.2 {
			return
		}
	}
	t.Fatal("no seed in 900 produced an above-water world with the sun below 11 degrees")
}

func TestTheSurfaceViewIsChosenAndNotRolled(t *testing.T) {
	// This is now a THIRD position on the same question, and each move answered
	// a real defect the previous one produced.
	//
	//   1. A flat rate ("above-water worlds must be 4-22% of oceans") made the
	//      surface view unreachable on purpose (one in twenty, from a control
	//      that did not mention it) and reachable by accident (the abyss drew
	//      it 5% of the time) — wrong for a control someone selects.
	//   2. An absolute pin ("picking Glass Shallows gets the surface every seed")
	//      fixed both halves of that, and then produced ITS OWN defect: every
	//      generation of Glass Shallows was the same photograph, exactly the
	//      complaint that made the zone pin (1.2) get a weighted home back
	//      in 1.3. Glass Shallows was pinned for longer because it is also the
	//      create form's default mood, but the complaint applies to it too.
	//   3. So Glass Shallows is weighted again (AboveWaterProbability), same as
	//      the zone: MOSTLY the surface, so picking it still usually means
	//      what its name promises, but not identically every time.
	//
	// What must stay absolute, and is asserted here with the same force as
	// before: the other three moods are not just unlikely to surface, they are
	// NEVER above the water. A mood nobody asked to surface surfacing even
	// rarely is the original bug's mirror image.
	builder := NewOceanConfigBuilder()
	const seedsPerMood = 400
	stillWaterAbove, stillWaterBelow := 0, 0
	for _, mood := range surfaceTestMoods {
		for i := 0; i < seedsPerMood; i++ {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-SURFACE-RATE-%d", i), mood, 4))
			above := config.Depth.Metres < 0
			if mood != aboveWaterMood && above {
				t.Fatalf("mood %q surfaced at %.2f m; only %q may ever be above the water",
					mood, config.Depth.Metres, aboveWaterMood)
			}
			if mood == aboveWaterMood {
				if above {
					stillWaterAbove++
				} else {
					stillWaterBelow++
				}
			}
		}
	}
	// Both halves are load-bearing: some variety (the 1.4 fix) AND still
	// mostly the surface (the name on the button, and this family's default
	// mood, so the first view most people see is still usually one).
	if stillWaterBelow == 0 {
		t.Fatal("mood \"focused\" surfaced in every one of 400 seeds — AboveWaterProbability is not adding variety")
	}
	if stillWaterAbove <= stillWaterBelow {
		t.Fatalf("mood \"focused\" surfaced only %d/%d times — the surface should still be the common case",
			stillWaterAbove, stillWaterAbove+stillWaterBelow)
	}
}

func TestAboveWaterKeepsItsZoneAndItsFloor(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for i := 0; i < 600; i++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-SURFACE-ZONE-%d", i), aboveWaterMood, 4))
		if config.Depth.Metres >= 0 {
			continue
		}
		// Above the waterline is not a fourth zone. The axis continues through
		// zero and the world is still the shallows it was drawn from — anything
		// else would make the surface view a mode rather than a depth.
		if config.Depth.Zone != ZoneSunlitShallows {
			t.Fatalf("a breached world claims zone %q", config.Depth.Zone)
		}
		// And the seabed is still below the water, not below the camera: the floor
		// is a property of the ocean, not of where the viewer happens to be.
		if config.Depth.SeafloorMetres <= 0 {
			t.Fatalf("a breached world put its seabed at %.2f m", config.Depth.SeafloorMetres)
		}
	}
}

func TestGoldenFixturesCoverBothSidesOfTheWaterline(t *testing.T) {
	// The gap that let all of this through. Four golden worlds, every one of them
	// underwater, so half the axis was outside the compatibility contract and
	// could change without a single fixture noticing.
	builder := NewOceanConfigBuilder()
	above, below := 0, 0
	for _, goldenCase := range goldenCases {
		config := builder.Build(buildTestInput(goldenCase.Seed, goldenCase.Mood, goldenCase.LandmarkCount))
		if config.Depth.Metres < 0 {
			above++
		} else {
			below++
		}
	}
	if above == 0 {
		t.Fatal("no golden fixture is above the waterline")
	}
	if below == 0 {
		t.Fatal("no golden fixture is under the water")
	}
}
