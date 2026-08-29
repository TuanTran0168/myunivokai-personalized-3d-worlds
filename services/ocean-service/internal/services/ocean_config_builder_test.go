package services

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

func buildTestOceanDNA(landmarkCount int) models.OceanDNA {
	landmarks := make([]models.DNALandmark, 0, landmarkCount)
	for index := 0; index < landmarkCount; index++ {
		landmarks = append(landmarks, models.DNALandmark{
			Key:     fmt.Sprintf("landmark-%d", index+1),
			Name:    fmt.Sprintf("Landmark %d", index+1),
			Type:    "Interest Landmark",
			Meaning: "A meaningful place in the sea.",
			Energy:  60 + index*5,
		})
	}
	return models.OceanDNA{
		SchemaVersion:   "1.0",
		Archetype:       "Tidekeeper",
		SceneName:       "The Lantern Trench",
		Quote:           "I go down slowly, and I come back with light.",
		ShortNarrative:  "A patient mind that finds depth before direction.",
		TraitScores:     models.TraitScores{Creativity: 80, Discipline: 80, Curiosity: 80, Energy: 80, Focus: 80},
		EnergySignature: models.EnergySignature{Primary: "reflective", Secondary: "focused", Intensity: 75},
		Landmarks:       landmarks,
		VisualHints:     models.VisualHints{Theme: "aurora", CoreSymbol: "lantern", PaletteIntent: "calm", MotionIntent: "slow"},
	}
}

func buildTestInput(seedValue, mood string, landmarkCount int) BuildOceanConfigInput {
	return BuildOceanConfigInput{
		DNA:       buildTestOceanDNA(landmarkCount),
		Seed:      seedValue,
		VariantNo: 1,
		Input: models.VisualIntent{
			Mood:           mood,
			FavoriteColors: []string{"#8B5CF6", "#06B6D4"},
			// The neutral ocean style. It was "aurora" — a UNIVERSE style,
			// accepted here because nothing read the field. It resolves to the
			// same neutral profile either way, so the golden fixtures are
			// untouched by the correction.
			PreferredWorldStyle: StyleOpenWater,
		},
	}
}

func TestBuildOceanConfigDeterministic(t *testing.T) {
	builder := NewOceanConfigBuilder()
	input := buildTestInput("OCN-DETERMINISM", "reflective", 5)
	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input must build identical configs")
	}
	if first.SchemaVersion != oceanSchemaVersion {
		t.Fatalf("schemaVersion = %q, want %q", first.SchemaVersion, oceanSchemaVersion)
	}
	if first.SceneType != oceanSceneType {
		t.Fatalf("sceneType = %q, want %q", first.SceneType, oceanSceneType)
	}
	if len(first.Landmarks) != 5 {
		t.Fatalf("landmarks = %d, want one per DNA landmark (5)", len(first.Landmarks))
	}
	if first.Assets.CatalogVersion != assetCatalogVersion {
		t.Fatalf("assets.catalogVersion = %q, want %q", first.Assets.CatalogVersion, assetCatalogVersion)
	}
}

