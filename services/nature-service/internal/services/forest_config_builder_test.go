package services

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

func buildTestNatureDNA(landmarkCount int) models.NatureDNA {
	landmarks := make([]models.DNALandmark, 0, landmarkCount)
	for index := 0; index < landmarkCount; index++ {
		landmarks = append(landmarks, models.DNALandmark{
			Key:     fmt.Sprintf("landmark-%d", index+1),
			Name:    fmt.Sprintf("Landmark %d", index+1),
			Type:    "Interest Landmark",
			Meaning: "A meaningful place in the forest.",
			Energy:  60 + index*5,
		})
	}
	return models.NatureDNA{
		SchemaVersion:   "1.0",
		Archetype:       "Grove Keeper",
		SceneName:       "The Amberfall Sanctuary",
		Quote:           "I tend what matters and let the rest fall.",
		ShortNarrative:  "A thoughtful caretaker who finds depth in slow seasons.",
		TraitScores:     models.TraitScores{Creativity: 80, Discipline: 80, Curiosity: 80, Energy: 80, Focus: 80},
		EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 75},
		Landmarks:       landmarks,
		VisualHints:     models.VisualHints{Theme: "aurora", CoreSymbol: "lantern", PaletteIntent: "calm", MotionIntent: "slow"},
	}
}

func buildTestInput(seedValue, mood string, landmarkCount int) BuildForestConfigInput {
	return BuildForestConfigInput{
		DNA:       buildTestNatureDNA(landmarkCount),
		Seed:      seedValue,
		VariantNo: 1,
		Input: models.VisualIntent{
			Mood:                mood,
			FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
			PreferredWorldStyle: "aurora",
		},
	}
}

func TestBuildForestConfigDeterministic(t *testing.T) {
	builder := NewForestConfigBuilder()
	input := buildTestInput("NAT-DETERMINISM", "reflective", 5)
	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input must build identical configs")
	}
	if first.SchemaVersion != forestSchemaVersion {
		t.Fatalf("schemaVersion = %q, want %q", first.SchemaVersion, forestSchemaVersion)
	}
	if first.SceneType != forestSceneType {
		t.Fatalf("sceneType = %q, want %q", first.SceneType, forestSceneType)
	}
	if len(first.Landmarks) != 5 {
		t.Fatalf("landmarks = %d, want one per DNA landmark (5)", len(first.Landmarks))
	}
	if first.Assets.CatalogVersion != assetCatalogVersion {
		t.Fatalf("assets.catalogVersion = %q, want %q", first.Assets.CatalogVersion, assetCatalogVersion)
	}
}

// Each mood must bias toward its leaning season without ever hard-locking it.
func TestSeasonBiasFollowsMood(t *testing.T) {
	builder := NewForestConfigBuilder()
	leaningSeasonsByMood := map[string]string{
		"focused":    SeasonWinter,
		"dreamy":     SeasonSpring,
		"energetic":  SeasonSummer,
		"reflective": SeasonAutumn,
	}
	const sampleCount = 300
	for mood, leaningSeason := range leaningSeasonsByMood {
		seasonCounts := map[string]int{}
		for sampleIndex := 0; sampleIndex < sampleCount; sampleIndex++ {
			config := builder.Build(buildTestInput(fmt.Sprintf("NAT-BIAS-%s-%d", mood, sampleIndex), mood, 4))
			seasonCounts[config.Season.Kind]++
		}
		if seasonCounts[leaningSeason] <= sampleCount/3 {
			t.Fatalf("mood %q: leaning season %q appeared %d/%d times, want clear bias", mood, leaningSeason, seasonCounts[leaningSeason], sampleCount)
		}
		for _, otherSeason := range seasonKindsInOrder {
			if otherSeason == leaningSeason {
				continue
			}
			if seasonCounts[otherSeason] >= seasonCounts[leaningSeason] {
				t.Fatalf("mood %q: season %q (%d) should not outnumber the leaning season %q (%d)", mood, otherSeason, seasonCounts[otherSeason], leaningSeason, seasonCounts[leaningSeason])
			}
		}
		if len(seasonCounts) < 2 {
			t.Fatalf("mood %q: bias must not hard-lock a single season, got %v", mood, seasonCounts)
		}
	}
}

