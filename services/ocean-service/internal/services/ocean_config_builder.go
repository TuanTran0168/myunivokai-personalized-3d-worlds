package services

import (
	"fmt"
	"math"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
	"github.com/myunivokai/myunivokai/services/ocean-service/internal/seed"
)

// Renderers are keyed by (sceneType, schemaVersion); any byte-level change to
// what this builder emits for an existing seed is a breaking change and must
// bump the schema version.
//
// 1.4 makes one more: "Glass Shallows"'s surface view is a weighted roll
// (AboveWaterProbability) rather than an absolute pin, for the identical
// reason 1.3 gave the zone back its weighted home — a pin makes every
// generation of one mood the same photograph. The other three moods'
// probability is a flat 0 and is unaffected in outcome, but the new
// aboveWaterRoll draw still shifts the depth stream's later rolls for every
// mood, so every existing seed's depth moves regardless.
//
// 1.5 widens the sunlit shallows' own depthBandByZone and
// floorClearanceBandByZone (see ocean_scene_profile.go): the shallowest reef
// worlds sat the camera as little as 3 m from the surface, which is not
// enough real distance for the underwater-surface shader's own fog-based
// swallow to do anything, so a turbid style could paint a wall of light
// straight overhead.
//
// 1.6 turns landmarks.heightAboveFloor from a 0-6 m LIFT into a per-kind bed
// depth, which is negative (see landmarkBedDepthMetresByKind in
// ocean_scene_profile.go): all six kinds are seabed features and the lift left
// them hanging in the water column with a gap underneath.
//
// No reader is kept for 1.1 through 1.5 because this family has not shipped and
// nothing has ever been stored at any of them — a compatibility shim for zero
// rows is a liability, not caution. The version still moves so the renderer key
// does, and so contracts/scenes/ocean-scene-config.schema.json has to move with
// it: that file's `const` is what makes the contracts conformance test the
// thing that catches a forgotten bump.
const (
	oceanSchemaVersion = "1.6"
	oceanSceneType     = "ocean"
)

// Every section draws from its own seed-derived PRNG stream, in a fixed draw
// order, and ALL draws always happen even when a gate zeroes the feature — so
// adding features later never shifts existing draws (the discipline
// universe-service established and nature-service kept). Labels are prefixed
// "-ocean-" so no stream can ever collide with a forest or universe one.
const (
	depthSeedSuffix           = "-ocean-depth"
	lightingSeedSuffix        = "-ocean-lighting"
	seafloorSeedSuffix        = "-ocean-seafloor"
	currentSeedSuffix         = "-ocean-current"
	floraSeedSuffix           = "-ocean-flora"
	faunaSeedSuffix           = "-ocean-fauna"
	bioluminescenceSeedSuffix = "-ocean-biolum"
	landmarksSeedSuffix       = "-ocean-landmarks"
	seaStateSeedSuffix        = "-ocean-sea-state"
)

// Frontend-side scatter stream labels. The backend never draws from these; it
// stores them in the config so the renderer derives placements and paths
// deterministically (the MilkyWayConfig.Seed pattern).
const (
	seafloorScatterSeedSuffix    = "-ocean-seafloor-scatter"
	floraPlacementSeedSuffix     = "-ocean-flora-placement"
	bioluminescenceFlickerSuffix = "-ocean-biolum-flicker"
	schoolPathSeedPrefixFormat   = "%s-ocean-school-%d"
	drifterPathSeedPrefixFormat  = "%s-ocean-drifter-%d"
	giantPassSeedPrefixFormat    = "%s-ocean-giant-%d"
)

// Default palette anchors, identical to universe-service and nature-service so
// a visitor's favourite colours read the same across all three portraits.
const (
	defaultPrimaryColor   = "#8B5CF6"
	defaultSecondaryColor = "#06B6D4"
	paletteAccentColor    = "#FACC15"
)

type OceanConfigBuilder struct{}

func NewOceanConfigBuilder() *OceanConfigBuilder {
	return &OceanConfigBuilder{}
}

type BuildOceanConfigInput struct {
	DNA       models.OceanDNA
	Seed      string
	VariantNo int
	Input     models.VisualIntent
}