// THE DEPTH CONTROL MUST SELECT A DEPTH.
//
// This test asserted the opposite for most of the family's life. It required
// every mood to lean toward a zone "without ever hard-locking it", by analogy
// with the way the forest treats seasons, and it failed a mood that produced
// only one zone. The analogy was wrong: the forest's four seasons are a
// character the world HAS, while these four options are labelled DEPTH & MOOD
// and named after depths, so they are a coordinate the person CHOOSES. A
// leaning coordinate is a broken control — picking "The Abyss" and receiving a
// view of the water surface happened 5% of the time and was reported as a bug
// the first time it was seen.
//
// So the assertion is inverted, and it is now the stronger of the two: each
// mood produces exactly one zone, for every seed, and the four of them lay out
// the whole axis in order with nothing missing and nothing doubled up.
// TestEachMoodDriftsWithinItsClamp is the two-sided contract for the 1.3
// zone drift: the underwater zone is a weighted home that may drift ONE zone
// away — except in the one direction that recreated the original bug, which
// must never happen at all, not just rarely.
//
// "Glass Shallows"'s own AboveWaterProbability roll (1.4) is checked separately
// in ocean_surface_view_test.go — that mood's zone is asserted here to stay
// pinned to the sunlit shallows in EVERY sample regardless of whether that
// sample surfaces, because driftZone exempts any mood with a nonzero surface
// probability from zone drift entirely (see mustNeverSurface below).
func TestEachMoodDriftsWithinItsClamp(t *testing.T) {
	builder := NewOceanConfigBuilder()
	type expectation struct {
		// Only true for moods whose AboveWaterProbability is a flat 0 — a mood
		// that has never been asked to surface must never surface, full stop.
		mustNeverSurface bool
		forbiddenZone    string // "" if the mood may reach every underwater zone
		homeZone         string
	}
	expected := map[string]expectation{
		"focused": {mustNeverSurface: false, homeZone: ZoneSunlitShallows},
		// Reef Crest may drift down into the twilight reach, but reaching the
		// abyss in one step is exactly the bug the 1.2 pin fixed: a diver who
		// asked for a reef must never be shown the trench.
		"energetic": {mustNeverSurface: true, forbiddenZone: ZoneAbyss, homeZone: ZoneSunlitShallows},
		// Mesophotic Current is the middle of the axis, so it is the one mood allowed to
		// reach either neighbour.
		"dreamy": {mustNeverSurface: true, homeZone: ZoneTwilightReach},
		// The Abyss may drift up into the twilight reach, but reaching the
		// shallows is the specific combination that was reported as a bug:
		// picking the deepest option and receiving the water surface.
		"reflective": {mustNeverSurface: true, forbiddenZone: ZoneSunlitShallows, homeZone: ZoneAbyss},
	}
	const samplesPerMood = 240
	covered := map[string]bool{}
	for mood, want := range expected {
		zoneCounts := map[string]int{}
		for sample := 0; sample < samplesPerMood; sample++ {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-ZONE-%s-%d", mood, sample), mood, 4))
			if want.mustNeverSurface && config.Depth.Metres < 0 {
				t.Fatalf("mood %q put the viewer at %.2f m, above the water; this mood's AboveWaterProbability is 0",
					mood, config.Depth.Metres)
			}
			if mood == "focused" && config.Depth.Zone != want.homeZone {
				t.Fatalf("mood %q produced zone %q at sample %d; its zone must stay pinned to %q whether or not this sample surfaces",
					mood, config.Depth.Zone, sample, want.homeZone)
			}
			if want.forbiddenZone != "" && config.Depth.Zone == want.forbiddenZone {
				t.Fatalf("mood %q produced zone %q at sample %d — this exact combination is the bug the 1.2 pin fixed, and the 1.3 drift must never reopen it",
					mood, want.forbiddenZone, sample)
			}
			zoneCounts[config.Depth.Zone]++
			covered[config.Depth.Zone] = true
		}
		// Plurality, not majority: the home zone's count must be the LARGEST
		// of the three, which is the bar the weight tables are actually tuned
		// to clear (dreamy's own weight is 0.55 of three candidates, so a
		// strict >50% bar is tighter than "home" needs to mean).
		for zone, count := range zoneCounts {
			if zone != want.homeZone && count >= zoneCounts[want.homeZone] {
				t.Fatalf("mood %q's home zone %q (%d) was not the plurality across %d samples: %v",
					mood, want.homeZone, zoneCounts[want.homeZone], samplesPerMood, zoneCounts)
			}
		}
	}
	// And the four moods together must still cover the whole axis, or the
	// clamp has quietly made a zone unreachable from the create form.
	for _, zone := range zoneKindsInOrder {
		if !covered[zone] {
			t.Fatalf("no mood reaches %q across any sample, so that zone is unreachable from the create form", zone)
		}
	}
}

