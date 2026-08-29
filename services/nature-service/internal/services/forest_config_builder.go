package services

import (
	"fmt"
	"math"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/seed"
)

// Renderers are keyed by (sceneType, schemaVersion); any byte-level change to
// what this builder emits for an existing seed is a breaking change and must
// bump the schema version.
const (
	// 1.1 (2026-07-18): wider ground-animal species pools (stag, bear,
	// squirrel). 1.2 (2026-07-18): more ground-animal slots (3→5) and
	// individuals per slot (1-2→1-3), plus a lower/wider bird altitude band
	// for high+low tiers. Both shifted the draws for existing seeds → version
	// bump + deliberate golden regeneration.
	forestSchemaVersion = "1.2"
	forestSceneType     = "forest"
)

// Every section draws from its own seed-derived PRNG stream, in a fixed draw
// order, and ALL draws always happen even when a gate zeroes the feature —
// so adding features later never shifts existing draws (the same discipline
// universe-service established in its schema 1.1/1.2 rounds). Labels are
// prefixed "-forest-" so future families inside nature-service (mountain,
// lake) can never collide with these streams.
const (
	seasonSeedSuffix    = "-forest-season"
	lightingSeedSuffix  = "-forest-lighting"
	terrainSeedSuffix   = "-forest-terrain"
	treesSeedSuffix     = "-forest-trees"
	weatherSeedSuffix   = "-forest-weather"
	wildlifeSeedSuffix  = "-forest-wildlife"
	ambientSeedSuffix   = "-forest-ambient"
	landmarksSeedSuffix = "-forest-landmarks"
)

// Frontend-side scatter stream labels. The backend never draws from these; it
// stores them in the config so the future ForestRenderer derives placements
// and paths deterministically (the MilkyWayConfig.Seed pattern).
const (
	terrainScatterSeedSuffix   = "-forest-terrain-scatter"
	treePlacementSeedSuffix    = "-forest-tree-placement"
	animalPathSeedPrefixFormat = "%s-forest-animal-%d"
	birdPathSeedPrefixFormat   = "%s-forest-birds-%d"
)

// Default palette anchors, identical to universe-service so a user's favorite
// colors read the same across both portraits.
const (
	defaultPrimaryColor   = "#8B5CF6"
	defaultSecondaryColor = "#06B6D4"
	paletteAccentColor    = "#FACC15"
)

type ForestConfigBuilder struct{}

func NewForestConfigBuilder() *ForestConfigBuilder {
	return &ForestConfigBuilder{}
}

type BuildForestConfigInput struct {
	DNA       models.NatureDNA
	Seed      string
	VariantNo int
	Input     models.VisualIntent
}