func (b *OceanConfigBuilder) Build(input BuildOceanConfigInput) models.OceanSceneConfig {
	moodProfile := oceanProfileForMood(input.Input.Mood)
	// An unknown or absent style resolves to the neutral profile, which is a
	// no-op in every one of its fields — so an ocean stored before this family
	// had styles builds exactly as it always did. See ocean_style_profile.go.
	styleProfile := oceanProfileForStyle(input.Input.PreferredWorldStyle)
	primary := defaultPrimaryColor
	secondary := defaultSecondaryColor
	if len(input.Input.FavoriteColors) > 0 {
		primary = input.Input.FavoriteColors[0]
	}
	if len(input.Input.FavoriteColors) > 1 {
		secondary = input.Input.FavoriteColors[1]
	}

	depth := buildDepthConfig(input, moodProfile)
	// One evaluation of the curve, reused by every section that needs it. The
	// results are STORED below; nothing recomputes this at render time.
	depthResponse := DepthAt(depth.Metres)

	water := buildWaterConfig(input, depth, depthResponse, moodProfile, styleProfile)
	lighting, bloomIntensity, grade := buildLightingConfig(input, depth, depthResponse, moodProfile, styleProfile)
	seafloor, cameraDistance := buildSeafloorConfig(input)
	current := buildCurrentConfig(input, depth, moodProfile, styleProfile)
	flora := buildFloraConfig(input, depth, moodProfile, styleProfile)
	fauna := buildFaunaConfig(input, depth, water, moodProfile, styleProfile)
	bioluminescence := buildBioluminescenceConfig(input, depth, moodProfile, styleProfile)
	landmarks := buildLandmarkConfigs(input, cameraDistance, primary, secondary)

	return models.OceanSceneConfig{
		SchemaVersion: oceanSchemaVersion,
		SceneType:     oceanSceneType,
		SceneName:     input.DNA.SceneName,
		Archetype:     input.DNA.Archetype,
		Quote:         input.DNA.Quote,
		Theme:         input.DNA.VisualHints.Theme,
		Palette: models.Palette{
			Background: backgroundColorsByZone[depth.Zone],
			Primary:    primary,
			Secondary:  secondary,
			Accent:     paletteAccentColor,
			Gradient:   []string{primary, secondary, paletteAccentColor},
		},
		Depth:           depth,
		Water:           water,
		Lighting:        lighting,
		Seafloor:        seafloor,
		Current:         current,
		Flora:           flora,
		Fauna:           fauna,
		Bioluminescence: bioluminescence,
		Landmarks:       landmarks,
		Camera:          models.CameraConfig{Distance: cameraDistance, FOV: oceanCameraFOV},
		PostFX: models.PostFXConfig{
			BloomIntensity: bloomIntensity,
			Grade:          grade,
		},
		HUD:    models.HUDConfig{ShowTraitBars: true, ShowLabels: true},
		Assets: buildAssetsConfig(flora, fauna, landmarks),
	}
}