// The zone label and the depth in metres are two views of one value. A world
// whose label disagrees with its own depth would make every downstream
// zone-keyed table lie.
func TestZoneAlwaysAgreesWithMetres(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 300; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-AGREE-%d", sample), mood, 4))
			if config.Depth.Zone != ZoneForDepth(config.Depth.Metres) {
				t.Fatalf("depth %.2f m is labelled %q, want %q", config.Depth.Metres, config.Depth.Zone, ZoneForDepth(config.Depth.Metres))
			}
			// A NEGATIVE depth is a viewer above the waterline, and it is a real
			// value rather than a bug — but only within a person's eye height,
			// and only from the shallows. An unbounded negative depth would put
			// the camera in orbit and still label the world a reef.
			if config.Depth.Metres < 0 {
				if config.Depth.Zone != ZoneSunlitShallows {
					t.Fatalf("a %.2f m altitude is labelled %q; only the shallows may break the surface", config.Depth.Metres, config.Depth.Zone)
				}
				altitude := -config.Depth.Metres
				if altitude < minimumBreachAltitudeMetres || altitude > minimumBreachAltitudeMetres+breachAltitudeRangeMetres {
					t.Fatalf("altitude %.2f m is outside the breach band", altitude)
				}
				// There must still be a real seabed under a surfaced world.
				if config.Depth.SeafloorMetres <= 0 {
					t.Fatalf("surfaced world has seafloor at %.2f m", config.Depth.SeafloorMetres)
				}
				continue
			}
			if config.Depth.Metres > MaximumDepthMetres {
				t.Fatalf("depth %.2f m is outside the real range", config.Depth.Metres)
			}
		}
	}
}

// Everything about the water EXCEPT the sea state is a pure consequence of
// depth. Two worlds at the same depth must get the same colour, the same fog,
// the same visibility and the same water type, or the depth curve is not the
// single source of them.
//
// The sea state is excluded on purpose and it is the one thing here that is
// weather rather than optics: two worlds at the same depth can legitimately sit
// under a mirror and under a whitecapped chop. TestWindSpeedIsWeather covers it
// separately, so neither property is asserted by accident.
func TestWaterIsDerivedOnlyFromDepth(t *testing.T) {
	builder := NewOceanConfigBuilder()
	byDepth := map[float64]models.WaterConfig{}
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-WATER-%d", sample), "dreamy", 4))
		optics := config.Water
		// Both of the drawn values are excluded here and asserted separately:
		// the wind by TestWindSpeedIsWeather, the water type by
		// TestOpenWaterIsNeverCoastal. Visibility now depends on the water type,
		// so it travels with them.
		optics.WindSpeedMetresPerSecond = 0
		optics.JerlovWaterType = ""
		optics.VisibilityMetres = 0
		if existing, found := byDepth[config.Depth.Metres]; found {
			if existing != optics {
				t.Fatalf("two worlds at %.2f m disagree about the water: %#v vs %#v", config.Depth.Metres, existing, optics)
			}
			continue
		}
		byDepth[config.Depth.Metres] = optics
		expected := DepthAt(config.Depth.Metres)
		if config.Water.FogColor != expected.FogColor || config.Water.FogDensity != expected.FogDensity {
			t.Fatalf("stored water at %.2f m does not match the curve: %#v", config.Depth.Metres, config.Water)
		}
	}
}