func (b *ForestConfigBuilder) Build(input BuildForestConfigInput) models.ForestSceneConfig {
	moodProfile := forestProfileForMood(input.Input.Mood)
	// An unknown or absent style resolves to the neutral profile, which is a
	// no-op in every one of its fields — so a forest stored before this family
	// had styles builds exactly as it always did. See forest_style_profile.go.
	styleProfile := forestProfileForStyle(input.Input.PreferredWorldStyle)
	primary := defaultPrimaryColor
	secondary := defaultSecondaryColor
	if len(input.Input.FavoriteColors) > 0 {
		primary = input.Input.FavoriteColors[0]
	}
	if len(input.Input.FavoriteColors) > 1 {
		secondary = input.Input.FavoriteColors[1]
	}

	season := buildSeasonConfig(input, moodProfile)
	lighting, bloomIntensity := buildLightingConfig(input, season, moodProfile, styleProfile)
	terrain, cameraDistance := buildTerrainConfig(input)
	trees := buildTreesConfig(input, season, moodProfile, styleProfile)
	weather := buildWeatherConfig(input, season)
	wildlife := buildWildlifeConfig(input, season, moodProfile)
	ambientParticles := buildAmbientParticlesConfig(input, season, lighting)
	landmarks := buildLandmarkConfigs(input, terrain.ClearingRadius, primary, secondary)

	return models.ForestSceneConfig{
		SchemaVersion: forestSchemaVersion,
		SceneType:     forestSceneType,
		SceneName:     input.DNA.SceneName,
		Archetype:     input.DNA.Archetype,
		Quote:         input.DNA.Quote,
		Theme:         input.DNA.VisualHints.Theme,
		Palette: models.Palette{
			Background: backgroundColorsBySeason[season.Kind],
			Primary:    primary,
			Secondary:  secondary,
			Accent:     paletteAccentColor,
			Gradient:   []string{primary, secondary, paletteAccentColor},
		},
		Season:           season,
		Lighting:         lighting,
		Terrain:          terrain,
		Trees:            trees,
		Weather:          weather,
		Wildlife:         wildlife,
		AmbientParticles: ambientParticles,
		Landmarks:        landmarks,
		Camera:           models.CameraConfig{Distance: cameraDistance, FOV: forestCameraFOV},
		PostFX: models.PostFXConfig{
			BloomIntensity: bloomIntensity,
			// The grade is a per-season table lookup plus the style's offset
			// (no PRNG draw), so two forests in the same season and style
			// always grade identically.
			Grade: addGrade(forestGradesBySeason[season.Kind], styleProfile.Grade),
		},
		HUD:    models.HUDConfig{ShowTraitBars: true, ShowLabels: true},
		Assets: buildAssetsConfig(lighting, trees, wildlife, landmarks),
	}
}

// Draw order: season roll, transition roll, transition direction, blend
// amount, foliage palette pick. The transition draws happen even for
// non-transition worlds so the foliage pick never shifts.
func buildSeasonConfig(input BuildForestConfigInput, moodProfile forestMoodProfile) models.SeasonConfig {
	rng := seed.NewPRNG(input.Seed + seasonSeedSuffix)
	seasonRoll := rng.Float64()
	transitionRoll := rng.Float64()
	transitionDirectionRoll := rng.Float64()
	blendAmountRoll := rng.Float64()
	foliagePaletteRoll := rng.Float64()

	kind := seasonForRoll(seasonRoll, moodProfile.SeasonWeights)
	config := models.SeasonConfig{
		Kind:       kind,
		GroundKind: groundKindsBySeason[kind],
	}
	if transitionRoll < transitionProbability {
		config.BlendTowardKind = adjacentSeason(kind, transitionDirectionRoll)
		config.BlendAmount = round(minimumSeasonBlendAmount + blendAmountRoll*seasonBlendAmountRange)
	}
	palettes := foliagePalettesBySeason[kind]
	paletteIndex := int(foliagePaletteRoll * float64(len(palettes)))
	config.FoliageColors = append([]string(nil), palettes[paletteIndex]...)
	return config
}