// Draw order: zone drift, transition roll, transition direction, blend
// amount, depth-within-band, floor clearance, altitude, boundary, boundary
// amount. The transition draws happen even for non-transition worlds so the
// depth pick never shifts, and the altitude draw happens even for worlds
// under the water.
func buildDepthConfig(input BuildOceanConfigInput, moodProfile oceanMoodProfile) models.DepthConfig {
	rng := seed.NewPRNG(input.Seed + depthSeedSuffix)
	// Drawn first because every later roll in this function needs to know
	// which zone's band it is rolling within. See driftZone for the clamp that
	// keeps this from reproducing the bug the 1.2 pin fixed.
	zoneDriftRoll := rng.Float64()
	// Also drawn unconditionally, for every mood, even the three whose
	// AboveWaterProbability is a flat 0 — the same "every draw always happens"
	// discipline as the rest of this stream, so a later change to any one
	// mood's probability cannot shift what an unrelated mood's seed produces.
	aboveWaterRoll := rng.Float64()
	transitionRoll := rng.Float64()
	transitionDirectionRoll := rng.Float64()
	blendAmountRoll := rng.Float64()
	depthWithinBandRoll := rng.Float64()
	floorClearanceRoll := rng.Float64()
	altitudeRoll := rng.Float64()
	boundaryRoll := rng.Float64()
	boundaryAmountRoll := rng.Float64()

	// The mood names a HOME zone; this is which zone one particular seed
	// actually lands in. See oceanMoodProfile's own doc comment for why this
	// is a weighted lean again rather than the absolute pin 1.2 shipped, and
	// why that is safe this time.
	zone := driftZone(input.Input.Mood, moodProfile, zoneDriftRoll)
	band := depthBandByZone[zone]
	metres := round(band.Minimum + depthWithinBandRoll*(band.Maximum-band.Minimum))

	// The seabed is drawn from the clearance below the viewer, not from an
	// absolute depth, so it can never come out above the viewer's own depth.
	clearanceBand := floorClearanceBandByZone[zone]
	clearance := clearanceBand.Minimum + floorClearanceRoll*(clearanceBand.Maximum-clearanceBand.Minimum)

	// The seabed is fixed before the viewer can surface, so a world that breaks
	// the waterline still has a real floor under it rather than one computed
	// from a negative depth.
	seafloorMetres := round(metres + clearance)

	// ---- ABOVE THE WATERLINE --------------------------------------------
	// A negative depth means the viewer is ABOVE the water, by that many metres.
	// It is not a mode and not a fourth zone: depth is this family's axis, and
	// the axis simply continues through zero. The renderer already branches on
	// the sign — air is a different medium, not water with different numbers.
	//
	// Weighted by the mood rather than pinned, so the sea-surface view is
	// something a person can ask for AND, for "Glass Shallows" specifically,
	// something that varies rather than repeating identically every seed —
	// see AboveWaterProbability. The whole altitude roll spreads the height
	// independently of whether the surface roll succeeded, so a world that
	// only just qualified for the surface is not always the lowest one over
	// it, and a mood whose probability is 0 still burns this roll unused.
	if aboveWaterRoll < moodProfile.AboveWaterProbability {
		metres = round(-(minimumBreachAltitudeMetres + altitudeRoll*breachAltitudeRangeMetres))
	}

	// ---- THE BOUNDARY RULE ----------------------------------------------
	// Applied BEFORE the surface breach, because a breached world is above the
	// water and can see the surface by definition.
	//
	// The reach here uses the clearest water any zone can be made of, which is
	// the conservative direction: a world guaranteed visible in Jerlov I might
	// still be marginal in III, so the bands below are set well inside it.
	reach := SightingRangeForWaterType(MurkiestWaterTypeForZone(zone)) * boundarySightMultiplier
	if metres > reach && seafloorMetres-metres > reach {
		// The shallow end of this world's OWN band, if the surface is reachable
		// from there. Never out of the band: a lift that changes the zone
		// changes what the world IS.
		liftCeiling := math.Min(reach, band.Maximum)
		if boundaryRoll >= seamountRiseProbability && liftCeiling > band.Minimum {
			metres = round(band.Minimum + boundaryAmountRoll*(liftCeiling-band.Minimum))
			seafloorMetres = round(metres + clearance)
		} else {
			// A seamount under an open-water world. The viewer's depth — this
			// family's whole axis — is untouched.
			seafloorMetres = round(metres + minimumRiseClearanceMetres + boundaryAmountRoll*riseClearanceRangeMetres)
		}
	}

	config := models.DepthConfig{
		Metres: metres,
		// Derived, never drawn: the zone label and the metres cannot disagree.
		Zone:           ZoneForDepth(metres),
		SeafloorMetres: seafloorMetres,
	}
	if transitionRoll < zoneTransitionProbability {
		config.BlendTowardZone = adjacentZone(config.Zone, transitionDirectionRoll)
		config.BlendAmount = round(minimumZoneBlendAmount + blendAmountRoll*zoneBlendAmountRange)
	}
	return config
}