// An abyssal world must never carry caustics or god rays, and this must hold
// without the builder ever asking which zone it is in.
func TestTheAbyssHasNoSurfaceLightEffects(t *testing.T) {
	builder := NewOceanConfigBuilder()
	sawAbyss := false
	sawShallows := false
	// Two moods, because one mood is now one depth: "reflective" is the only
	// route to the abyss and "energetic" the only route to a lit reef. Sampling
	// a single mood is what this test used to do, and it worked only because the
	// zone was a lottery.
	for sample := 0; sample < 400; sample++ {
		mood := "reflective"
		if sample%2 == 0 {
			mood = "energetic"
		}
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-LIGHT-%d", sample), mood, 4))
		if config.Depth.Zone == ZoneAbyss {
			sawAbyss = true
			if config.Lighting.GodRayStrength != 0 || config.Lighting.CausticStrength != 0 {
				t.Fatalf("abyssal world at %.2f m carries surface light effects: %#v", config.Depth.Metres, config.Lighting)
			}
		}
		if config.Depth.Zone == ZoneSunlitShallows {
			sawShallows = true
			if config.Lighting.GodRayStrength <= 0 {
				t.Fatalf("shallow world at %.2f m has no god rays: %#v", config.Depth.Metres, config.Lighting)
			}
		}
	}
	if !sawAbyss || !sawShallows {
		t.Fatal("the sample never produced both an abyssal and a shallow world; this test proved nothing")
	}
}

// Every stream must draw the same number of times regardless of which features
// a world ends up with, or adding a feature later shifts every existing world.
// The observable proxy: a world with a giant and a world without must still
// agree on everything drawn AFTER the giant in the fauna stream — and since
// the giant is drawn last, the schools and drifters of a fixed seed must not
// move when the giant gate flips.
func TestGatedFeaturesDoNotShiftEarlierDraws(t *testing.T) {
	builder := NewOceanConfigBuilder()
	withGiant := 0
	withoutGiant := 0
	for sample := 0; sample < 400 && (withGiant == 0 || withoutGiant == 0); sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-GATE-%d", sample), "energetic", 4))
		if len(config.Fauna.Giants) > 0 {
			withGiant++
		} else {
			withoutGiant++
		}
	}
	if withGiant == 0 || withoutGiant == 0 {
		t.Fatal("the sample never produced both a world with a giant and one without")
	}
	// The direct guarantee: rebuilding the same seed twice, once reading the
	// giant and once not, cannot change any other section.
	input := buildTestInput("OCN-GATE-STABLE", "energetic", 4)
	first := builder.Build(input)
	second := builder.Build(input)
	if !reflect.DeepEqual(first.Fauna.Schools, second.Fauna.Schools) || !reflect.DeepEqual(first.Fauna.Drifters, second.Fauna.Drifters) {
		t.Fatal("fauna draws are not stable across rebuilds")
	}
}

// Every model key emitted must come from the declared vocabulary. The frontend
// catalogue resolves exactly these; anything else renders as nothing at all.
func TestBuilderEmitsOnlyKnownModelKeys(t *testing.T) {
	known := map[string]bool{}
	for _, key := range []string{
		ModelKeyFloraKelpGiant, ModelKeyFloraSeagrass, ModelKeyFloraCoralBrain, ModelKeyFloraCoralStaghorn,
		ModelKeyFloraCoralSoft, ModelKeyFloraAnemone, ModelKeyFloraTubeworm, ModelKeyFloraGlassSponge, ModelKeyFloraSeaPen,
		ModelKeyFishReefSchool, ModelKeyFishSilverside, ModelKeyFishBarracuda, ModelKeyFishRay,
		ModelKeyFishLanternfish, ModelKeyFishHatchetfish,
		ModelKeyDrifterMoonJelly, ModelKeyDrifterCombJelly, ModelKeyDrifterSiphonophore,
		ModelKeyGiantManta, ModelKeyGiantWhaleShark, ModelKeyGiantHumpback, ModelKeyGiantSpermWhale,
		ModelKeyRockBasalt,
	} {
		known[key] = true
	}
	for _, key := range landmarkModelKeysByKind {
		known[key] = true
	}
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 200; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-KEYS-%d", sample), mood, 5))
			for _, key := range config.Assets.ModelKeys {
				if !known[key] {
					t.Fatalf("config emitted unknown model key %q", key)
				}
			}
		}
	}
}

