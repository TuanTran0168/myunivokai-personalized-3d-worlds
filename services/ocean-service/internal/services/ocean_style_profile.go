package services

import (
	"strings"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

// The visitor's second axis, and deliberately the one the MOOD does not touch.
//
// In this family mood already owns DEPTH — each of the four moods names a zone,
// and "The Abyss" is a coordinate, not a character. So style owns the other
// thing an ocean is: THE WATER, and what grows and swims in it. Two reefs at
// the same depth genuinely can sit in different water, which is why the water
// type was a draw rather than a derivation in the first place; a style leans
// that draw instead of replacing it.
//
// Nothing here is invented. Jerlov's optical classification is already modelled
// in ocean_water_optics.go and already picked per zone — this exposes the axis
// the service has always had and never let anyone touch.
//
// Before this, ocean-service accepted a preferredWorldStyle, stored it, and
// never read it once.

const (
	StyleOpenWater     = "open-water"
	StyleCoralGarden   = "coral-garden"
	StyleKelpCathedral = "kelp-cathedral"
	StyleCrystalShoal  = "crystal-shoal"
	StyleSiltDrift     = "silt-drift"
)

// oceanStyleProfile is applied on top of the zone and the mood.
//
// WaterClarityBias shifts the water-type roll before it indexes the zone's
// candidate list: negative is clearer, positive is more turbid. It cannot
// reach water the ZONE does not offer — the abyss has no coastal candidates,
// and a style may not put river outflow two kilometres down.
type oceanStyleProfile struct {
	WaterClarityBias     float64
	FloraMultiplier      float64
	FaunaMultiplier      float64
	BloomMultiplier      float64
	MarineSnowMultiplier float64
	Grade                models.PostFXGradeConfig
}

// The neutral profile, and it must stay EXACTLY neutral: every multiplier 1,
// every bias 0.
//
// That is what lets a style axis be added to a family whose golden fixtures are
// its compatibility contract. An ocean stored before styles existed carries no
// style, resolves to this, and renders byte for byte as it did. If any number
// here ever moves, oceanSchemaVersion moves with it.
var neutralOceanStyleProfile = oceanStyleProfile{
	WaterClarityBias:     0,
	FloraMultiplier:      1.0,
	FaunaMultiplier:      1.0,
	BloomMultiplier:      1.0,
	MarineSnowMultiplier: 1.0,
}

var oceanStyleProfiles = map[string]oceanStyleProfile{
	// The ocean as the builder already made it. Named rather than left implicit
	// so the picker has an honest "no style" to sit at, instead of making the
	// first real style the default and changing every world.
	StyleOpenWater: neutralOceanStyleProfile,

	// A reef: dense flora, plenty of fauna, and water on the clearer half of
	// whatever the zone allows. The bias is modest because a reef is coastal by
	// definition — turning a reef gin-clear would make it an aquarium.
	StyleCoralGarden: {
		WaterClarityBias:     -0.20,
		FloraMultiplier:      1.60,
		FaunaMultiplier:      1.25,
		BloomMultiplier:      1.05,
		MarineSnowMultiplier: 0.85,
		Grade:                models.PostFXGradeConfig{HueRadians: -0.02, Saturation: 0.14, Contrast: 0.04},
	},

	// A kelp forest, which is the one place in this family where flora is the
	// architecture rather than the decoration. Murkier on purpose: kelp grows
	// in nutrient-rich water, and nutrient-rich water is green and short-sighted.
	StyleKelpCathedral: {
		WaterClarityBias:     0.28,
		FloraMultiplier:      2.00,
		FaunaMultiplier:      0.85,
		BloomMultiplier:      1.20,
		MarineSnowMultiplier: 1.15,
		Grade:                models.PostFXGradeConfig{HueRadians: 0.05, Saturation: 0.06, Brightness: -0.03, Contrast: 0.06},
	},

	// The clearest water the zone has, almost nothing growing, and the fauna
	// carrying the whole frame. This is the style that reads as scale: with
	// nothing near the camera, distance is the only thing left to look at.
	StyleCrystalShoal: {
		WaterClarityBias:     -0.45,
		FloraMultiplier:      0.45,
		FaunaMultiplier:      1.45,
		BloomMultiplier:      1.25,
		MarineSnowMultiplier: 0.55,
		Grade:                models.PostFXGradeConfig{HueRadians: 0.02, Saturation: -0.05, Brightness: 0.05, Contrast: -0.03},
	},

	// Sediment. The most turbid water the zone allows, marine snow at its
	// heaviest, and the least life — the ocean as a weather system rather than
	// as a habitat.
	StyleSiltDrift: {
		WaterClarityBias:     0.50,
		FloraMultiplier:      0.70,
		FaunaMultiplier:      0.65,
		BloomMultiplier:      0.85,
		MarineSnowMultiplier: 1.80,
		Grade:                models.PostFXGradeConfig{HueRadians: 0.04, Saturation: -0.16, Brightness: -0.04, Contrast: -0.06},
	},
}

func oceanProfileForStyle(style string) oceanStyleProfile {
	if profile, ok := oceanStyleProfiles[strings.ToLower(strings.TrimSpace(style))]; ok {
		return profile
	}
	return neutralOceanStyleProfile
}

// addGrade layers a style's grade on the zone's. Both are small offsets from
// neutral, so adding is the operation that means "and also".
func addGrade(base, overlay models.PostFXGradeConfig) models.PostFXGradeConfig {
	return models.PostFXGradeConfig{
		HueRadians: base.HueRadians + overlay.HueRadians,
		Saturation: base.Saturation + overlay.Saturation,
		Brightness: base.Brightness + overlay.Brightness,
		Contrast:   base.Contrast + overlay.Contrast,
	}
}
