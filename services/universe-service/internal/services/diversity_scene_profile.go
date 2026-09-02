package services

import (
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/seed"
)

// The scene diversity sections (belt, comets, sun, postFX grade) are generated
// deterministically from the variant seed and the atmospheric mood, so the
// frontend renders them purely from stored data (schemaVersion 1.2). The
// frontend preview builder mirrors these tables and ranges
// (apps/myunivokai-personalization/src/lib/scene.ts, buildPreviewBeltConfig /
// buildPreviewCometsConfig / buildPreviewSunConfig / sceneGradeForTheme) —
// keep the two in sync when changing values here.

// Seed suffixes derive independent PRNG streams so adding these sections does
// not disturb the draw order of any pre-existing scene field: old seeds keep
// producing byte-identical planet/core/camera/sky values.
const (
	beltSeedSuffix   = "-belt"
	cometsSeedSuffix = "-comets"
	sunSeedSuffix    = "-sun"
)

// Asteroid belt: most worlds have one, at a seeded density (scaled by the
// mood's particle multiplier and clamped so the instancing cost stays bounded),
// at a seeded distance beyond the outermost orbit, in one of a few realistic
// dark regolith tones, on a slightly random plane.
const (
	beltPresenceProbability         = 0.85
	minimumBeltInstanceCount        = 300
	beltInstanceCountSpread         = 1501
	maximumBeltInstanceCount        = 2500
	minimumBeltGapBeyondLastOrbit   = 1.3
	beltGapBeyondLastOrbitSpread    = 0.9
	maximumBeltTiltMagnitudeRadians = 0.12
)

// Dark regolith tones (asteroid albedo is well under 0.2). The first entry is
// the pre-1.2 frontend constant, so the color family stays anchored to the
// look the owner already approved.
var beltRockColorPalette = []string{"#655B4F", "#5C544B", "#4A443C", "#75695A", "#6B5B4E"}

// Comet population: a weighted count (single roll against cumulative
// thresholds) plus a tail length multiplier. Worlds stored before 1.2 fall
// back to exactly one comet with multiplier 1 — the pre-1.2 look.
const (
	cometCountZeroThreshold    = 0.20
	cometCountOneThreshold     = 0.65
	cometCountTwoThreshold     = 0.90
	maximumCometCount          = 3
	minimumCometTailMultiplier = 0.7
	cometTailMultiplierSpread  = 0.7
)

// The sun's HDR surface multiplier keeps the star above the bloom luminance
// threshold (0.85 in the frontend composer) for every temperature class.
const (
	minimumSunSurfaceHdrMultiplier = 1.35
	sunSurfaceHdrMultiplierSpread  = 0.3
)

// sunTemperatureClass is one stellar temperature look: surface tint, corona
// glow and the point-light color the planets are lit with. Weights are
// relative probabilities of a single cumulative roll.
type sunTemperatureClass struct {
	SurfaceTintColor string
	GlowColor        string
	LightColor       string
	Weight           float64
}

// Loosely the G/K/F/A stellar classes. The G entry reproduces the pre-1.2
// frontend constants (white HDR tint, #FDB813 glow, #FFF4D6 light) so the
// most common draw is the look the owner already approved.
var sunTemperatureClasses = []sunTemperatureClass{
	{SurfaceTintColor: "#FFFFFF", GlowColor: "#FDB813", LightColor: "#FFF4D6", Weight: 0.45},
	{SurfaceTintColor: "#FFE3C4", GlowColor: "#FF9E4A", LightColor: "#FFDDB8", Weight: 0.25},
	{SurfaceTintColor: "#FDFDFF", GlowColor: "#FFD86B", LightColor: "#FFF9EC", Weight: 0.20},
	{SurfaceTintColor: "#E9F0FF", GlowColor: "#BFD4FF", LightColor: "#EDF3FF", Weight: 0.10},
}

// Per-theme color grades, promoted from the frontend's hardcoded table
// (PostEffects.tsx THEME_SCENE_GRADES) into stored data. Values are identical
// to that table, so a 1.2 world grades exactly like a pre-1.2 world of the
// same theme — the promotion changes where the knob lives, not the look.
var defaultPostFXGrade = models.PostFXGradeConfig{HueRadians: 0, Saturation: 0.05, Brightness: 0, Contrast: 0.05}

var postFXGradesByTheme = map[string]models.PostFXGradeConfig{
	"cosmic-galaxy": {HueRadians: 0, Saturation: 0.06, Brightness: 0, Contrast: 0.06},
	"nebula":        {HueRadians: 0, Saturation: 0.12, Brightness: 0.01, Contrast: 0.05},
	"crystal":       {HueRadians: 0, Saturation: -0.04, Brightness: 0.02, Contrast: 0.09},
	"aurora":        {HueRadians: 0, Saturation: 0.09, Brightness: 0, Contrast: 0.06},
	"cyber-orbit":   {HueRadians: 0, Saturation: 0.14, Brightness: 0, Contrast: 0.1},
}