// The season ↔ weather matrix: snow only in winter, rain never in winter, and
// every drawn kind must come from the season's weight table.
func TestWeatherRespectsSeasonMatrix(t *testing.T) {
	builder := NewForestConfigBuilder()
	allowedKindsBySeason := map[string]map[string]bool{}
	for season, entries := range weatherWeightsBySeason {
		allowed := map[string]bool{}
		for _, entry := range entries {
			allowed[entry.Kind] = true
		}
		allowedKindsBySeason[season] = allowed
	}
	for sampleIndex := 0; sampleIndex < 300; sampleIndex++ {
		// "curious" is an accepted mood without a profile → neutral weights,
		// so all four seasons show up.
		config := builder.Build(buildTestInput(fmt.Sprintf("NAT-WEATHER-%d", sampleIndex), "curious", 4))
		if !allowedKindsBySeason[config.Season.Kind][config.Weather.Kind] {
			t.Fatalf("season %q drew disallowed weather %q", config.Season.Kind, config.Weather.Kind)
		}
		if config.Weather.Kind == WeatherSnow && config.Season.Kind != SeasonWinter {
			t.Fatalf("snow outside winter (season %q)", config.Season.Kind)
		}
		if config.Weather.Kind == WeatherRain && config.Season.Kind == SeasonWinter {
			t.Fatalf("rain in winter")
		}
		if config.Weather.Kind == WeatherRain && config.Weather.RainDropCountDesktop == 0 {
			t.Fatalf("rain weather must carry rain drop counts")
		}
		if config.Weather.Kind != WeatherRain && config.Weather.RainDropCountDesktop != 0 {
			t.Fatalf("non-rain weather must keep rain drop counts at zero")
		}
		if config.Weather.Kind == WeatherSnow && config.Weather.SnowflakeCountDesktop == 0 {
			t.Fatalf("snow weather must carry snowflake counts")
		}
	}
}