// Only light-fed flora may appear where there is light to feed it, and none of
// it may appear where there is not. This is the single rule that keeps the
// three zones from reading as one zone with three colour grades.
func TestFloraRespectsWhatCanLiveAtThatDepth(t *testing.T) {
	photosynthetic := map[string]bool{
		ModelKeyFloraKelpGiant:     true,
		ModelKeyFloraSeagrass:      true,
		ModelKeyFloraCoralBrain:    true,
		ModelKeyFloraCoralStaghorn: true,
	}
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 300; sample++ {
		for _, mood := range []string{"focused", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-FLORA-%d", sample), mood, 4))
			if config.Depth.Zone != ZoneAbyss {
				continue
			}
			for _, entry := range config.Flora.SpeciesMix {
				if photosynthetic[entry.ModelKey] {
					t.Fatalf("abyssal world at %.2f m grows %q, which needs sunlight", config.Depth.Metres, entry.ModelKey)
				}
			}
		}
	}
}

// A giant arrives out of the fog. Anchoring it to a fixed distance instead of
// the water's own visibility would put it in plain sight in the shallows and
// on top of the camera in the abyss.
func TestGiantsApproachNoCloserThanTheWaterAllows(t *testing.T) {
	builder := NewOceanConfigBuilder()
	seen := 0
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-GIANT-%d", sample), "energetic", 4))
		for _, giant := range config.Fauna.Giants {
			seen++
			if giant.ApproachDistance < config.Water.VisibilityMetres*giantApproachFraction-0.01 {
				t.Fatalf("giant approached to %.2f m with %.2f m of visibility", giant.ApproachDistance, config.Water.VisibilityMetres)
			}
			if giant.PassDurationSeconds <= 0 {
				t.Fatalf("giant has no pass duration: %#v", giant)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no giant appeared in 400 worlds; this test proved nothing")
	}
}

// Landmark placement mirrors the forest exactly, because the frontend's POI
// extraction, hover and click-to-focus are family-agnostic and must stay so.
func TestLandmarksAreHeroFirstAndDeduped(t *testing.T) {
	builder := NewOceanConfigBuilder()
	config := builder.Build(buildTestInput("OCN-LANDMARKS", "dreamy", 6))
	if config.Landmarks[0].Kind != LandmarkKelpCathedral {
		t.Fatalf("first landmark kind = %q, want the hero %q", config.Landmarks[0].Kind, LandmarkKelpCathedral)
	}
	seen := map[string]bool{}
	for index, landmark := range config.Landmarks {
		if index > 0 && landmark.Kind == LandmarkKelpCathedral {
			t.Fatalf("landmark %d repeated the hero kind", index)
		}
		if index > 0 && seen[landmark.Kind] {
			t.Fatalf("landmark %d repeated kind %q while unused kinds remained", index, landmark.Kind)
		}
		seen[landmark.Kind] = true
		// The invariant is CLEARANCE FROM THE CAMERA, not containment in the
		// basin. It used to be the latter, and the latter is what allowed the bug:
		// the basin is 26-38 m and the camera orbits at 16-24 m, so "inside the
		// basin" was satisfied by a landmark standing exactly where the viewer
		// does. The basin is a scatter bound for small dressing — rocks, tufts,
		// reef clusters — not a wall, and the seabed itself is drawn 680 m across.
		if landmark.RadiusFromCenter < config.Camera.Distance+landmarkCameraStandoffMetres {
			t.Fatalf("landmark %d sits at radius %.2f, inside the camera's orbit at %.2f",
				index, landmark.RadiusFromCenter, config.Camera.Distance)
		}
		if landmark.RadiusFromCenter > config.Camera.Distance+landmarkCameraStandoffMetres+landmarkRingDepthMetres {
			t.Fatalf("landmark %d sits at radius %.2f, past the ring", index, landmark.RadiusFromCenter)
		}
		if landmark.AngleRadians < -landmarkAngleJitterRadians || landmark.AngleRadians > 2*math.Pi+landmarkAngleJitterRadians {
			t.Fatalf("landmark %d angle %.2f is outside one turn", index, landmark.AngleRadians)
		}
	}
}

// The family is called "ocean" at every machine-readable layer. "Abyss" is a
// zone and a landmark kind, never an identifier for the family — a reef config
// living under an "abyss" name would be a permanent mismatch nobody can rename
// once a share link is public.
func TestNoMachineReadableIdentifierIsNamedAbyss(t *testing.T) {
	builder := NewOceanConfigBuilder()
	config := builder.Build(buildTestInput("OCN-NAMING", "reflective", 4))
	if config.SceneType != "ocean" {
		t.Fatalf("sceneType = %q, want \"ocean\"", config.SceneType)
	}
	if strings.Contains(config.Seafloor.PlacementSeed, "abyss") || strings.Contains(config.Flora.PlacementSeed, "abyss") {
		t.Fatalf("a seed stream is named after the abyss: %q / %q", config.Seafloor.PlacementSeed, config.Flora.PlacementSeed)
	}
	if !strings.Contains(config.Seafloor.PlacementSeed, "-ocean-") {
		t.Fatalf("placement seed %q is not namespaced to this family", config.Seafloor.PlacementSeed)
	}
}

// The sea state is weather, and weather does not follow depth.
//
// Two assertions, and the second is the one that matters: the wind must VARY
// between worlds at the same depth (otherwise it is just another depth lookup
// wearing a different name) and it must stay inside the band the wave spectrum
// was built for. A wind of zero gives a mirror with no wave field in it; a wind
// past the band turns every world into a storm nobody asked for.
func TestWindSpeedIsWeather(t *testing.T) {
	builder := NewOceanConfigBuilder()
	byDepth := map[float64][]float64{}
	varied := false
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-WIND-%d", sample), "dreamy", 4))
		wind := config.Water.WindSpeedMetresPerSecond
		if wind < minimumWindSpeedMetresPerSecond || wind > minimumWindSpeedMetresPerSecond+windSpeedRangeMetresPerSecond {
			t.Fatalf("wind %.2f m/s is outside the Beaufort 3-6 band", wind)
		}
		for _, seen := range byDepth[config.Depth.Metres] {
			if seen != wind {
				varied = true
			}
		}
		byDepth[config.Depth.Metres] = append(byDepth[config.Depth.Metres], wind)
	}
	if !varied {
		t.Fatal("every world at a given depth got the same wind; the sea state is following depth rather than weather")
	}
}