// Draw order: time-of-day roll, sun elevation, sun azimuth, exposure, fog
// roll, fog density, bloom. Fog density is drawn even when the fog gate
// misses. Returns the lighting section plus the bloom intensity (which lives
// under postFX in the envelope).
func buildLightingConfig(input BuildForestConfigInput, season models.SeasonConfig, moodProfile forestMoodProfile, styleProfile forestStyleProfile) (models.LightingConfig, float64) {
	rng := seed.NewPRNG(input.Seed + lightingSeedSuffix)
	timeOfDayRoll := rng.Float64()
	sunElevationRoll := rng.Float64()
	sunAzimuthRoll := rng.Float64()
	exposureRoll := rng.Float64()
	fogRoll := rng.Float64()
	fogDensityRoll := rng.Float64()
	bloomRoll := rng.Float64()

	timeOfDay := timeOfDayForRoll(timeOfDayRoll, styleProfile.TimeOfDayWeights)
	elevationBounds := sunElevationBoundsByTimeOfDay[timeOfDay]
	fogDensity := 0.0
	// The style biases the season's own probability rather than replacing it,
	// so autumn stays foggier than summer under Mistwood as well as under
	// Wildwood.
	fogProbability := clampFloat(fogProbabilityBySeason[season.Kind]+styleProfile.FogProbabilityBias, minimumFogProbability, maximumFogProbability)
	if fogRoll < fogProbability {
		fogDensity = roundToThousandths(minimumFogDensity + fogDensityRoll*fogDensityRange)
	}
	bloomIntensity := round(clampFloat((baseBloomIntensity+bloomRoll*bloomIntensityRange)*moodProfile.BloomMultiplier*styleProfile.BloomMultiplier, minimumBloomIntensity, maximumBloomIntensity))

	return models.LightingConfig{
		TimeOfDay:           timeOfDay,
		SunElevationRadians: round(elevationBounds.Minimum + sunElevationRoll*(elevationBounds.Maximum-elevationBounds.Minimum)),
		SunAzimuthRadians:   round(sunAzimuthRoll * 2 * math.Pi),
		SunColor:            sunColorsByTimeOfDay[timeOfDay],
		AmbientColor:        ambientColorsByTimeOfDay[timeOfDay],
		HdriKey:             hdriKeysByTimeOfDay[timeOfDay],
		Exposure:            round(minimumSunExposure + exposureRoll*sunExposureRange),
		FogColor:            fogColorsBySeason[season.Kind],
		FogDensity:          fogDensity,
	}, bloomIntensity
}

// Draw order: clearing radius, hill amplitude, hill frequency, rock count,
// grass count, path roll, camera distance. Returns the terrain section plus
// the camera distance (which lives under camera in the envelope).
func buildTerrainConfig(input BuildForestConfigInput) (models.TerrainConfig, float64) {
	rng := seed.NewPRNG(input.Seed + terrainSeedSuffix)
	clearingRoll := rng.Float64()
	hillAmplitudeRoll := rng.Float64()
	hillFrequencyRoll := rng.Float64()
	rockCount := minimumRockCount + rng.Intn(rockCountSpread)
	grassTuftCountDesktop := minimumGrassTuftCount + rng.Intn(grassTuftCountSpread)
	pathRoll := rng.Float64()
	cameraDistanceRoll := rng.Float64()

	clearingRadius := round(minimumClearingRadius + clearingRoll*clearingRadiusRange)
	config := models.TerrainConfig{
		PlacementSeed:         input.Seed + terrainScatterSeedSuffix,
		ClearingRadius:        clearingRadius,
		TreelineRadius:        round(clearingRadius * treelineRadiusMultiplier),
		HillAmplitude:         round(minimumHillAmplitude + hillAmplitudeRoll*hillAmplitudeRange),
		HillFrequency:         roundToThousandths(minimumHillFrequency + hillFrequencyRoll*hillFrequencyRange),
		PathEnabled:           pathRoll < pathProbability,
		RockCount:             rockCount,
		GrassTuftCountDesktop: grassTuftCountDesktop,
		GrassTuftCountMobile:  int(float64(grassTuftCountDesktop) * mobileGrassTuftFraction),
	}
	cameraDistance := round(minimumCameraDistance + cameraDistanceRoll*cameraDistanceRange)
	return config, cameraDistance
}

