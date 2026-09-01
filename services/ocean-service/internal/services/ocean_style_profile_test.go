package services

import (
	"reflect"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

var everyOceanStyle = []string{StyleOpenWater, StyleCoralGarden, StyleKelpCathedral, StyleCrystalShoal, StyleSiltDrift}

// buildOceanWithStyle returns an ocean built from one seed under one style, so
// two styles can be compared with nothing else moving between them.
func buildOceanWithStyle(seedValue, mood, style string) models.OceanSceneConfig {
	input := buildTestInput(seedValue, mood, 5)
	input.Input.PreferredWorldStyle = style
	return NewOceanConfigBuilder().Build(input)
}

// The property the whole axis rests on, and the reason the golden fixtures
// still pass: a world with no style, an unknown style, or the neutral style
// must be the SAME world. If this fails, every ocean stored before styles
// existed has silently changed, and oceanSchemaVersion has to be bumped.
func TestTheNeutralOceanStyleChangesNothing(t *testing.T) {
	for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
		none := buildOceanWithStyle("OCE-STYLE-NEUTRAL-"+mood, mood, "")
		openWater := buildOceanWithStyle("OCE-STYLE-NEUTRAL-"+mood, mood, StyleOpenWater)
		unknown := buildOceanWithStyle("OCE-STYLE-NEUTRAL-"+mood, mood, "not-a-style")
		if !reflect.DeepEqual(none, openWater) {
			t.Fatalf("%s: open-water differs from no style at all", mood)
		}
		if !reflect.DeepEqual(none, unknown) {
			t.Fatalf("%s: an unknown style differs from no style at all", mood)
		}
	}
}

func TestEveryOceanStyleBuildsADifferentOcean(t *testing.T) {
	const seedValue = "OCE-STYLE-DISTINCT"
	baseline := buildOceanWithStyle(seedValue, "energetic", StyleOpenWater)
	for _, style := range everyOceanStyle[1:] {
		if reflect.DeepEqual(baseline, buildOceanWithStyle(seedValue, "energetic", style)) {
			t.Fatalf("style %q builds the same ocean as open-water", style)
		}
	}
}

// A style may lean the water-type draw; it may not reach water the ZONE does
// not offer. The abyss has no coastal candidates, and the turbidity that makes
// water coastal is river outflow and resuspended sediment — neither of which
// reaches two kilometres down.
func TestNoStyleGivesAZoneWaterItDoesNotHave(t *testing.T) {
	for _, style := range everyOceanStyle {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := buildOceanWithStyle("OCE-STYLE-WATER-"+style+"-"+mood, mood, style)
			candidates := waterTypesByZone[config.Depth.Zone]
			found := false
			for _, candidate := range candidates {
				if candidate == config.Water.JerlovWaterType {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s/%s: zone %s got water type %q, which is not one of %v",
					style, mood, config.Depth.Zone, config.Water.JerlovWaterType, candidates)
			}
		}
	}
}

func TestKelpCathedralGrowsAndCrystalShoalClears(t *testing.T) {
	// The two styles that sit at opposite ends of the same number, checked
	// against each other rather than against an absolute: flora counts have a
	// floor and a ceiling, and an assertion on a raw count would pass for the
	// wrong reason the moment either bound moved.
	const seedValue = "OCE-STYLE-FLORA"
	kelp := buildOceanWithStyle(seedValue, "dreamy", StyleKelpCathedral)
	crystal := buildOceanWithStyle(seedValue, "dreamy", StyleCrystalShoal)

	if kelp.Flora.CountDesktop <= crystal.Flora.CountDesktop {
		t.Fatalf("kelp has %d flora, crystal shoal %d — the cathedral must be denser",
			kelp.Flora.CountDesktop, crystal.Flora.CountDesktop)
	}
	if crystal.Current.MarineSnowCountDesktop >= kelp.Current.MarineSnowCountDesktop {
		t.Fatalf("crystal shoal carries %d marine snow, kelp %d — the clear water must carry less",
			crystal.Current.MarineSnowCountDesktop, kelp.Current.MarineSnowCountDesktop)
	}
}

func TestEveryOceanStyleStaysInsideTheBuilderBounds(t *testing.T) {
	// A style is a multiplier on numbers that already have floors and ceilings.
	// The clamps are what stop a style producing an ocean the renderer cannot
	// draw, and a clamp nobody exercises is a clamp nobody knows works.
	for _, style := range everyOceanStyle {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := buildOceanWithStyle("OCE-STYLE-BOUNDS-"+style+"-"+mood, mood, style)
			if config.Flora.CountDesktop < minimumFloraCount || config.Flora.CountDesktop > maximumFloraCount {
				t.Fatalf("%s/%s: %d flora is outside %d-%d", style, mood, config.Flora.CountDesktop, minimumFloraCount, maximumFloraCount)
			}
			snow := config.Current.MarineSnowCountDesktop
			if snow < minimumMarineSnowCount || snow > maximumMarineSnowCount {
				t.Fatalf("%s/%s: %d marine snow is outside %d-%d", style, mood, snow, minimumMarineSnowCount, maximumMarineSnowCount)
			}
			if config.PostFX.BloomIntensity < minimumBloomIntensity || config.PostFX.BloomIntensity > maximumBloomIntensity {
				t.Fatalf("%s/%s: bloom %.3f is outside %.2f-%.2f", style, mood, config.PostFX.BloomIntensity, minimumBloomIntensity, maximumBloomIntensity)
			}
			if config.Bioluminescence.BloomIntensity < 0 || config.Bioluminescence.BloomIntensity > 1 {
				t.Fatalf("%s/%s: bioluminescence bloom %.3f left 0-1", style, mood, config.Bioluminescence.BloomIntensity)
			}
			if len(config.Fauna.Schools) > maximumSchoolSlots || len(config.Fauna.Drifters) > maximumDrifterSlots {
				t.Fatalf("%s/%s: %d schools and %d drifters exceed the slot limits",
					style, mood, len(config.Fauna.Schools), len(config.Fauna.Drifters))
			}
		}
	}
}

// The abyss is the darkest, emptiest place this family makes, and it is reached
// through a MOOD. No style may fill it with a reef's worth of life — that would
// let one axis undo the other, which is the failure this split exists to avoid.
func TestNoStyleTurnsTheAbyssIntoAReef(t *testing.T) {
	for _, style := range everyOceanStyle {
		config := buildOceanWithStyle("OCE-STYLE-ABYSS-"+style, "reflective", style)
		if config.Depth.Zone != ZoneAbyss {
			continue
		}
		shallowReef := buildOceanWithStyle("OCE-STYLE-ABYSS-"+style, "energetic", StyleCoralGarden)
		if shallowReef.Depth.Zone != ZoneSunlitShallows {
			continue
		}
		if len(config.Fauna.Schools) > len(shallowReef.Fauna.Schools) {
			t.Fatalf("%s: the abyss has more fish schools (%d) than a coral reef (%d)",
				style, len(config.Fauna.Schools), len(shallowReef.Fauna.Schools))
		}
	}
}