// buildWaterConfig draws exactly one value, and it is deliberately not a
// colour. Everything that decides how the water LOOKS is a consequence of
// depth — that is the whole point of the family, and giving it a colour stream
// would let two worlds at the same depth disagree about the colour of the sea.
//
// The sea state is not a property of depth. Wind is weather: two worlds at the
// same depth can legitimately have a mirror and a whitecapped chop, and before
// this the renderer manufactured one by hashing the seed, which put a physical
// property of the world outside the world's record. It draws from its OWN
// stream so that adding it moved nothing that already existed.
func buildWaterConfig(input BuildOceanConfigInput, depth models.DepthConfig, depthResponse DepthResponse, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) models.WaterConfig {
	rng := seed.NewPRNG(input.Seed + seaStateSeedSuffix)
	windRoll := rng.Float64()
	waterTypeRoll := rng.Float64()

	// How far you can see is the SHORTER of two limits, and they are different
	// quantities: how clear the water is, and how much light is left to see by.
	// A trench is gin-clear and unlit; a harbour is brilliantly lit and opaque.
	// Storing only the light-limited one is what made the first version of this
	// call an abyssal world "coastal, turbid".
	// The style shifts WHERE IN THE ZONE'S OWN LIST the draw lands, never what
	// is on the list: the abyss offers no coastal water however silty the style
	// is, because the turbidity that makes water coastal is river outflow and
	// resuspended sediment and neither reaches two kilometres down.
	waterType := WaterTypeForZone(depth.Zone, clampFloat(waterTypeRoll+styleProfile.WaterClarityBias, 0, 1))
	visibility := math.Min(depthResponse.VisibilityMetres, SightingRangeForWaterType(waterType))

	return models.WaterConfig{
		FogColor:         depthResponse.FogColor,
		FogDensity:       depthResponse.FogDensity,
		VisibilityMetres: round(visibility),
		TintStrength:     depthResponse.TintStrength,
		JerlovWaterType:  waterType,
		// An energetic world gets a rougher sea and a reflective one a calmer
		// sea, on the same multiplier the currents already use.
		WindSpeedMetresPerSecond: WindSpeedForRoll(windRoll, moodProfile.CurrentMultiplier),
	}
}

// Draw order: surface elevation, exposure jitter, bloom, sun azimuth, grade
// jitter (hue, saturation, brightness, contrast). Colours, god rays and
// caustics come from the depth curve and are drawn from no stream at all.
// Returns the lighting section, the bloom intensity and the grade (both live
// under postFX in the envelope).
func buildLightingConfig(input BuildOceanConfigInput, depth models.DepthConfig, depthResponse DepthResponse, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) (models.OceanLightingConfig, float64, models.PostFXGradeConfig) {
	rng := seed.NewPRNG(input.Seed + lightingSeedSuffix)
	surfaceElevationRoll := rng.Float64()
	exposureRoll := rng.Float64()
	bloomRoll := rng.Float64()
	// The full circle, with no preferred direction: the renderer places the
	// camera opposite the bearing and therefore composes toward the sun
	// whatever the bearing is, so constraining it would only remove variety
	// without buying any composition.
	azimuthRoll := rng.Float64()
	// Appended after every existing draw in this stream, so this jitter moved
	// nothing that already existed here (the depth-zone draw it depends on
	// lives in its own stream and moved for its own reason — see
	// buildDepthConfig).
	hueJitterRoll := rng.Float64()
	saturationJitterRoll := rng.Float64()
	brightnessJitterRoll := rng.Float64()
	contrastJitterRoll := rng.Float64()

	bloomIntensity := round(clampFloat((baseBloomIntensity+bloomRoll*bloomIntensityRange)*moodProfile.BloomMultiplier*styleProfile.BloomMultiplier, minimumBloomIntensity, maximumBloomIntensity))

	// The style's grade is layered on the zone's before the per-world jitter,
	// so two oceans in the same zone and style still differ by the jitter and
	// never by more than it.
	baseGrade := addGrade(oceanGradesByZone[depth.Zone], styleProfile.Grade)
	grade := models.PostFXGradeConfig{
		HueRadians: round(baseGrade.HueRadians + (hueJitterRoll-0.5)*2*gradeHueJitterRange),
		Saturation: round(clampFloat(baseGrade.Saturation+(saturationJitterRoll-0.5)*2*gradeSaturationJitterRange, -1, 1)),
		Brightness: round(baseGrade.Brightness + (brightnessJitterRoll-0.5)*2*gradeBrightnessJitterRange),
		Contrast:   round(clampFloat(baseGrade.Contrast+(contrastJitterRoll-0.5)*2*gradeContrastJitterRange, 0, 1)),
	}

	// Which band the roll lands in depends on the medium the viewer is in. A
	// negative depth is above the waterline, where a low sun is the best light
	// available; under the water the same angle delivers almost nothing, because
	// it reflects off the surface instead of entering it.
	elevationFloor, elevationRange := minimumSurfaceElevation, surfaceElevationRange
	if depth.Metres < 0 {
		elevationFloor, elevationRange = minimumBreachedSurfaceElevation, breachedSurfaceElevationRange
	}

	return models.OceanLightingConfig{
		SurfaceLightColor:       depthResponse.SurfaceLightColor,
		SurfaceElevationRadians: round(elevationFloor + surfaceElevationRoll*elevationRange),
		SurfaceAzimuthRadians:   round(azimuthRoll * 2 * math.Pi),
		GodRayStrength:          depthResponse.GodRayStrength,
		CausticStrength:         depthResponse.CausticStrength,
		AmbientColor:            depthResponse.AmbientColor,
		Exposure:                round(depthResponse.BaseExposure + exposureRoll*exposureJitterRange),
	}, bloomIntensity, grade
}