// Draw order: tree count, species-mix pick, scale minimum, scale maximum,
// tint strength, wind strength, wind direction, gust frequency.
func buildTreesConfig(input BuildForestConfigInput, season models.SeasonConfig, moodProfile forestMoodProfile, styleProfile forestStyleProfile) models.TreesConfig {
	rng := seed.NewPRNG(input.Seed + treesSeedSuffix)
	treeCountDraw := baseTreeCount + rng.Intn(treeCountSpread)
	speciesMixRoll := rng.Float64()
	scaleMinimumRoll := rng.Float64()
	scaleMaximumRoll := rng.Float64()
	tintStrengthRoll := rng.Float64()
	windStrengthRoll := rng.Float64()
	windDirectionRoll := rng.Float64()
	gustFrequencyRoll := rng.Float64()

	countDesktop := clampInt(int(float64(treeCountDraw)*treeCountMultipliersBySeason[season.Kind]*styleProfile.TreeCountMultiplier), minimumTreeCount, maximumTreeCount)
	mixes := treeSpeciesMixesBySeason[season.Kind]
	mixIndex := int(speciesMixRoll * float64(len(mixes)))

	return models.TreesConfig{
		PlacementSeed: input.Seed + treePlacementSeedSuffix,
		CountDesktop:  countDesktop,
		CountMobile:   int(float64(countDesktop) * mobileTreeFraction),
		SpeciesMix:    append([]models.TreeSpeciesMixEntry(nil), mixes[mixIndex]...),
		// Both ends scale together, so a style changes how big the trees are
		// without changing how VARIED they are — an ancient grove is uniformly
		// enormous, not enormous-to-tiny.
		ScaleMin:             round((treeScaleMinimumBase + scaleMinimumRoll*treeScaleMinimumRange) * styleProfile.TreeScaleMultiplier),
		ScaleMax:             round((treeScaleMaximumBase + scaleMaximumRoll*treeScaleMaximumRange) * styleProfile.TreeScaleMultiplier),
		FoliageTintStrength:  round(foliageTintStrengthBase + tintStrengthRoll*foliageTintStrengthRange),
		WindStrength:         round(clampFloat((windStrengthBase+windStrengthRoll*windStrengthRange)*moodProfile.WindMultiplier, minimumWindStrength, maximumWindStrength)),
		WindDirectionRadians: round(windDirectionRoll * 2 * math.Pi),
		WindGustFrequency:    round(windGustFrequencyBase + gustFrequencyRoll*windGustFrequencyRange),
	}
}

// Draw order: weather kind roll, intensity, cloud coverage. Rain/snow particle
// counts derive from intensity (no extra draws) and stay zero unless the kind
// matches.
func buildWeatherConfig(input BuildForestConfigInput, season models.SeasonConfig) models.WeatherConfig {
	rng := seed.NewPRNG(input.Seed + weatherSeedSuffix)
	kindRoll := rng.Float64()
	intensityRoll := rng.Float64()
	cloudCoverageRoll := rng.Float64()

	kind := weatherKindForRoll(kindRoll, weatherWeightsBySeason[season.Kind])
	intensity := round(weatherIntensityBase + intensityRoll*weatherIntensityRange)
	cloudBounds := cloudCoverageBoundsByWeatherKind[kind]
	config := models.WeatherConfig{
		Kind:          kind,
		Intensity:     intensity,
		CloudCoverage: round(cloudBounds.Minimum + cloudCoverageRoll*(cloudBounds.Maximum-cloudBounds.Minimum)),
	}
	if kind == WeatherRain {
		desktopDropCount := int(baseRainDropCount + intensity*rainDropCountRange)
		config.RainDropCountDesktop = desktopDropCount
		config.RainDropCountMobile = int(float64(desktopDropCount) * mobileRainFraction)
	}
	if kind == WeatherSnow {
		desktopFlakeCount := int(baseSnowflakeCount + intensity*snowflakeCountRange)
		config.SnowflakeCountDesktop = desktopFlakeCount
		config.SnowflakeCountMobile = int(float64(desktopFlakeCount) * mobileSnowFraction)
	}
	return config
}

// groundAnimalSlotDraw / birdFlockSlotDraw hold one slot's raw draws. Every
// slot is always drawn (fixed PRNG consumption); the season/mood-scaled
// active count only gates how many drawn slots become config entries.
type groundAnimalSlotDraw struct {
	speciesRoll float64
	countDraw   int
	speedRoll   float64
	scaleRoll   float64
}

type birdFlockSlotDraw struct {
	birdCountDraw    int
	altitudeBaseRoll float64
	altitudeSpanRoll float64
	speedRoll        float64
	patternRoll      float64
}

