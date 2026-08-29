package services

import (
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// The visitor's second axis, and deliberately the one the MOOD does not touch.
//
// Mood decides which season the forest leans toward and how much wind, wildlife
// and bloom it carries. Style decides how that forest is GROWN and LIT: how
// many trees and how big, and what the light and the air are doing. Two axes
// fighting over the same numbers would make one of them unpredictable, which is
// what a control that "sometimes does something" is.
//
// Before this, nature-service accepted a preferredWorldStyle, stored it, and
// never read it once. The create form eventually hid the picker rather than
// keep offering a control that changed nothing — the right call for a control
// that changes nothing, and the wrong one for a family with this much unexposed
// variation in it.

const (
	StyleWildwood     = "wildwood"
	StyleAncientGrove = "ancient-grove"
	StyleMistwood     = "mistwood"
	StyleEmberfall    = "emberfall"
	StyleLanternwood  = "lanternwood"
)

// forestStyleProfile is applied on top of the season and the mood.
//
// TimeOfDayWeights index timeOfDayKindsInOrder. FogProbabilityBias is ADDED to
// the season's own fog probability and then clamped, so autumn stays foggier
// than summer under every style — a style leans the forest, it does not
// overwrite what the season decided. Grade is added to the season's grade for
// the same reason.
type forestStyleProfile struct {
	TimeOfDayWeights    [3]float64
	FogProbabilityBias  float64
	TreeCountMultiplier float64
	TreeScaleMultiplier float64
	BloomMultiplier     float64
	Grade               models.PostFXGradeConfig
}

// The neutral profile, and it must stay EXACTLY neutral: weights identical to
// what timeOfDayWeights already held, every multiplier 1, every bias 0.
//
// That is what lets a style axis be added to a family whose golden fixtures are
// its compatibility contract. A world stored before styles existed carries no
// style, resolves to this, and renders byte for byte as it did. If any number
// here ever moves, forestSchemaVersion moves with it.
var neutralForestStyleProfile = forestStyleProfile{
	TimeOfDayWeights:    timeOfDayWeights,
	FogProbabilityBias:  0,
	TreeCountMultiplier: 1.0,
	TreeScaleMultiplier: 1.0,
	BloomMultiplier:     1.0,
}

var forestStyleProfiles = map[string]forestStyleProfile{
	// The forest as the builder already made it. Named rather than left
	// implicit so the picker has an honest "no style" to sit at, instead of
	// making the first real style the default and changing every world.
	StyleWildwood: neutralForestStyleProfile,

	// Far fewer trees, each far bigger. The count draw is 160-280 before the
	// season multiplier and the floor is 120, so 0.62 lands most worlds on that
	// floor — which is the point. An old-growth grove is a small number of
	// enormous trunks with space between them, and space is the one thing none
	// of the other styles have.
	StyleAncientGrove: {
		TimeOfDayWeights:    [3]float64{0.55, 0.35, 0.10},
		FogProbabilityBias:  0.10,
		TreeCountMultiplier: 0.62,
		TreeScaleMultiplier: 1.45,
		BloomMultiplier:     0.90,
		Grade:               models.PostFXGradeConfig{Saturation: -0.04, Brightness: -0.02, Contrast: 0.05},
	},

	// Fog, near enough always. +0.55 puts summer's 0.20 at 0.75 and autumn's
	// 0.60 at the ceiling, so the season still shows through as HOW CERTAIN the
	// fog is rather than being overwritten by the style.
	StyleMistwood: {
		TimeOfDayWeights:    [3]float64{0.30, 0.30, 0.40},
		FogProbabilityBias:  0.55,
		TreeCountMultiplier: 1.10,
		TreeScaleMultiplier: 1.0,
		BloomMultiplier:     1.25,
		Grade:               models.PostFXGradeConfig{HueRadians: 0.02, Saturation: -0.18, Brightness: 0.04, Contrast: -0.05},
	},

	// Golden hour, which the base table already weights highest because it is
	// the most flattering light for these asset packs. Emberfall commits to it
	// and warms the grade rather than inventing a light of its own.
	StyleEmberfall: {
		TimeOfDayWeights:    [3]float64{0.10, 0.80, 0.10},
		FogProbabilityBias:  -0.05,
		TreeCountMultiplier: 1.0,
		TreeScaleMultiplier: 1.05,
		BloomMultiplier:     1.20,
		Grade:               models.PostFXGradeConfig{HueRadians: -0.04, Saturation: 0.16, Brightness: 0.01, Contrast: 0.06},
	},

	// Dusk, and the brightest bloom in the family. The bloom is what makes this
	// read as lit from within rather than as merely dark.
	StyleLanternwood: {
		TimeOfDayWeights:    [3]float64{0.05, 0.20, 0.75},
		FogProbabilityBias:  0.25,
		TreeCountMultiplier: 1.15,
		TreeScaleMultiplier: 0.95,
		BloomMultiplier:     1.55,
		Grade:               models.PostFXGradeConfig{HueRadians: -0.03, Saturation: 0.10, Brightness: -0.03, Contrast: 0.09},
	},
}

func forestProfileForStyle(style string) forestStyleProfile {
	if profile, ok := forestStyleProfiles[strings.ToLower(strings.TrimSpace(style))]; ok {
		return profile
	}
	return neutralForestStyleProfile
}

// Fog may not be certain and may not be impossible: a style that pinned either
// end would stop the weather being a property of the world.
const (
	minimumFogProbability = 0.05
	maximumFogProbability = 0.95
)

// addGrade layers a style's grade on the season's. Both are small offsets from
// neutral, so adding is the operation that means "and also".
func addGrade(base, overlay models.PostFXGradeConfig) models.PostFXGradeConfig {
	return models.PostFXGradeConfig{
		HueRadians: base.HueRadians + overlay.HueRadians,
		Saturation: base.Saturation + overlay.Saturation,
		Brightness: base.Brightness + overlay.Brightness,
		Contrast:   base.Contrast + overlay.Contrast,
	}
}
