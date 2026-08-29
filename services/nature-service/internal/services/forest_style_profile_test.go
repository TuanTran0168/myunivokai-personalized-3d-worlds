package services

import (
	"reflect"
	"testing"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// buildWithStyle returns a forest built from one seed under one style, so two
// styles can be compared with nothing else moving between them.
func buildWithStyle(seedValue, mood, style string) models.ForestSceneConfig {
	input := buildTestInput(seedValue, mood, 5)
	input.Input.PreferredWorldStyle = style
	return NewForestConfigBuilder().Build(input)
}

// The property the whole axis rests on, and the reason the golden fixtures
// still pass: a world with no style, an unknown style, or the neutral style
// must be the SAME world. If this fails, every forest stored before styles
// existed has silently changed, and forestSchemaVersion has to be bumped.
func TestTheNeutralStyleChangesNothing(t *testing.T) {
	for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
		none := buildWithStyle("NAT-STYLE-NEUTRAL-"+mood, mood, "")
		wildwood := buildWithStyle("NAT-STYLE-NEUTRAL-"+mood, mood, StyleWildwood)
		unknown := buildWithStyle("NAT-STYLE-NEUTRAL-"+mood, mood, "not-a-style")
		if !equalForestConfigs(none, wildwood) {
			t.Fatalf("%s: wildwood differs from no style at all", mood)
		}
		if !equalForestConfigs(none, unknown) {
			t.Fatalf("%s: an unknown style differs from no style at all", mood)
		}
	}
}

// Every style has to actually do something, or it is the picker that changes
// nothing all over again — which is the entire reason this axis exists.
func TestEveryStyleBuildsADifferentForest(t *testing.T) {
	const seedValue = "NAT-STYLE-DISTINCT"
	baseline := buildWithStyle(seedValue, "dreamy", StyleWildwood)
	for _, style := range []string{StyleAncientGrove, StyleMistwood, StyleEmberfall, StyleLanternwood} {
		if equalForestConfigs(baseline, buildWithStyle(seedValue, "dreamy", style)) {
			t.Fatalf("style %q builds the same forest as wildwood", style)
		}
	}
}

func TestAncientGroveTradesTreeCountForTreeSize(t *testing.T) {
	// The one style whose whole idea is legible as two numbers: far fewer
	// trunks, each far bigger.
	const seedValue = "NAT-STYLE-GROVE"
	wildwood := buildWithStyle(seedValue, "energetic", StyleWildwood)
	grove := buildWithStyle(seedValue, "energetic", StyleAncientGrove)

	if grove.Trees.CountDesktop >= wildwood.Trees.CountDesktop {
		t.Fatalf("grove has %d trees, wildwood %d — the grove must be sparser", grove.Trees.CountDesktop, wildwood.Trees.CountDesktop)
	}
	if grove.Trees.ScaleMax <= wildwood.Trees.ScaleMax {
		t.Fatalf("grove tops out at %.3f, wildwood at %.3f — the grove must be larger", grove.Trees.ScaleMax, wildwood.Trees.ScaleMax)
	}
	if grove.Trees.CountMobile > grove.Trees.CountDesktop {
		t.Fatalf("mobile tree count %d exceeds desktop %d", grove.Trees.CountMobile, grove.Trees.CountDesktop)
	}
}

// A style leans the season, it does not overwrite it. Autumn is written to be
// the foggiest season and must stay the foggiest under every style, or the
// season has stopped meaning anything.
func TestTheStyleBiasesFogWithoutOverwritingTheSeason(t *testing.T) {
	for _, style := range []string{StyleWildwood, StyleAncientGrove, StyleMistwood, StyleEmberfall, StyleLanternwood} {
		profile := forestProfileForStyle(style)
		autumn := clampFloat(fogProbabilityBySeason[SeasonAutumn]+profile.FogProbabilityBias, minimumFogProbability, maximumFogProbability)
		summer := clampFloat(fogProbabilityBySeason[SeasonSummer]+profile.FogProbabilityBias, minimumFogProbability, maximumFogProbability)
		if autumn < summer {
			t.Fatalf("%s: autumn fog %.2f is below summer's %.2f", style, autumn, summer)
		}
		if autumn > maximumFogProbability || summer < minimumFogProbability {
			t.Fatalf("%s: fog probability left its band (autumn %.2f, summer %.2f)", style, autumn, summer)
		}
	}
}

func TestEveryStyleStaysInsideTheBuilderBounds(t *testing.T) {
	// A style is a multiplier on numbers that already have floors and ceilings.
	// The clamps are what stop a style producing a forest the renderer cannot
	// draw, and a clamp nobody exercises is a clamp nobody knows works.
	for _, style := range []string{StyleWildwood, StyleAncientGrove, StyleMistwood, StyleEmberfall, StyleLanternwood} {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := buildWithStyle("NAT-STYLE-BOUNDS-"+style+"-"+mood, mood, style)
			if config.Trees.CountDesktop < minimumTreeCount || config.Trees.CountDesktop > maximumTreeCount {
				t.Fatalf("%s/%s: %d trees is outside %d-%d", style, mood, config.Trees.CountDesktop, minimumTreeCount, maximumTreeCount)
			}
			if config.PostFX.BloomIntensity < minimumBloomIntensity || config.PostFX.BloomIntensity > maximumBloomIntensity {
				t.Fatalf("%s/%s: bloom %.3f is outside %.2f-%.2f", style, mood, config.PostFX.BloomIntensity, minimumBloomIntensity, maximumBloomIntensity)
			}
			if config.Trees.ScaleMin > config.Trees.ScaleMax {
				t.Fatalf("%s/%s: tree scale %.3f-%.3f is inverted", style, mood, config.Trees.ScaleMin, config.Trees.ScaleMax)
			}
			if config.Trees.ScaleMin <= 0 {
				t.Fatalf("%s/%s: tree scale minimum %.3f is not positive", style, mood, config.Trees.ScaleMin)
			}
		}
	}
}

// A style that pinned the light to one time of day would remove a whole axis of
// variety, so every style must still be able to reach every time of day.
func TestNoStyleClosesOffATimeOfDay(t *testing.T) {
	for style, profile := range forestStyleProfiles {
		for index, weight := range profile.TimeOfDayWeights {
			if weight <= 0 {
				t.Fatalf("style %q gives %s a weight of %.2f — no style may make a time of day unreachable", style, timeOfDayKindsInOrder[index], weight)
			}
		}
	}
}

func equalForestConfigs(first, second models.ForestSceneConfig) bool {
	return reflect.DeepEqual(first, second)
}