func TestNumericBoundsAcrossSeeds(t *testing.T) {
	builder := NewForestConfigBuilder()
	moods := []string{"focused", "dreamy", "energetic", "reflective", "curious"}
	for sampleIndex := 0; sampleIndex < 150; sampleIndex++ {
		mood := moods[sampleIndex%len(moods)]
		config := builder.Build(buildTestInput(fmt.Sprintf("NAT-BOUNDS-%d", sampleIndex), mood, 3+sampleIndex%5))

		assertWithin(t, "terrain.clearingRadius", config.Terrain.ClearingRadius, minimumClearingRadius, minimumClearingRadius+clearingRadiusRange)
		assertWithin(t, "terrain.hillAmplitude", config.Terrain.HillAmplitude, minimumHillAmplitude, minimumHillAmplitude+hillAmplitudeRange)
		assertWithin(t, "terrain.hillFrequency", config.Terrain.HillFrequency, minimumHillFrequency, minimumHillFrequency+hillFrequencyRange)
		if config.Terrain.RockCount < minimumRockCount || config.Terrain.RockCount >= minimumRockCount+rockCountSpread {
			t.Fatalf("rockCount %d out of bounds", config.Terrain.RockCount)
		}
		if config.Terrain.GrassTuftCountMobile >= config.Terrain.GrassTuftCountDesktop {
			t.Fatalf("mobile grass count must stay below desktop")
		}
		if config.Trees.CountDesktop < minimumTreeCount || config.Trees.CountDesktop > maximumTreeCount {
			t.Fatalf("tree count %d out of bounds", config.Trees.CountDesktop)
		}
		if config.Trees.CountMobile >= config.Trees.CountDesktop {
			t.Fatalf("mobile tree count must stay below desktop")
		}
		if config.Trees.ScaleMin >= config.Trees.ScaleMax {
			t.Fatalf("scaleMin %v must stay below scaleMax %v", config.Trees.ScaleMin, config.Trees.ScaleMax)
		}
		assertWithin(t, "trees.windStrength", config.Trees.WindStrength, minimumWindStrength, maximumWindStrength)
		assertWithin(t, "weather.intensity", config.Weather.Intensity, weatherIntensityBase, weatherIntensityBase+weatherIntensityRange)
		assertWithin(t, "weather.cloudCoverage", config.Weather.CloudCoverage, 0.0, 1.0)
		assertWithin(t, "lighting.exposure", config.Lighting.Exposure, minimumSunExposure, minimumSunExposure+sunExposureRange)
		if config.Lighting.FogDensity != 0 {
			assertWithin(t, "lighting.fogDensity", config.Lighting.FogDensity, minimumFogDensity, minimumFogDensity+fogDensityRange)
		}
		assertWithin(t, "postFX.bloomIntensity", config.PostFX.BloomIntensity, minimumBloomIntensity, maximumBloomIntensity)
		assertWithin(t, "camera.distance", config.Camera.Distance, minimumCameraDistance, minimumCameraDistance+cameraDistanceRange)
		if config.Season.BlendTowardKind != "" {
			assertWithin(t, "season.blendAmount", config.Season.BlendAmount, minimumSeasonBlendAmount, minimumSeasonBlendAmount+seasonBlendAmountRange)
		} else if config.Season.BlendAmount != 0 {
			t.Fatalf("blendAmount must be zero without a transition")
		}
		if len(config.Wildlife.GroundAnimals) > maximumGroundAnimalSlots {
			t.Fatalf("too many ground animal slots: %d", len(config.Wildlife.GroundAnimals))
		}
		if len(config.Wildlife.BirdFlocks) > maximumBirdFlockSlots {
			t.Fatalf("too many bird flocks: %d", len(config.Wildlife.BirdFlocks))
		}
		for _, animal := range config.Wildlife.GroundAnimals {
			if animal.Count < groundAnimalCountBase || animal.Count >= groundAnimalCountBase+groundAnimalCountSpread {
				t.Fatalf("animal count %d out of bounds", animal.Count)
			}
			assertWithin(t, "wildlife.walkSpeed", animal.WalkSpeed, walkSpeedBase, walkSpeedBase+walkSpeedRange)
		}
		for _, flock := range config.Wildlife.BirdFlocks {
			if flock.BirdCount < birdsPerFlockBase || flock.BirdCount >= birdsPerFlockBase+birdsPerFlockSpread {
				t.Fatalf("bird count %d out of bounds", flock.BirdCount)
			}
			if flock.AltitudeMax <= flock.AltitudeMin {
				t.Fatalf("altitudeMax must exceed altitudeMin")
			}
		}
		assertAmbientMatchesSeason(t, config)
	}
}

func assertAmbientMatchesSeason(t *testing.T, config models.ForestSceneConfig) {
	t.Helper()
	ambient := config.AmbientParticles
	nonZeroSystems := 0
	for _, count := range []int{ambient.FallingLeafCount, ambient.BlossomPetalCount, ambient.FireflyCount, ambient.SnowDustCount} {
		if count > 0 {
			nonZeroSystems++
		}
	}
	if nonZeroSystems > 1 {
		t.Fatalf("at most one ambient particle system may be active, got %+v", ambient)
	}
	switch config.Season.Kind {
	case SeasonAutumn:
		if ambient.FallingLeafCount == 0 {
			t.Fatalf("autumn must have falling leaves")
		}
	case SeasonSpring:
		if ambient.BlossomPetalCount == 0 {
			t.Fatalf("spring must have blossom petals")
		}
	case SeasonWinter:
		if ambient.SnowDustCount == 0 {
			t.Fatalf("winter must have snow dust")
		}
	case SeasonSummer:
		if ambient.FireflyCount > 0 && config.Lighting.TimeOfDay != TimeOfDayDusk {
			t.Fatalf("fireflies only appear at dusk")
		}
	}
}