// Draw order: basin radius, ridge amplitude, ridge frequency, rock count,
// sediment tuft count, camera distance. Returns the seafloor section plus the
// camera distance (which lives under camera in the envelope).
func buildSeafloorConfig(input BuildOceanConfigInput) (models.SeafloorConfig, float64) {
	rng := seed.NewPRNG(input.Seed + seafloorSeedSuffix)
	basinRoll := rng.Float64()
	ridgeAmplitudeRoll := rng.Float64()
	ridgeFrequencyRoll := rng.Float64()
	rockCount := minimumRockCount + rng.Intn(rockCountSpread)
	sedimentTuftCountDesktop := minimumSedimentTuftCount + rng.Intn(sedimentTuftCountSpread)
	cameraDistanceRoll := rng.Float64()

	config := models.SeafloorConfig{
		PlacementSeed:            input.Seed + seafloorScatterSeedSuffix,
		BasinRadius:              round(minimumBasinRadius + basinRoll*basinRadiusRange),
		RidgeAmplitude:           round(minimumRidgeAmplitude + ridgeAmplitudeRoll*ridgeAmplitudeRange),
		RidgeFrequency:           roundToThousandths(minimumRidgeFrequency + ridgeFrequencyRoll*ridgeFrequencyRange),
		RockCount:                rockCount,
		SedimentTuftCountDesktop: sedimentTuftCountDesktop,
		SedimentTuftCountMobile:  int(float64(sedimentTuftCountDesktop) * mobileSedimentTuftFraction),
	}
	cameraDistance := round(minimumCameraDistance + cameraDistanceRoll*cameraDistanceRange)
	return config, cameraDistance
}

// Draw order: current kind, intensity, direction, gust frequency, marine snow
// count. Marine snow is drawn at every depth — unlike the forest's four
// mutually exclusive seasonal particle systems, there is always something
// falling through seawater.
func buildCurrentConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) models.CurrentConfig {
	rng := seed.NewPRNG(input.Seed + currentSeedSuffix)
	kindRoll := rng.Float64()
	intensityRoll := rng.Float64()
	directionRoll := rng.Float64()
	gustFrequencyRoll := rng.Float64()
	marineSnowDraw := baseMarineSnowCount + rng.Intn(marineSnowCountSpread)

	// Sediment IS marine snow, from the viewer's side of the water: the silt
	// style is mostly this number.
	marineSnowCount := clampInt(int(float64(marineSnowDraw)*styleProfile.MarineSnowMultiplier), minimumMarineSnowCount, maximumMarineSnowCount)
	kind := currentKindForRoll(kindRoll, currentWeightsByZone[depth.Zone])
	intensity := round(clampFloat((currentIntensityBase+intensityRoll*currentIntensityRange)*moodProfile.CurrentMultiplier, minimumCurrentIntensity, maximumCurrentIntensity))
	return models.CurrentConfig{
		Kind:                   kind,
		Intensity:              intensity,
		DirectionRadians:       round(directionRoll * 2 * math.Pi),
		GustFrequency:          round(gustFrequencyBase + gustFrequencyRoll*gustFrequencyRange),
		MarineSnowCountDesktop: marineSnowCount,
		MarineSnowCountMobile:  int(float64(marineSnowCount) * mobileMarineSnowFraction),
	}
}