// Draw order: 3 ground slots × (species, count, speed, scale), then 2 flock
// slots × (bird count, altitude base, altitude span, speed, pattern).
func buildWildlifeConfig(input BuildForestConfigInput, season models.SeasonConfig, moodProfile forestMoodProfile) models.WildlifeConfig {
	rng := seed.NewPRNG(input.Seed + wildlifeSeedSuffix)
	groundDraws := [maximumGroundAnimalSlots]groundAnimalSlotDraw{}
	for slot := range groundDraws {
		groundDraws[slot] = groundAnimalSlotDraw{
			speciesRoll: rng.Float64(),
			countDraw:   rng.Intn(groundAnimalCountSpread),
			speedRoll:   rng.Float64(),
			scaleRoll:   rng.Float64(),
		}
	}
	flockDraws := [maximumBirdFlockSlots]birdFlockSlotDraw{}
	for slot := range flockDraws {
		flockDraws[slot] = birdFlockSlotDraw{
			birdCountDraw:    rng.Intn(birdsPerFlockSpread),
			altitudeBaseRoll: rng.Float64(),
			altitudeSpanRoll: rng.Float64(),
			speedRoll:        rng.Float64(),
			patternRoll:      rng.Float64(),
		}
	}

	activeGroundSlots := clampInt(int(math.Round(baseGroundAnimalSlotsBySeason[season.Kind]*moodProfile.WildlifeMultiplier)), 0, maximumGroundAnimalSlots)
	activeFlockSlots := clampInt(int(math.Round(baseBirdFlocksBySeason[season.Kind]*moodProfile.WildlifeMultiplier)), 0, maximumBirdFlockSlots)

	speciesForSeason := groundAnimalSpeciesBySeason[season.Kind]
	usedSpecies := map[string]bool{}
	groundAnimals := make([]models.GroundAnimalConfig, 0, activeGroundSlots)
	for slot := 0; slot < activeGroundSlots; slot++ {
		draw := groundDraws[slot]
		speciesIndex := int(draw.speciesRoll * float64(len(speciesForSeason)))
		// Deterministic dedupe walk: step forward until an unused species is
		// found; after the list is exhausted repeats are allowed.
		for attempt := 0; attempt < len(speciesForSeason) && usedSpecies[speciesForSeason[speciesIndex]]; attempt++ {
			speciesIndex = (speciesIndex + 1) % len(speciesForSeason)
		}
		speciesKey := speciesForSeason[speciesIndex]
		usedSpecies[speciesKey] = true
		groundAnimals = append(groundAnimals, models.GroundAnimalConfig{
			ModelKey:  speciesKey,
			Count:     groundAnimalCountBase + draw.countDraw,
			PathSeed:  fmt.Sprintf(animalPathSeedPrefixFormat, input.Seed, slot),
			WalkSpeed: round(walkSpeedBase + draw.speedRoll*walkSpeedRange),
			Scale:     round(animalScaleBase + draw.scaleRoll*animalScaleRange),
		})
	}

	birdFlocks := make([]models.BirdFlockConfig, 0, activeFlockSlots)
	for slot := 0; slot < activeFlockSlots; slot++ {
		draw := flockDraws[slot]
		altitudeMin := round(birdAltitudeBase + draw.altitudeBaseRoll*birdAltitudeBaseRange)
		pattern := BirdPatternCrossing
		if draw.patternRoll < circlingPatternProbability {
			pattern = BirdPatternCircling
		}
		birdFlocks = append(birdFlocks, models.BirdFlockConfig{
			ModelKey:    ModelKeyBirdForest,
			BirdCount:   birdsPerFlockBase + draw.birdCountDraw,
			PathSeed:    fmt.Sprintf(birdPathSeedPrefixFormat, input.Seed, slot),
			AltitudeMin: altitudeMin,
			AltitudeMax: round(altitudeMin + birdAltitudeSpanBase + draw.altitudeSpanRoll*birdAltitudeSpanRange),
			FlightSpeed: round(flightSpeedBase + draw.speedRoll*flightSpeedRange),
			Pattern:     pattern,
		})
	}

	return models.WildlifeConfig{GroundAnimals: groundAnimals, BirdFlocks: birdFlocks}
}