func TestLandmarksPlacementAndKinds(t *testing.T) {
	builder := NewForestConfigBuilder()
	for sampleIndex := 0; sampleIndex < 60; sampleIndex++ {
		landmarkCount := 3 + sampleIndex%5
		input := buildTestInput(fmt.Sprintf("NAT-LANDMARK-%d", sampleIndex), "dreamy", landmarkCount)
		config := builder.Build(input)
		if len(config.Landmarks) != landmarkCount {
			t.Fatalf("landmark count = %d, want %d", len(config.Landmarks), landmarkCount)
		}
		if config.Landmarks[0].Kind != LandmarkHeartTree {
			t.Fatalf("first landmark must be the heart tree, got %q", config.Landmarks[0].Kind)
		}
		for index, landmark := range config.Landmarks {
			if landmark.Key != input.DNA.Landmarks[index].Key {
				t.Fatalf("landmark %d key mismatch", index)
			}
			minimumRadius := config.Terrain.ClearingRadius * landmarkRadiusFractionBase
			maximumRadius := config.Terrain.ClearingRadius * (landmarkRadiusFractionBase + landmarkRadiusFractionRange)
			if landmark.RadiusFromCenter < minimumRadius-0.01 || landmark.RadiusFromCenter > maximumRadius+0.01 {
				t.Fatalf("landmark radius %v outside [%v, %v]", landmark.RadiusFromCenter, minimumRadius, maximumRadius)
			}
			expectedAccent := config.Palette.Secondary
			if index%3 == 1 {
				expectedAccent = config.Palette.Accent
			} else if index%3 == 2 {
				expectedAccent = config.Palette.Primary
			}
			if landmark.AccentColor != expectedAccent {
				t.Fatalf("landmark %d accent %q, want %q (cycle secondary/accent/primary)", index, landmark.AccentColor, expectedAccent)
			}
		}
	}
}

// Wildlife density must scale with the mood multiplier for a fixed season —
// energetic forests are livelier than reflective ones.
func TestWildlifeScalesWithMoodMultiplier(t *testing.T) {
	season := models.SeasonConfig{Kind: SeasonSummer}
	input := buildTestInput("NAT-WILDLIFE-SCALE", "energetic", 4)
	energetic := buildWildlifeConfig(input, season, forestMoodProfiles["energetic"])
	reflective := buildWildlifeConfig(input, season, forestMoodProfiles["reflective"])
	if len(energetic.GroundAnimals) <= len(reflective.GroundAnimals) {
		t.Fatalf("energetic ground animals (%d) must exceed reflective (%d) in the same season", len(energetic.GroundAnimals), len(reflective.GroundAnimals))
	}
	if len(energetic.BirdFlocks) <= len(reflective.BirdFlocks) {
		t.Fatalf("energetic bird flocks (%d) must exceed reflective (%d) in the same season", len(energetic.BirdFlocks), len(reflective.BirdFlocks))
	}
}

// Every model key a config references must come from the profile's declared
// vocabulary — the frontend asset catalog resolves exactly these keys.
func TestModelKeysStayWithinCatalogVocabulary(t *testing.T) {
	allowedModelKeys := map[string]bool{
		ModelKeyTreeBirch:      true,
		ModelKeyTreeOak:        true,
		ModelKeyTreePine:       true,
		ModelKeyTreePineSnow:   true,
		ModelKeyTreeDead:       true,
		ModelKeyTreeBlossom:    true,
		ModelKeyAnimalDeer:     true,
		ModelKeyAnimalFox:      true,
		ModelKeyAnimalRabbit:   true,
		ModelKeyAnimalBoar:     true,
		ModelKeyAnimalWolf:     true,
		ModelKeyAnimalStag:     true,
		ModelKeyAnimalBear:     true,
		ModelKeyAnimalSquirrel: true,
		ModelKeyBirdForest:     true,
		ModelKeyRockMossy:      true,
	}
	for _, landmarkModelKey := range landmarkModelKeysByKind {
		allowedModelKeys[landmarkModelKey] = true
	}
	builder := NewForestConfigBuilder()
	for sampleIndex := 0; sampleIndex < 100; sampleIndex++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("NAT-CATALOG-%d", sampleIndex), "curious", 3+sampleIndex%5))
		for _, modelKey := range config.Assets.ModelKeys {
			if !allowedModelKeys[modelKey] {
				t.Fatalf("assets reference unknown model key %q", modelKey)
			}
		}
		seenInAssets := map[string]bool{}
		for _, modelKey := range config.Assets.ModelKeys {
			seenInAssets[modelKey] = true
		}
		for _, entry := range config.Trees.SpeciesMix {
			if !seenInAssets[entry.ModelKey] {
				t.Fatalf("tree species %q missing from assets.modelKeys", entry.ModelKey)
			}
		}
		for _, animal := range config.Wildlife.GroundAnimals {
			if !seenInAssets[animal.ModelKey] {
				t.Fatalf("animal %q missing from assets.modelKeys", animal.ModelKey)
			}
		}
		for _, landmark := range config.Landmarks {
			if !seenInAssets[landmarkModelKeysByKind[landmark.Kind]] {
				t.Fatalf("landmark kind %q model missing from assets.modelKeys", landmark.Kind)
			}
		}
	}
}

