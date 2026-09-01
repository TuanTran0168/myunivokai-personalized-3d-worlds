package services

import (
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

// This file is the forest family's tuning table: every season/weather/wildlife
// table and every numeric bound the deterministic builder draws within. It is
// the future mirror pair of the frontend's forest sceneProfile module — when a
// ForestRenderer lands, keep the two in sync (same discipline as
// universe-service's mood_scene_profile.go ↔ scene.ts).

// Season kinds, in canonical order. The order is part of the contract: the
// mood season-weight vectors index into it, and the "giao mùa" transition
// picks an adjacent season cyclically (winter wraps to spring).
const (
	SeasonSpring = "spring"
	SeasonSummer = "summer"
	SeasonAutumn = "autumn"
	SeasonWinter = "winter"
)

var seasonKindsInOrder = []string{SeasonSpring, SeasonSummer, SeasonAutumn, SeasonWinter}

// Weather kinds. Snow only ever appears in winter; rain never does — the
// per-season weight tables below encode the whole compatibility matrix.
const (
	WeatherClear    = "clear"
	WeatherSunRays  = "sunRays"
	WeatherOvercast = "overcast"
	WeatherRain     = "rain"
	WeatherSnow     = "snow"
)

const (
	TimeOfDayDay        = "day"
	TimeOfDayGoldenHour = "goldenHour"
	TimeOfDayDusk       = "dusk"
)

const (
	GroundGrass      = "grass"
	GroundLeafLitter = "leafLitter"
	GroundSnow       = "snow"
)

// Landmark kinds — the forest counterpart of planet archetypes. The first DNA
// landmark always becomes the heart tree (the hero of the portrait); the rest
// draw from nonHeroLandmarkKinds with a deterministic dedupe walk.
const (
	LandmarkHeartTree     = "heartTree"
	LandmarkStandingStone = "standingStone"
	LandmarkPond          = "pond"
	LandmarkFlowerPatch   = "flowerPatch"
	LandmarkFallenLog     = "fallenLog"
	LandmarkLanternShrine = "lanternShrine"
)

var nonHeroLandmarkKinds = []string{LandmarkStandingStone, LandmarkPond, LandmarkFlowerPatch, LandmarkFallenLog, LandmarkLanternShrine}

const (
	BirdPatternCircling = "circling"
	BirdPatternCrossing = "crossing"
)

// Model keys the configs may reference. The frontend asset catalog (asset
// round) must resolve every key here to a self-hosted GLB file; the builder
// tests assert nothing outside this vocabulary is ever emitted.
const (
	ModelKeyTreeBirch      = "tree-birch"
	ModelKeyTreeOak        = "tree-oak"
	ModelKeyTreePine       = "tree-pine"
	ModelKeyTreePineSnow   = "tree-pine-snow"
	ModelKeyTreeDead       = "tree-dead"
	ModelKeyTreeBlossom    = "tree-blossom"
	ModelKeyAnimalDeer     = "animal-deer"
	ModelKeyAnimalFox      = "animal-fox"
	ModelKeyAnimalRabbit   = "animal-rabbit"
	ModelKeyAnimalBoar     = "animal-boar"
	ModelKeyAnimalWolf     = "animal-wolf"
	ModelKeyAnimalStag     = "animal-stag"
	ModelKeyAnimalBear     = "animal-bear"
	ModelKeyAnimalSquirrel = "animal-squirrel"
	ModelKeyBirdForest     = "bird-forest"
	ModelKeyRockMossy      = "rock-mossy"
)

var landmarkModelKeysByKind = map[string]string{
	LandmarkHeartTree:     "landmark-heart-tree",
	LandmarkStandingStone: "landmark-standing-stone",
	LandmarkPond:          "landmark-pond",
	LandmarkFlowerPatch:   "landmark-flower-patch",
	LandmarkFallenLog:     "landmark-fallen-log",
	LandmarkLanternShrine: "landmark-lantern-shrine",
}

// assetCatalogVersion pins which frontend catalog resolves the model keys, so
// stored configs stay interpretable when the catalog evolves.
const assetCatalogVersion = "nature-1"

// forestMoodProfile tunes the deterministic forest numbers by atmospheric
// mood. SeasonWeights index into seasonKindsInOrder — a leaning season, never
// a hard mapping, so repeated generations still vary.
type forestMoodProfile struct {
	SeasonWeights      [4]float64
	WindMultiplier     float64
	WildlifeMultiplier float64
	BloomMultiplier    float64
}

var neutralForestProfile = forestMoodProfile{
	SeasonWeights:      [4]float64{0.25, 0.25, 0.25, 0.25},
	WindMultiplier:     1.0,
	WildlifeMultiplier: 1.0,
	BloomMultiplier:    1.0,
}

// Keyed by the atmospheric mood values the create form sends. The leaning
// season per mood: focused → winter (crisp, still), dreamy → spring (blossom,
// soft), energetic → summer (lush, breezy, most wildlife), reflective →
// autumn (golden, misty, falling leaves).
var forestMoodProfiles = map[string]forestMoodProfile{
	"focused":    {SeasonWeights: [4]float64{0.15, 0.15, 0.15, 0.55}, WindMultiplier: 0.8, WildlifeMultiplier: 0.8, BloomMultiplier: 1.0},
	"dreamy":     {SeasonWeights: [4]float64{0.55, 0.15, 0.15, 0.15}, WindMultiplier: 0.9, WildlifeMultiplier: 1.0, BloomMultiplier: 1.3},
	"energetic":  {SeasonWeights: [4]float64{0.15, 0.55, 0.15, 0.15}, WindMultiplier: 1.3, WildlifeMultiplier: 1.3, BloomMultiplier: 1.2},
	"reflective": {SeasonWeights: [4]float64{0.15, 0.15, 0.55, 0.15}, WindMultiplier: 0.7, WildlifeMultiplier: 0.7, BloomMultiplier: 0.8},
}

func forestProfileForMood(mood string) forestMoodProfile {
	if profile, ok := forestMoodProfiles[strings.ToLower(strings.TrimSpace(mood))]; ok {
		return profile
	}
	return neutralForestProfile
}

type weightedWeatherKind struct {
	Kind   string
	Weight float64
}

// The season ↔ weather compatibility matrix, as weights. Weights are relative
// probabilities; they do not need to sum to 1.
var weatherWeightsBySeason = map[string][]weightedWeatherKind{
	SeasonSpring: {
		{Kind: WeatherClear, Weight: 0.15},
		{Kind: WeatherSunRays, Weight: 0.25},
		{Kind: WeatherOvercast, Weight: 0.15},
		{Kind: WeatherRain, Weight: 0.45},
	},
	SeasonSummer: {
		{Kind: WeatherClear, Weight: 0.20},
		{Kind: WeatherSunRays, Weight: 0.33},
		{Kind: WeatherOvercast, Weight: 0.12},
		{Kind: WeatherRain, Weight: 0.35},
	},
	SeasonAutumn: {
		{Kind: WeatherClear, Weight: 0.12},
		{Kind: WeatherSunRays, Weight: 0.18},
		{Kind: WeatherOvercast, Weight: 0.25},
		{Kind: WeatherRain, Weight: 0.45},
	},
	SeasonWinter: {
		{Kind: WeatherClear, Weight: 0.18},
		{Kind: WeatherOvercast, Weight: 0.27},
		{Kind: WeatherSnow, Weight: 0.55},
	},
}

// Two foliage palettes per season; a seeded roll picks one so same-season
// forests still differ in tint.
var foliagePalettesBySeason = map[string][][]string{
	SeasonSpring: {
		{"#7FBF6A", "#A8D08D", "#F5B7CD"},
		{"#89C97C", "#B7DFA1", "#F7C9DD"},
	},
	SeasonSummer: {
		{"#3E7C3F", "#5B9E52", "#77B366"},
		{"#356F38", "#4F9149", "#6FAF5D"},
	},
	SeasonAutumn: {
		{"#C2571B", "#D98E2B", "#8F3B1B"},
		{"#B8641F", "#E0A032", "#7C2F16"},
	},
	SeasonWinter: {
		{"#4F6B57", "#6C8578", "#DDE7EC"},
		{"#45604E", "#5F7A6B", "#E6EEF2"},
	},
}

var groundKindsBySeason = map[string]string{
	SeasonSpring: GroundGrass,
	SeasonSummer: GroundGrass,
	SeasonAutumn: GroundLeafLitter,
	SeasonWinter: GroundSnow,
}

// Canvas clear color under the HDRI/fog — the forest counterpart of the
// universe's mood background.
var backgroundColorsBySeason = map[string]string{
	SeasonSpring: "#0B120D",
	SeasonSummer: "#0A120C",
	SeasonAutumn: "#120E08",
	SeasonWinter: "#0B1016",
}

// Two species mixes per season; a seeded roll picks one. Winter leans on the
// snow-capped pine variants and bare trees; spring is the only season with
// blossom trees.
var treeSpeciesMixesBySeason = map[string][][]models.TreeSpeciesMixEntry{
	SeasonSpring: {
		{
			{ModelKey: ModelKeyTreeBirch, Weight: 0.40},
			{ModelKey: ModelKeyTreeOak, Weight: 0.35},
			{ModelKey: ModelKeyTreePine, Weight: 0.15},
			{ModelKey: ModelKeyTreeBlossom, Weight: 0.10},
		},
		{
			{ModelKey: ModelKeyTreeOak, Weight: 0.45},
			{ModelKey: ModelKeyTreeBirch, Weight: 0.30},
			{ModelKey: ModelKeyTreeBlossom, Weight: 0.25},
		},
	},
	SeasonSummer: {
		{
			{ModelKey: ModelKeyTreeOak, Weight: 0.45},
			{ModelKey: ModelKeyTreeBirch, Weight: 0.30},
			{ModelKey: ModelKeyTreePine, Weight: 0.25},
		},
		{
			{ModelKey: ModelKeyTreeBirch, Weight: 0.50},
			{ModelKey: ModelKeyTreeOak, Weight: 0.30},
			{ModelKey: ModelKeyTreePine, Weight: 0.20},
		},
	},
	SeasonAutumn: {
		{
			{ModelKey: ModelKeyTreeOak, Weight: 0.40},
			{ModelKey: ModelKeyTreeBirch, Weight: 0.30},
			{ModelKey: ModelKeyTreePine, Weight: 0.15},
			{ModelKey: ModelKeyTreeDead, Weight: 0.15},
		},
		{
			{ModelKey: ModelKeyTreeBirch, Weight: 0.45},
			{ModelKey: ModelKeyTreeOak, Weight: 0.35},
			{ModelKey: ModelKeyTreeDead, Weight: 0.20},
		},
	},
	SeasonWinter: {
		{
			{ModelKey: ModelKeyTreePineSnow, Weight: 0.45},
			{ModelKey: ModelKeyTreePine, Weight: 0.20},
			{ModelKey: ModelKeyTreeDead, Weight: 0.35},
		},
		{
			{ModelKey: ModelKeyTreePineSnow, Weight: 0.60},
			{ModelKey: ModelKeyTreeDead, Weight: 0.40},
		},
	},
}

// Winter forests are naturally sparser; the other seasons stay near the base
// tree count.
var treeCountMultipliersBySeason = map[string]float64{
	SeasonSpring: 1.00,
	SeasonSummer: 1.05,
	SeasonAutumn: 1.00,
	SeasonWinter: 0.85,
}

// Widened in schema 1.1 ("đa dạng động vật hơn"): stag joins the cold
// seasons, bears roam summer/autumn, squirrels the warm ones. Reordering or
// extending a season's list shifts the species draw for existing seeds — that
// is exactly why 1.1 bumped the schema version and regenerated the goldens.
var groundAnimalSpeciesBySeason = map[string][]string{
	SeasonSpring: {ModelKeyAnimalDeer, ModelKeyAnimalRabbit, ModelKeyAnimalFox, ModelKeyAnimalSquirrel},
	SeasonSummer: {ModelKeyAnimalDeer, ModelKeyAnimalFox, ModelKeyAnimalBoar, ModelKeyAnimalRabbit, ModelKeyAnimalBear, ModelKeyAnimalSquirrel},
	SeasonAutumn: {ModelKeyAnimalDeer, ModelKeyAnimalFox, ModelKeyAnimalBoar, ModelKeyAnimalStag, ModelKeyAnimalBear},
	SeasonWinter: {ModelKeyAnimalDeer, ModelKeyAnimalWolf, ModelKeyAnimalFox, ModelKeyAnimalStag},
}

// Base active slot counts before the mood wildlife multiplier; fractional so
// the multiplier has room to round up or down (e.g. winter 0.9 × energetic
// 1.3 rounds to 1, × reflective 0.7 rounds to 1... to 0 for birds).
// Bumped in schema 1.2 ("tăng thêm số lượng động vật") — more active slots so
// several species share the clearing at once.
var baseGroundAnimalSlotsBySeason = map[string]float64{
	SeasonSpring: 3.5,
	SeasonSummer: 4.5,
	SeasonAutumn: 3.5,
	SeasonWinter: 2.5,
}

var baseBirdFlocksBySeason = map[string]float64{
	SeasonSpring: 1.6,
	SeasonSummer: 1.6,
	SeasonAutumn: 1.0,
	SeasonWinter: 0.6,
}

// Canonical order. Like seasonKindsInOrder this order is part of the contract:
// forestStyleProfile.TimeOfDayWeights indexes into it.
var timeOfDayKindsInOrder = []string{TimeOfDayDay, TimeOfDayGoldenHour, TimeOfDayDusk}

// Golden hour gets the biggest weight on purpose: it is the most flattering
// light for the stylized asset packs (the beauty-first decision). These are the
// weights a world with no style gets, and neutralForestStyleProfile is these
// exact numbers.
var timeOfDayWeights = [3]float64{0.35, 0.45, 0.20}

type floatRange struct {
	Minimum float64
	Maximum float64
}

var sunElevationBoundsByTimeOfDay = map[string]floatRange{
	TimeOfDayDay:        {Minimum: 0.70, Maximum: 1.10},
	TimeOfDayGoldenHour: {Minimum: 0.25, Maximum: 0.45},
	TimeOfDayDusk:       {Minimum: 0.12, Maximum: 0.30},
}

var sunColorsByTimeOfDay = map[string]string{
	TimeOfDayDay:        "#FFF6E5",
	TimeOfDayGoldenHour: "#FFD9A0",
	TimeOfDayDusk:       "#FF9E6B",
}

var ambientColorsByTimeOfDay = map[string]string{
	TimeOfDayDay:        "#9DB4C8",
	TimeOfDayGoldenHour: "#8A93A8",
	TimeOfDayDusk:       "#6E7A96",
}

// HDRI keys resolved by the frontend asset catalog (asset round); one
// environment per time of day keeps the download budget flat.
var hdriKeysByTimeOfDay = map[string]string{
	TimeOfDayDay:        "nature-hdri-day",
	TimeOfDayGoldenHour: "nature-hdri-golden-hour",
	TimeOfDayDusk:       "nature-hdri-dusk",
}

var fogColorsBySeason = map[string]string{
	SeasonSpring: "#BCC9B4",
	SeasonSummer: "#C4D2BE",
	SeasonAutumn: "#C9B79C",
	SeasonWinter: "#D7DEE6",
}

// Autumn mist is a signature of the season; summer stays mostly clear.
var fogProbabilityBySeason = map[string]float64{
	SeasonSpring: 0.30,
	SeasonSummer: 0.20,
	SeasonAutumn: 0.60,
	SeasonWinter: 0.45,
}

var cloudCoverageBoundsByWeatherKind = map[string]floatRange{
	WeatherClear:    {Minimum: 0.05, Maximum: 0.25},
	WeatherSunRays:  {Minimum: 0.15, Maximum: 0.35},
	WeatherOvercast: {Minimum: 0.60, Maximum: 0.95},
	WeatherRain:     {Minimum: 0.55, Maximum: 0.90},
	WeatherSnow:     {Minimum: 0.50, Maximum: 0.85},
}

// Per-season color grades (hue radians, saturation, brightness, contrast) —
// the forest counterpart of universe-service's per-theme grade table.
var forestGradesBySeason = map[string]models.PostFXGradeConfig{
	SeasonSpring: {HueRadians: 0.01, Saturation: 0.10, Brightness: 0.03, Contrast: 0.04},
	SeasonSummer: {HueRadians: 0.00, Saturation: 0.18, Brightness: 0.02, Contrast: 0.06},
	SeasonAutumn: {HueRadians: -0.02, Saturation: 0.15, Brightness: 0.02, Contrast: 0.08},
	SeasonWinter: {HueRadians: 0.03, Saturation: -0.22, Brightness: 0.05, Contrast: 0.06},
}

// Numeric bounds for every seeded draw. Ranges are expressed as base + range
// so `base + roll*range` reads directly against this table.
const (
	// season
	transitionProbability    = 0.20
	minimumSeasonBlendAmount = 0.20
	seasonBlendAmountRange   = 0.40

	// lighting
	minimumSunExposure    = 0.95
	sunExposureRange      = 0.20
	minimumFogDensity     = 0.008
	fogDensityRange       = 0.020
	baseBloomIntensity    = 0.25
	bloomIntensityRange   = 0.50
	minimumBloomIntensity = 0.20
	maximumBloomIntensity = 1.20

	// terrain
	minimumClearingRadius    = 8.0
	clearingRadiusRange      = 3.0
	treelineRadiusMultiplier = 4.2
	minimumHillAmplitude     = 0.8
	hillAmplitudeRange       = 1.4
	minimumHillFrequency     = 0.03
	hillFrequencyRange       = 0.04
	minimumRockCount         = 8
	rockCountSpread          = 12 // Intn(12) → 8..19
	minimumGrassTuftCount    = 600
	grassTuftCountSpread     = 601 // 600..1200
	mobileGrassTuftFraction  = 0.35
	pathProbability          = 0.70
	minimumCameraDistance    = 14.0
	cameraDistanceRange      = 6.0
	forestCameraFOV          = 50.0

	// trees
	baseTreeCount            = 160
	treeCountSpread          = 121 // 160..280 before the season multiplier
	minimumTreeCount         = 120
	maximumTreeCount         = 320
	mobileTreeFraction       = 0.40
	treeScaleMinimumBase     = 0.75
	treeScaleMinimumRange    = 0.15
	treeScaleMaximumBase     = 1.30
	treeScaleMaximumRange    = 0.30
	foliageTintStrengthBase  = 0.50
	foliageTintStrengthRange = 0.35
	windStrengthBase         = 0.35
	windStrengthRange        = 0.50
	minimumWindStrength      = 0.10
	maximumWindStrength      = 1.00
	windGustFrequencyBase    = 0.28
	windGustFrequencyRange   = 0.42

	// weather
	weatherIntensityBase  = 0.42
	weatherIntensityRange = 0.58
	baseRainDropCount     = 3000
	rainDropCountRange    = 4000
	mobileRainFraction    = 0.30
	baseSnowflakeCount    = 1500
	snowflakeCountRange   = 2500
	mobileSnowFraction    = 0.30

	// wildlife — slots are FIXED so the PRNG draw count never changes; the
	// active count only gates how many drawn slots are kept. Slot/altitude
	// numbers changed in schema 1.2 (more animals; low + high bird tiers).
	maximumGroundAnimalSlots = 5
	maximumBirdFlockSlots    = 2
	groundAnimalCountBase    = 1
	groundAnimalCountSpread  = 3 // 1..3 individuals per slot
	walkSpeedBase            = 0.35
	walkSpeedRange           = 0.40
	animalScaleBase          = 0.85
	animalScaleRange         = 0.25
	birdsPerFlockBase        = 3
	birdsPerFlockSpread      = 5 // 3..7 birds
	// Low floor + wide range so different flocks land in different altitude
	// bands (skimming the treeline vs. high soaring), not all "too high".
	birdAltitudeBase           = 5.0
	birdAltitudeBaseRange      = 17.0
	birdAltitudeSpanBase       = 4.0
	birdAltitudeSpanRange      = 6.0
	flightSpeedBase            = 0.40
	flightSpeedRange           = 0.40
	circlingPatternProbability = 0.60

	// ambient particles
	baseFallingLeafCount    = 180
	fallingLeafCountSpread  = 181 // 180..360
	baseBlossomPetalCount   = 120
	blossomPetalCountSpread = 121 // 120..240
	baseFireflyCount        = 40
	fireflyCountSpread      = 41 // 40..80
	baseSnowDustCount       = 100
	snowDustCountSpread     = 101 // 100..200

	// landmarks
	landmarkAngleJitterRadians  = 0.25
	landmarkRadiusFractionBase  = 0.55
	landmarkRadiusFractionRange = 0.35
)

// seasonForRoll maps a [0,1) roll onto the mood's season weights.
func seasonForRoll(roll float64, weights [4]float64) string {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	if total <= 0 {
		return seasonKindsInOrder[0]
	}
	cumulative := 0.0
	for index, weight := range weights {
		cumulative += weight
		if roll < cumulative/total {
			return seasonKindsInOrder[index]
		}
	}
	return seasonKindsInOrder[len(seasonKindsInOrder)-1]
}

// adjacentSeason picks the next or previous season cyclically — the two
// neighbors are the only sensible "giao mùa" targets.
func adjacentSeason(kind string, directionRoll float64) string {
	index := 0
	for i, seasonKind := range seasonKindsInOrder {
		if seasonKind == kind {
			index = i
			break
		}
	}
	if directionRoll < 0.5 {
		return seasonKindsInOrder[(index+1)%len(seasonKindsInOrder)]
	}
	return seasonKindsInOrder[(index+len(seasonKindsInOrder)-1)%len(seasonKindsInOrder)]
}

func weatherKindForRoll(roll float64, entries []weightedWeatherKind) string {
	total := 0.0
	for _, entry := range entries {
		total += entry.Weight
	}
	if total <= 0 || len(entries) == 0 {
		return WeatherClear
	}
	cumulative := 0.0
	for _, entry := range entries {
		cumulative += entry.Weight
		if roll < cumulative/total {
			return entry.Kind
		}
	}
	return entries[len(entries)-1].Kind
}

func timeOfDayForRoll(roll float64, weights [3]float64) string {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	if total <= 0 {
		return timeOfDayKindsInOrder[len(timeOfDayKindsInOrder)-1]
	}
	cumulative := 0.0
	for index, weight := range weights {
		cumulative += weight
		if roll < cumulative/total {
			return timeOfDayKindsInOrder[index]
		}
	}
	return timeOfDayKindsInOrder[len(timeOfDayKindsInOrder)-1]
}

func clampFloat(value, minimum, maximum float64) float64 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
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