// Draw order: flora count, species-mix pick, scale minimum, scale maximum,
// sway strength, depth tint.
func buildFloraConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) models.FloraConfig {
	rng := seed.NewPRNG(input.Seed + floraSeedSuffix)
	floraCountDraw := baseFloraCount + rng.Intn(floraCountSpread)
	speciesMixRoll := rng.Float64()
	scaleMinimumRoll := rng.Float64()
	scaleMaximumRoll := rng.Float64()
	swayStrengthRoll := rng.Float64()
	depthTintRoll := rng.Float64()

	countDesktop := clampInt(int(float64(floraCountDraw)*styleProfile.FloraMultiplier), minimumFloraCount, maximumFloraCount)
	mixes := floraSpeciesMixesByZone[depth.Zone]
	mixIndex := int(speciesMixRoll * float64(len(mixes)))

	return models.FloraConfig{
		PlacementSeed: input.Seed + floraPlacementSeedSuffix,
		CountDesktop:  countDesktop,
		CountMobile:   int(float64(countDesktop) * mobileFloraFraction),
		SpeciesMix:    append([]models.FloraSpeciesMixEntry(nil), mixes[mixIndex]...),
		ScaleMin:      round(floraScaleMinimumBase + scaleMinimumRoll*floraScaleMinimumRange),
		ScaleMax:      round(floraScaleMaximumBase + scaleMaximumRoll*floraScaleMaximumRange),
		// Sway follows the current, so a still abyss has still kelp without
		// anything having to check the zone.
		SwayStrength:      round(clampFloat((swayStrengthBase+swayStrengthRoll*swayStrengthRange)*moodProfile.CurrentMultiplier, minimumSwayStrength, maximumSwayStrength)),
		DepthTintStrength: round(floraDepthTintBaseByZone[depth.Zone] + depthTintRoll*floraDepthTintRange),
	}
}

// schoolSlotDraw / drifterSlotDraw hold one slot's raw draws. Every slot is
// always drawn (fixed PRNG consumption); the zone/mood-scaled active count only
// gates how many drawn slots become config entries.
type schoolSlotDraw struct {
	speciesRoll    float64
	countDraw      int
	speedRoll      float64
	bandBaseRoll   float64
	bandSpanRoll   float64
	cohesionRoll   float64
	separationRoll float64
}

type drifterSlotDraw struct {
	speciesRoll float64
	countDraw   int
	pulseRoll   float64
	colorRoll   float64
}