// Changing the DNA landmark count must not shift any other section: every
// section draws from its own PRNG stream.
func TestSectionStreamsAreIsolatedFromLandmarkCount(t *testing.T) {
	builder := NewForestConfigBuilder()
	threeLandmarks := builder.Build(buildTestInput("NAT-ISOLATION", "reflective", 3))
	sevenLandmarks := builder.Build(buildTestInput("NAT-ISOLATION", "reflective", 7))
	if !reflect.DeepEqual(threeLandmarks.Season, sevenLandmarks.Season) {
		t.Fatalf("season section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.Lighting, sevenLandmarks.Lighting) {
		t.Fatalf("lighting section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.Terrain, sevenLandmarks.Terrain) {
		t.Fatalf("terrain section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.Trees, sevenLandmarks.Trees) {
		t.Fatalf("trees section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.Weather, sevenLandmarks.Weather) {
		t.Fatalf("weather section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.Wildlife, sevenLandmarks.Wildlife) {
		t.Fatalf("wildlife section shifted with landmark count")
	}
	if !reflect.DeepEqual(threeLandmarks.AmbientParticles, sevenLandmarks.AmbientParticles) {
		t.Fatalf("ambient particles shifted with landmark count")
	}
}

func assertWithin(t *testing.T, name string, value, minimum, maximum float64) {
	t.Helper()
	// Half a rounding step of tolerance: stored values are rounded to 2 (or 3)
	// decimals, which can nudge them past the raw bound.
	const roundingTolerance = 0.006
	if value < minimum-roundingTolerance || value > maximum+roundingTolerance {
		t.Fatalf("%s = %v outside [%v, %v]", name, value, minimum, maximum)
	}
	if math.IsNaN(value) {
		t.Fatalf("%s is NaN", name)
	}
}

// The rare-wildlife lottery does not draw from the variant seed directly: the
// renderer seeds it off the terrain's placementSeed, which this builder
// composes. contracts.RarityCatalogue therefore hard-codes that middle segment
// so analytics-service can replay the same stream from the variant seed alone.
//
// Nothing structural connects the two — this builder could rename its suffix
// tomorrow and every test here would still pass while the admin app quietly
// started reporting rates for a stream no forest ever used. This is that
// connection.
func TestPlacementSeedMatchesTheRarityContract(t *testing.T) {
	const variantSeed = "NAT-RARITY-STREAM"
	config := NewForestConfigBuilder().Build(BuildForestConfigInput{
		DNA:       buildTestNatureDNA(3),
		Seed:      variantSeed,
		VariantNo: 1,
		Input:     models.VisualIntent{Mood: "reflective"},
	})
	expectedPlacementSeed := variantSeed + terrainScatterSeedSuffix
	if config.Terrain.PlacementSeed != expectedPlacementSeed {
		t.Fatalf("terrain placement seed = %q, want %q", config.Terrain.PlacementSeed, expectedPlacementSeed)
	}
	for _, feature := range contracts.RarityCatalogue {
		if feature.Family != contracts.WorldFamilyNature {
			continue
		}
		if !strings.HasPrefix(feature.SeedSuffix, terrainScatterSeedSuffix) {
			t.Fatalf("rarity feature %q draws from %q, which does not start with this builder's %q — analytics would replay a stream this forest never used",
				feature.Key, feature.SeedSuffix, terrainScatterSeedSuffix)
		}
	}
}