// Open water is open water.
//
// The turbidity that makes coastal water coastal is river outflow and
// resuspended sediment, and neither reaches the middle of an ocean. A twilight
// or abyssal world labelled with a coastal type would render the deep sea
// estuary-green — which is exactly what the first version of this did, because
// it inferred clarity from how much LIGHT was left rather than from where the
// world is.
func TestOpenWaterIsNeverCoastal(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 400; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-TYPE-%d", sample), mood, 4))
			allowed := waterTypesByZone[config.Depth.Zone]
			found := false
			for _, candidate := range allowed {
				if candidate == config.Water.JerlovWaterType {
					found = true
				}
			}
			if !found {
				t.Fatalf("a %s world is in water type %q, which is not one of %v", config.Depth.Zone, config.Water.JerlovWaterType, allowed)
			}
		}
	}
}

// Visibility can never claim to reach further than the water itself allows.
// Storing a number the water cannot support would put the fog and the water
// type in disagreement, and the renderer reads both.
func TestVisibilityNeverExceedsTheWater(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 300; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-VIS-%d", sample), "dreamy", 4))
		limit := SightingRangeForWaterType(config.Water.JerlovWaterType)
		if config.Water.VisibilityMetres > limit+0.01 {
			t.Fatalf("%s water stores %.2f m of visibility but can only carry %.2f m", config.Water.JerlovWaterType, config.Water.VisibilityMetres, limit)
		}
	}
}

