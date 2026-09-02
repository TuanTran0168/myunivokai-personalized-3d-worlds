package services

import (
	"math"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/seed"
)

// The sky section (Milky Way + constellations) is generated deterministically
// from the variant seed, the world style (theme) and the atmospheric mood, so
// the frontend renders the night sky purely from stored data. The frontend
// preview builder mirrors these tables and ranges
// (apps/myunivokai-personalization/src/lib/scene.ts, buildPreviewSkyConfig) — keep the two
// in sync when changing values here.

// Seed suffixes derive independent PRNG streams so adding the sky section does
// not disturb the draw order of the pre-existing scene fields: old seeds keep
// producing byte-identical planet/core/camera values.
const (
	skySeedSuffix      = "-sky"
	milkyWaySeedSuffix = "-milky-way"
)

// Star populations: base count + PRNG spread, scaled by the mood's particle
// multiplier so a dreamy sky is denser than a reflective one. Ranges follow
// the tuned frontend defaults.
const (
	minimumAllSkyStarCount = 4800
	allSkyStarCountSpread  = 801
	minimumBandStarCount   = 5200
	bandStarCountSpread    = 801
	minimumCoreStarCount   = 2400
	coreStarCountSpread    = 401
	minimumHeroStarCount   = 22
	heroStarCountSpread    = 11
)

// Cloud sprite populations. Dust is NOT mood-scaled: the dark rift is galaxy
// structure, not atmosphere.
const (
	minimumNebulaCloudCount = 380
	nebulaCloudCountSpread  = 81
	minimumCoreCloudCount   = 140
	coreCloudCountSpread    = 41
	minimumDustCloudCount   = 240
	dustCloudCountSpread    = 41
)

// Cloud layer opacities scale with the mood's bloom multiplier within clamped
// photographic bounds (many sprites at low alpha; see agent-system/memory/archive/sky-db-and-realism-plan.md).
const (
	baseNebulaCloudOpacity    = 0.10
	minimumNebulaCloudOpacity = 0.05
	maximumNebulaCloudOpacity = 0.16
	baseCoreCloudOpacity      = 0.12
	minimumCoreCloudOpacity   = 0.06
	maximumCoreCloudOpacity   = 0.20
	dustCloudOpacity          = 0.40
)

// Each world's galaxy sits at its own tilt, inside ranges that keep the band
// visible from the default camera.
const (
	minimumBandTiltXRadians = 0.35
	bandTiltXSpreadRadians  = 0.30
	minimumBandTiltZRadians = 0.20
	bandTiltZSpreadRadians  = 0.30
)

// Sky drift speeds (radians/second), scaled by the mood's motion multiplier.
// The Milky Way is the farthest layer so it drifts slower than the figures.
const (
	baseMilkyWayRotationRadiansPerSecond      = 0.003
	baseConstellationRotationRadiansPerSecond = 0.005
)

const (
	minimumConstellationDisplayCount = 6
	constellationDisplayCountSpread  = 3
	minimumConstellationGlow         = 0.7
	maximumConstellationGlow         = 1.3
)

// Small rotation values need more precision than the scene-wide 2-decimal
// round() (which would crush 0.003 to 0).
const rotationDecimalPlaces = 4

// skyThemeProfile recolors the night sky per world style: constellation tints
// plus the accent entry of the nebula cloud palette.
type skyThemeProfile struct {
	ConstellationStarColor string
	ConstellationLineColor string
	NebulaAccentColor      string
}

var defaultSkyThemeProfile = skyThemeProfile{
	ConstellationStarColor: "#F2EEE6",
	ConstellationLineColor: "#D9B96E",
	NebulaAccentColor:      "#C9B7D6",
}