// buildBeltConfig derives the asteroid belt section from a dedicated PRNG
// stream. Every draw happens even for a disabled belt so the draw order is
// fixed forever.
func buildBeltConfig(input BuildWorldConfigInput, moodProfile moodSceneProfile) *models.BeltConfig {
	beltRandom := seed.NewPRNG(input.Seed + beltSeedSuffix)

	// Fixed draw order — reordering these lines changes every world's belt.
	enabled := beltRandom.Float64() < beltPresenceProbability
	instanceCount := clampInt(
		scaleCount(minimumBeltInstanceCount+beltRandom.Intn(beltInstanceCountSpread), moodProfile.ParticleMultiplier),
		minimumBeltInstanceCount,
		maximumBeltInstanceCount,
	)
	gapBeyondLastOrbit := round(minimumBeltGapBeyondLastOrbit + beltRandom.Float64()*beltGapBeyondLastOrbitSpread)
	rockColor := beltRockColorPalette[beltRandom.Intn(len(beltRockColorPalette))]
	tiltXRadians := round((beltRandom.Float64()*2 - 1) * maximumBeltTiltMagnitudeRadians)
	tiltZRadians := round((beltRandom.Float64()*2 - 1) * maximumBeltTiltMagnitudeRadians)

	return &models.BeltConfig{
		Enabled:            enabled,
		InstanceCount:      instanceCount,
		GapBeyondLastOrbit: gapBeyondLastOrbit,
		RockColor:          rockColor,
		TiltXRadians:       tiltXRadians,
		TiltZRadians:       tiltZRadians,
	}
}

// buildCometsConfig derives the comet population from a dedicated PRNG stream.
func buildCometsConfig(input BuildWorldConfigInput) *models.CometsConfig {
	cometsRandom := seed.NewPRNG(input.Seed + cometsSeedSuffix)

	// Fixed draw order.
	countRoll := cometsRandom.Float64()
	tailLengthMultiplier := round(minimumCometTailMultiplier + cometsRandom.Float64()*cometTailMultiplierSpread)

	return &models.CometsConfig{
		Count:                cometCountForRoll(countRoll),
		TailLengthMultiplier: tailLengthMultiplier,
	}
}

func cometCountForRoll(roll float64) int {
	if roll < cometCountZeroThreshold {
		return 0
	}
	if roll < cometCountOneThreshold {
		return 1
	}
	if roll < cometCountTwoThreshold {
		return 2
	}
	return maximumCometCount
}

// buildSunConfig derives the central star's temperature class and HDR surface
// intensity from a dedicated PRNG stream.
func buildSunConfig(input BuildWorldConfigInput) *models.SunConfig {
	sunRandom := seed.NewPRNG(input.Seed + sunSeedSuffix)

	// Fixed draw order.
	classRoll := sunRandom.Float64()
	surfaceHdrMultiplier := round(minimumSunSurfaceHdrMultiplier + sunRandom.Float64()*sunSurfaceHdrMultiplierSpread)

	temperatureClass := sunTemperatureClassForRoll(classRoll)
	return &models.SunConfig{
		SurfaceTintColor:     temperatureClass.SurfaceTintColor,
		GlowColor:            temperatureClass.GlowColor,
		LightColor:           temperatureClass.LightColor,
		SurfaceHdrMultiplier: surfaceHdrMultiplier,
	}
}

// sunTemperatureClassForRoll resolves a cumulative-weight roll against the
// temperature class table. The roll is scaled by the total weight, so the
// table does not need to sum to exactly 1.
func sunTemperatureClassForRoll(roll float64) sunTemperatureClass {
	totalWeight := 0.0
	for _, class := range sunTemperatureClasses {
		totalWeight += class.Weight
	}
	scaledRoll := roll * totalWeight
	cumulativeWeight := 0.0
	for _, class := range sunTemperatureClasses {
		cumulativeWeight += class.Weight
		if scaledRoll < cumulativeWeight {
			return class
		}
	}
	return sunTemperatureClasses[len(sunTemperatureClasses)-1]
}

// buildPostFXGradeConfig looks the grade up by theme — no PRNG stream, so the
// grade of a 1.2 world is identical to the frontend fallback of a pre-1.2
// world with the same theme.
func buildPostFXGradeConfig(theme string) *models.PostFXGradeConfig {
	if grade, ok := postFXGradesByTheme[theme]; ok {
		return &grade
	}
	grade := defaultPostFXGrade
	return &grade
}

func clampInt(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