// Draw order: 3 school slots x (species, count, speed, band base, band span,
// cohesion, separation), then 2 drifter slots x (species, count, pulse,
// colour), then the giant's 4 draws — presence, species, approach, duration —
// which happen whether or not a giant appears.
func buildFaunaConfig(input BuildOceanConfigInput, depth models.DepthConfig, water models.WaterConfig, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) models.FaunaConfig {
	rng := seed.NewPRNG(input.Seed + faunaSeedSuffix)
	schoolDraws := [maximumSchoolSlots]schoolSlotDraw{}
	for slot := range schoolDraws {
		schoolDraws[slot] = schoolSlotDraw{
			speciesRoll:    rng.Float64(),
			countDraw:      rng.Intn(schoolCountSpread),
			speedRoll:      rng.Float64(),
			bandBaseRoll:   rng.Float64(),
			bandSpanRoll:   rng.Float64(),
			cohesionRoll:   rng.Float64(),
			separationRoll: rng.Float64(),
		}
	}
	drifterDraws := [maximumDrifterSlots]drifterSlotDraw{}
	for slot := range drifterDraws {
		drifterDraws[slot] = drifterSlotDraw{
			speciesRoll: rng.Float64(),
			countDraw:   rng.Intn(drifterCountSpread),
			pulseRoll:   rng.Float64(),
			colorRoll:   rng.Float64(),
		}
	}
	giantPresenceRoll := rng.Float64()
	giantSpeciesRoll := rng.Float64()
	giantApproachRoll := rng.Float64()
	giantDurationRoll := rng.Float64()

	faunaMultiplier := moodProfile.FaunaMultiplier * styleProfile.FaunaMultiplier
	activeSchoolSlots := clampInt(int(math.Round(baseSchoolSlotsByZone[depth.Zone]*faunaMultiplier)), 0, maximumSchoolSlots)
	activeDrifterSlots := clampInt(int(math.Round(baseDrifterSlotsByZone[depth.Zone]*faunaMultiplier)), 0, maximumDrifterSlots)

	fishSpecies := fishSpeciesByZone[depth.Zone]
	usedFishSpecies := map[string]bool{}
	schools := make([]models.FishSchoolConfig, 0, activeSchoolSlots)
	for slot := 0; slot < activeSchoolSlots; slot++ {
		draw := schoolDraws[slot]
		speciesIndex := int(draw.speciesRoll * float64(len(fishSpecies)))
		// Deterministic dedupe walk: step forward until an unused species is
		// found; after the list is exhausted repeats are allowed.
		for attempt := 0; attempt < len(fishSpecies) && usedFishSpecies[fishSpecies[speciesIndex]]; attempt++ {
			speciesIndex = (speciesIndex + 1) % len(fishSpecies)
		}
		speciesKey := fishSpecies[speciesIndex]
		usedFishSpecies[speciesKey] = true
		bandMinimum := round(schoolBandBase + draw.bandBaseRoll*schoolBandBaseRange)
		schools = append(schools, models.FishSchoolConfig{
			ModelKey:     speciesKey,
			Count:        schoolCountBase + draw.countDraw,
			PathSeed:     fmt.Sprintf(schoolPathSeedPrefixFormat, input.Seed, slot),
			DepthBandMin: bandMinimum,
			DepthBandMax: round(bandMinimum + schoolBandSpanBase + draw.bandSpanRoll*schoolBandSpanRange),
			SwimSpeed:    round(swimSpeedBase + draw.speedRoll*swimSpeedRange),
			Cohesion:     round(cohesionBase + draw.cohesionRoll*cohesionRange),
			Separation:   round(separationBase + draw.separationRoll*separationRange),
		})
	}

	drifterSpecies := drifterSpeciesByZone[depth.Zone]
	emissiveColors := bioluminescenceColorsByZone[depth.Zone]
	drifters := make([]models.DrifterConfig, 0, activeDrifterSlots)
	for slot := 0; slot < activeDrifterSlots; slot++ {
		draw := drifterDraws[slot]
		speciesIndex := int(draw.speciesRoll * float64(len(drifterSpecies)))
		colorIndex := int(draw.colorRoll * float64(len(emissiveColors)))
		drifters = append(drifters, models.DrifterConfig{
			ModelKey:      drifterSpecies[speciesIndex],
			Count:         drifterCountBase + draw.countDraw,
			PathSeed:      fmt.Sprintf(drifterPathSeedPrefixFormat, input.Seed, slot),
			PulseRate:     round(pulseRateBase + draw.pulseRoll*pulseRateRange),
			EmissiveColor: emissiveColors[colorIndex],
		})
	}

	// At most one giant, and only when the zone's own probability is met.
	giants := make([]models.GiantConfig, 0, 1)
	if giantPresenceRoll < giantProbabilityByZone[depth.Zone] {
		giantSpecies := giantSpeciesByZone[depth.Zone]
		speciesIndex := int(giantSpeciesRoll * float64(len(giantSpecies)))
		giants = append(giants, models.GiantConfig{
			ModelKey: giantSpecies[speciesIndex],
			PassSeed: fmt.Sprintf(giantPassSeedPrefixFormat, input.Seed, 0),
			// Anchored to the water's own visibility rather than to a fixed
			// number, so a giant is always a silhouette at the edge of what can
			// be seen — near the surface that is far away, in the abyss it is
			// uncomfortably close.
			ApproachDistance:    round(water.VisibilityMetres * (giantApproachFraction + giantApproachRoll*giantApproachFractionRange)),
			PassDurationSeconds: round(giantPassDurationBase + giantDurationRoll*giantPassDurationRange),
		})
	}

	return models.FaunaConfig{Schools: schools, Drifters: drifters, Giants: giants}
}

// Draw order: plankton count, bloom intensity. Both are always drawn; the zone
// tables decide how much of it there is.
func buildBioluminescenceConfig(input BuildOceanConfigInput, depth models.DepthConfig, moodProfile oceanMoodProfile, styleProfile oceanStyleProfile) models.BioluminescenceConfig {
	rng := seed.NewPRNG(input.Seed + bioluminescenceSeedSuffix)
	planktonDraw := basePlanktonCountByZone[depth.Zone] + rng.Intn(planktonCountSpreadByZone[depth.Zone])
	bloomRoll := rng.Float64()

	return models.BioluminescenceConfig{
		PlanktonCount: planktonDraw,
		// This brightens light that is already in the scene; it is never what
		// makes it visible. An abyssal world has to read with post-processing
		// switched off.
		BloomIntensity: round(clampFloat((bioluminescenceBloomBase+bloomRoll*bioluminescenceBloomRange)*moodProfile.BloomMultiplier*styleProfile.BloomMultiplier, 0, 1)),
		EmissiveColors: append([]string(nil), bioluminescenceColorsByZone[depth.Zone]...),
		FlickerSeed:    input.Seed + bioluminescenceFlickerSuffix,
	}
}