// Keyed by the allowed world themes (validation/world.go allowedThemes).
var skyThemeProfiles = map[string]skyThemeProfile{
	"cosmic-galaxy": {ConstellationStarColor: "#EAF2FF", ConstellationLineColor: "#8FB6FF", NebulaAccentColor: "#8FA5CE"},
	"nebula":        {ConstellationStarColor: "#F3E8FF", ConstellationLineColor: "#C084FC", NebulaAccentColor: "#9D7BD8"},
	"crystal":       {ConstellationStarColor: "#EAFBFF", ConstellationLineColor: "#7DD3FC", NebulaAccentColor: "#7FB8D8"},
	"aurora":        {ConstellationStarColor: "#ECFFF6", ConstellationLineColor: "#6EE7B7", NebulaAccentColor: "#7FC9A8"},
	"cyber-orbit":   {ConstellationStarColor: "#E6FDFF", ConstellationLineColor: "#22D3EE", NebulaAccentColor: "#5FB8C9"},
}

func skyThemeProfileForTheme(theme string) skyThemeProfile {
	if profile, ok := skyThemeProfiles[theme]; ok {
		return profile
	}
	return defaultSkyThemeProfile
}

// Blackbody star colors — the vendian.org spectral-class anchors (O through M).
// Weights skew hot/blue: among stars bright enough to see, hot B/A types
// dominate, with a warm minority.
var skyStarColorDistribution = []models.WeightedColor{
	{Color: "#9BB0FF", Weight: 0.10},
	{Color: "#AABFFF", Weight: 0.18},
	{Color: "#CAD7FF", Weight: 0.22},
	{Color: "#F8F7FF", Weight: 0.20},
	{Color: "#FFF4EA", Weight: 0.15},
	{Color: "#FFD2A1", Weight: 0.10},
	{Color: "#FFCC6F", Weight: 0.05},
}

// The galactic bulge is an old stellar population — yellow/orange dominated.
var coreStarColorDistribution = []models.WeightedColor{
	{Color: "#FFF4EA", Weight: 0.30},
	{Color: "#FFD2A1", Weight: 0.35},
	{Color: "#FFCC6F", Weight: 0.25},
	{Color: "#F8F7FF", Weight: 0.10},
}

// Photo-derived nebulosity stratification: deep blue-gray haze, blue
// scattering, cream star-cloud body, then brown-red dust rims. The theme
// contributes the accent entry.
func nebulaCloudColorDistribution(themeProfile skyThemeProfile) []models.WeightedColor {
	return []models.WeightedColor{
		{Color: "#2A3550", Weight: 0.26},
		{Color: "#8FA5CE", Weight: 0.22},
		{Color: "#E8DCC0", Weight: 0.18},
		{Color: themeProfile.NebulaAccentColor, Weight: 0.14},
		{Color: "#6B4530", Weight: 0.12},
		{Color: "#4A3020", Weight: 0.08},
	}
}

// Warm cream-to-amber glow around the galactic center.
var coreCloudColorDistribution = []models.WeightedColor{
	{Color: "#F5E3B8", Weight: 0.40},
	{Color: "#E8C79A", Weight: 0.30},
	{Color: "#D9A468", Weight: 0.20},
	{Color: "#B98A58", Weight: 0.10},
}

// Near-black with faint brown — the Great Rift's absorption lane.
var dustCloudColorDistribution = []models.WeightedColor{
	{Color: "#0D0D12", Weight: 0.40},
	{Color: "#120C08", Weight: 0.30},
	{Color: "#1A1210", Weight: 0.30},
}