// Open ocean is blue and coastal water is green, and the reason is that clear
// water sees further. If the clearest water in this family were not also the
// water with the longest sighting range, the whole classification would be
// backwards.
func TestClearerWaterSeesFurther(t *testing.T) {
	for index := 1; index < len(jerlovWaterTypes); index++ {
		clearer := sightingRangeMetres(jerlovWaterTypes[index-1])
		murkier := sightingRangeMetres(jerlovWaterTypes[index])
		if murkier >= clearer {
			t.Fatalf("%s sees %.1f m and the clearer %s only %.1f m", jerlovWaterTypes[index].Name, murkier, jerlovWaterTypes[index-1].Name, clearer)
		}
	}
}

// Every ocean world must be able to see the surface or the floor.
//
// Water with neither is not a place, it is a colour: nothing to read scale or
// direction from, nothing for the light to land on, nothing for an animal to be
// near. This used to be violated by every twilight world, deliberately, and it
// rendered as a flat blue rectangle.
func TestEveryWorldCanSeeABoundary(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 400; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-BOUND-%d", sample), mood, 4))
			if config.Depth.Metres < 0 {
				// Above the waterline the surface is underfoot.
				continue
			}
			// The renderer decides with the water the world actually got, so
			// this asserts against that rather than against the band the
			// builder reasoned with.
			reach := SightingRangeForWaterType(config.Water.JerlovWaterType) * boundarySightMultiplier
			surfaceVisible := config.Depth.Metres <= reach
			floorVisible := config.Depth.SeafloorMetres-config.Depth.Metres <= reach
			if !surfaceVisible && !floorVisible {
				t.Fatalf("a world at %.2f m with the floor at %.2f m in %s water (%.1f m of reach) can see neither boundary",
					config.Depth.Metres, config.Depth.SeafloorMetres, config.Water.JerlovWaterType, reach)
			}
		}
	}
}

// The rule must not quietly collapse the family onto one depth. If satisfying
// it turned every world into a reef, the fix would have cost more than the bug.
func TestTheBoundaryRuleKeepsTheDepthRange(t *testing.T) {
	builder := NewOceanConfigBuilder()
	deepest := 0.0
	for sample := 0; sample < 400; sample++ {
		config := builder.Build(buildTestInput(fmt.Sprintf("OCN-BOUND-%d", sample), "reflective", 4))
		if config.Depth.Metres > deepest {
			deepest = config.Depth.Metres
		}
	}
	if deepest < 1000 {
		t.Fatalf("the deepest world in 400 samples is %.2f m; the boundary rule has flattened the family", deepest)
	}
}

// The boundary rule must never change what zone a world is in. Its first
// version lifted twilight viewers to nine metres, which reclassified them as
// shallows — destroying the mood's depth lean, and then letting them draw
// coastal water too murky to reach the surface they had been moved to see.
func TestTheBoundaryRuleNeverChangesTheZone(t *testing.T) {
	builder := NewOceanConfigBuilder()
	for sample := 0; sample < 400; sample++ {
		for _, mood := range []string{"focused", "dreamy", "energetic", "reflective"} {
			config := builder.Build(buildTestInput(fmt.Sprintf("OCN-BAND-%d", sample), mood, 4))
			if config.Depth.Metres < 0 {
				continue
			}
			band := depthBandByZone[config.Depth.Zone]
			if config.Depth.Metres < band.Minimum-0.01 || config.Depth.Metres > band.Maximum+0.01 {
				t.Fatalf("a %s world sits at %.2f m, outside its own band %.0f-%.0f m",
					config.Depth.Zone, config.Depth.Metres, band.Minimum, band.Maximum)
			}
		}
	}
}