// Draw order per landmark (DNA order): kind roll, angle jitter, radius, how
// deep it settled. The first landmark is always the kelp cathedral; accent
// colours cycle secondary/accent/primary exactly like universe planets and
// forest landmarks, so the palette reads the same across all three portraits.
func buildLandmarkConfigs(input BuildOceanConfigInput, cameraDistance float64, primary, secondary string) []models.LandmarkSceneConfig {
	rng := seed.NewPRNG(input.Seed + landmarksSeedSuffix)
	landmarkCount := len(input.DNA.Landmarks)
	landmarks := make([]models.LandmarkSceneConfig, 0, landmarkCount)
	usedKinds := map[string]bool{}
	for index, dnaLandmark := range input.DNA.Landmarks {
		kindRoll := rng.Float64()
		angleJitterRoll := rng.Float64()
		radiusRoll := rng.Float64()
		bedDepthRoll := rng.Float64()

		kind := LandmarkKelpCathedral
		if index > 0 {
			kindIndex := int(kindRoll * float64(len(nonHeroLandmarkKinds)))
			for attempt := 0; attempt < len(nonHeroLandmarkKinds) && usedKinds[nonHeroLandmarkKinds[kindIndex]]; attempt++ {
				kindIndex = (kindIndex + 1) % len(nonHeroLandmarkKinds)
			}
			kind = nonHeroLandmarkKinds[kindIndex]
		}
		usedKinds[kind] = true

		accentColor := secondary
		if index%3 == 1 {
			accentColor = paletteAccentColor
		} else if index%3 == 2 {
			accentColor = primary
		}

		baseAngle := (2 * math.Pi / float64(landmarkCount)) * float64(index)
		landmarks = append(landmarks, models.LandmarkSceneConfig{
			Key:              dnaLandmark.Key,
			Name:             dnaLandmark.Name,
			Meaning:          dnaLandmark.Meaning,
			Kind:             kind,
			AngleRadians:     round(baseAngle + (angleJitterRoll-0.5)*2*landmarkAngleJitterRadians),
			RadiusFromCenter: round(cameraDistance + landmarkCameraStandoffMetres + radiusRoll*landmarkRingDepthMetres),
			// Negative: every kind is a bottom feature, so the offset is how
			// deep it beds into the sediment. See landmarkBedDepthMetresByKind.
			HeightAboveFloor: round(-(landmarkBedDepthMetresByKind[kind] + bedDepthRoll*landmarkBedDepthJitterMetres)),
			AccentColor:      accentColor,
			Energy:           dnaLandmark.Energy,
		})
	}
	return landmarks
}

// buildAssetsConfig collects every model key the config references, in a
// deterministic first-use order, so the renderer can prepare them without
// scanning the whole config. There is no hdriKey: this family has no sky.
func buildAssetsConfig(flora models.FloraConfig, fauna models.FaunaConfig, landmarks []models.LandmarkSceneConfig) models.OceanAssetsConfig {
	seenKeys := map[string]bool{}
	modelKeys := make([]string, 0, 16)
	appendKey := func(key string) {
		if key == "" || seenKeys[key] {
			return
		}
		seenKeys[key] = true
		modelKeys = append(modelKeys, key)
	}
	for _, entry := range flora.SpeciesMix {
		appendKey(entry.ModelKey)
	}
	appendKey(ModelKeyRockBasalt)
	for _, school := range fauna.Schools {
		appendKey(school.ModelKey)
	}
	for _, drifter := range fauna.Drifters {
		appendKey(drifter.ModelKey)
	}
	for _, giant := range fauna.Giants {
		appendKey(giant.ModelKey)
	}
	for _, landmark := range landmarks {
		appendKey(landmarkModelKeysByKind[landmark.Kind])
	}
	return models.OceanAssetsConfig{
		CatalogVersion: assetCatalogVersion,
		ModelKeys:      modelKeys,
	}
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}

// roundToThousandths keeps three decimals for values whose whole dynamic range
// sits below 0.1 (fog density, ridge frequency) — two decimals would quantize
// them into a handful of visible steps.
func roundToThousandths(value float64) float64 {
	return math.Round(value*1000) / 1000
}