// buildSkyConfig derives the whole sky section from the variant seed, theme
// and mood. All PRNG draws happen in a fixed order on a dedicated stream.
func buildSkyConfig(input BuildWorldConfigInput, moodProfile moodSceneProfile) *models.SkyConfig {
	skyRandom := seed.NewPRNG(input.Seed + skySeedSuffix)
	themeProfile := skyThemeProfileForTheme(input.DNA.VisualHints.Theme)

	// Fixed draw order — reordering these lines changes every world's sky.
	allSkyStarCount := scaleCount(minimumAllSkyStarCount+skyRandom.Intn(allSkyStarCountSpread), moodProfile.ParticleMultiplier)
	bandStarCount := scaleCount(minimumBandStarCount+skyRandom.Intn(bandStarCountSpread), moodProfile.ParticleMultiplier)
	coreStarCount := scaleCount(minimumCoreStarCount+skyRandom.Intn(coreStarCountSpread), moodProfile.ParticleMultiplier)
	heroStarCount := minimumHeroStarCount + skyRandom.Intn(heroStarCountSpread)
	nebulaCloudCount := scaleCount(minimumNebulaCloudCount+skyRandom.Intn(nebulaCloudCountSpread), moodProfile.ParticleMultiplier)
	coreCloudCount := scaleCount(minimumCoreCloudCount+skyRandom.Intn(coreCloudCountSpread), moodProfile.ParticleMultiplier)
	dustCloudCount := minimumDustCloudCount + skyRandom.Intn(dustCloudCountSpread)
	bandTiltXRadians := round(minimumBandTiltXRadians + skyRandom.Float64()*bandTiltXSpreadRadians)
	bandTiltZRadians := round(minimumBandTiltZRadians + skyRandom.Float64()*bandTiltZSpreadRadians)
	constellationDisplayCount := minimumConstellationDisplayCount + skyRandom.Intn(constellationDisplayCountSpread)

	return &models.SkyConfig{
		MilkyWay: models.MilkyWayConfig{
			Seed:                     input.Seed + milkyWaySeedSuffix,
			AllSkyStarCount:          allSkyStarCount,
			BandStarCount:            bandStarCount,
			CoreStarCount:            coreStarCount,
			HeroStarCount:            heroStarCount,
			NebulaCloudCount:         nebulaCloudCount,
			CoreCloudCount:           coreCloudCount,
			DustCloudCount:           dustCloudCount,
			StarColors:               skyStarColorDistribution,
			CoreStarColors:           coreStarColorDistribution,
			NebulaCloudColors:        nebulaCloudColorDistribution(themeProfile),
			CoreCloudColors:          coreCloudColorDistribution,
			DustCloudColors:          dustCloudColorDistribution,
			NebulaCloudOpacity:       round(clampFloat(baseNebulaCloudOpacity*moodProfile.BloomMultiplier, minimumNebulaCloudOpacity, maximumNebulaCloudOpacity)),
			CoreCloudOpacity:         round(clampFloat(baseCoreCloudOpacity*moodProfile.BloomMultiplier, minimumCoreCloudOpacity, maximumCoreCloudOpacity)),
			DustCloudOpacity:         dustCloudOpacity,
			BandTiltXRadians:         bandTiltXRadians,
			BandTiltZRadians:         bandTiltZRadians,
			RotationRadiansPerSecond: roundTo(baseMilkyWayRotationRadiansPerSecond*moodProfile.MotionMultiplier, rotationDecimalPlaces),
		},
		Constellations: models.ConstellationConfig{
			// Matches the frontend's pre-1.1 fallback (`${seed}-constellations`
			// derived from the variant seed), so old worlds keep their figures.
			Seed:                     input.Seed,
			DisplayCount:             constellationDisplayCount,
			StarColor:                themeProfile.ConstellationStarColor,
			LineColor:                themeProfile.ConstellationLineColor,
			GlowMultiplier:           round(clampFloat(moodProfile.BloomMultiplier, minimumConstellationGlow, maximumConstellationGlow)),
			RotationRadiansPerSecond: roundTo(baseConstellationRotationRadiansPerSecond*moodProfile.MotionMultiplier, rotationDecimalPlaces),
		},
	}
}

func scaleCount(count int, multiplier float64) int {
	return int(float64(count) * multiplier)
}

func roundTo(value float64, decimalPlaces int) float64 {
	scale := math.Pow(10, float64(decimalPlaces))
	return math.Round(value*scale) / scale
}