// Draw order: leaf count, petal count, firefly count, snow-dust count — all
// four always drawn; the season (and dusk, for fireflies) gates which one
// lands in the config.
func buildAmbientParticlesConfig(input BuildForestConfigInput, season models.SeasonConfig, lighting models.LightingConfig) models.AmbientParticlesConfig {
	rng := seed.NewPRNG(input.Seed + ambientSeedSuffix)
	fallingLeafDraw := baseFallingLeafCount + rng.Intn(fallingLeafCountSpread)
	blossomPetalDraw := baseBlossomPetalCount + rng.Intn(blossomPetalCountSpread)
	fireflyDraw := baseFireflyCount + rng.Intn(fireflyCountSpread)
	snowDustDraw := baseSnowDustCount + rng.Intn(snowDustCountSpread)

	config := models.AmbientParticlesConfig{}
	switch season.Kind {
	case SeasonAutumn:
		config.FallingLeafCount = fallingLeafDraw
	case SeasonSpring:
		config.BlossomPetalCount = blossomPetalDraw
	case SeasonSummer:
		if lighting.TimeOfDay == TimeOfDayDusk {
			config.FireflyCount = fireflyDraw
		}
	case SeasonWinter:
		config.SnowDustCount = snowDustDraw
	}
	return config
}

// Draw order per landmark (DNA order): kind roll, angle jitter, radius. The
// first landmark is always the heart tree; accent colors cycle
// secondary/accent/primary exactly like universe planets so the palette reads
// the same across both portraits.
func buildLandmarkConfigs(input BuildForestConfigInput, clearingRadius float64, primary, secondary string) []models.LandmarkSceneConfig {
	rng := seed.NewPRNG(input.Seed + landmarksSeedSuffix)
	landmarkCount := len(input.DNA.Landmarks)
	landmarks := make([]models.LandmarkSceneConfig, 0, landmarkCount)
	usedKinds := map[string]bool{}
	for index, dnaLandmark := range input.DNA.Landmarks {
		kindRoll := rng.Float64()
		angleJitterRoll := rng.Float64()
		radiusRoll := rng.Float64()

		kind := LandmarkHeartTree
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
			RadiusFromCenter: round(clearingRadius * (landmarkRadiusFractionBase + radiusRoll*landmarkRadiusFractionRange)),
			AccentColor:      accentColor,
			Energy:           dnaLandmark.Energy,
		})
	}
	return landmarks
}

// buildAssetsConfig collects every model key the config references, in a
// deterministic first-use order, so the renderer can preload without scanning
// the whole config.
func buildAssetsConfig(lighting models.LightingConfig, trees models.TreesConfig, wildlife models.WildlifeConfig, landmarks []models.LandmarkSceneConfig) models.AssetsConfig {
	seenKeys := map[string]bool{}
	modelKeys := make([]string, 0, 16)
	appendKey := func(key string) {
		if key == "" || seenKeys[key] {
			return
		}
		seenKeys[key] = true
		modelKeys = append(modelKeys, key)
	}
	for _, entry := range trees.SpeciesMix {
		appendKey(entry.ModelKey)
	}
	appendKey(ModelKeyRockMossy)
	for _, animal := range wildlife.GroundAnimals {
		appendKey(animal.ModelKey)
	}
	for _, flock := range wildlife.BirdFlocks {
		appendKey(flock.ModelKey)
	}
	for _, landmark := range landmarks {
		appendKey(landmarkModelKeysByKind[landmark.Kind])
	}
	return models.AssetsConfig{
		CatalogVersion: assetCatalogVersion,
		ModelKeys:      modelKeys,
		HdriKey:        lighting.HdriKey,
	}
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}

// roundToThousandths keeps three decimals for values whose whole dynamic range
// sits below 0.1 (fog density, hill frequency) — two decimals would quantize
// them into a handful of visible steps.
func roundToThousandths(value float64) float64 {
	return math.Round(value*1000) / 1000
}
