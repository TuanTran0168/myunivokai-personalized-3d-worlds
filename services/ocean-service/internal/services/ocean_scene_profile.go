package services

import (
	"strings"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

// This file is the ocean family's tuning table: every zone/current/fauna table
// and every numeric bound the deterministic builder draws within. It is the
// mirror pair of the frontend's lib/oceanScene.ts — when either changes, the
// other must change with it, the same discipline nature-service keeps with
// lib/forestScene.ts and universe-service with lib/scene.ts.
//
// One thing is deliberately NOT in this file: water colour, fog, ambient
// light, god rays and caustics. Those are computed by depth_curve.go from
// measured physics rather than picked here, which is why this family has no
// per-zone fog-colour table the way the forest has a per-season one.

// Depth zones, in canonical order from the surface down. The order is part of
// the contract: each mood pins one of them, and the transitional blend picks an
// adjacent zone by stepping along this list.
//
// NEITHER BOUNDARY IS A ROUND NUMBER SOMEBODY LIKED. Both come out of
// depth_curve.go:
//
//   - The sunlit shallows end where ORANGE does, at 40 m. Above it a scene
//     still has warm colour in it; below it everything warm is already grey.
//   - The twilight reach ends at the SUNLIGHT FLOOR, 1000 m, which is also
//     where god rays and caustics reach zero on their own. That is what makes
//     "the abyss has no caustics" fall out of the physics instead of being a
//     rule somebody has to remember to apply.
const (
	ZoneSunlitShallows = "sunlitShallows"
	ZoneTwilightReach  = "twilightReach"
	ZoneAbyss          = "abyss"
)

var zoneKindsInOrder = []string{ZoneSunlitShallows, ZoneTwilightReach, ZoneAbyss}

// How far above the waterline an above-water world's viewer sits.
//
// HOW OFTEN IS NO LONGER A PROBABILITY, AND THAT IS THE POINT. This used to be
// a `surfaceBreachProbability` of one in three, rolled for every shallow world,
// which meant the sea-surface view was a lottery nobody could enter on purpose
// and the abyss could win it by accident. It is now a property of the mood the
// person picked — "Glass Shallows" is above the water, every seed, and no other
// mood ever is. See oceanMoodProfiles.
//
// What is left here is the altitude, which is still drawn, because how high
// above a sea you are is a genuine degree of freedom and 4 m and 24 m are
// different photographs.
//
// THE ALTITUDE BAND WAS WRONG, AND THE REASONING THAT SET IT WAS TOO.
//
// It used to be 1.4-7.8 m, chosen as "a person's eye height on the water:
// standing in a small boat at the low end, a flybridge or a low cliff at the
// high end. Higher than that and the waves stop being something you are among."
// That is a nice sentence and it produced a frame with no horizon in it.
//
// Two things are wrong with it. The first is arithmetic: wind in this family runs
// to 13 m/s, and Pierson-Moskowitz puts the significant wave height there at
// 3.6 m. At 4.5 m of altitude the crests are at eye level, the sea fills the
// frame edge to edge, and there is no sky line — so the one view that exists to
// show the surface showed no surface, only water. That is exactly the report this
// change answers.
//
// The second is that "a person's eye height" is a story about a viewer this
// family does not otherwise have. Nothing else on this axis is a person: 2448 m
// is not a diver and 142 m is not a submarine, they are places. The altitude
// should be chosen for what the FRAME needs, and what the frame needs is enough
// height for the horizon to separate from the water.
//
// So: 4 m at the low end, which clears the crests of the roughest sea this family
// can generate, up to 24 m — the height the prototype's own two above-water views
// are composed at (12 m and 22 m), and where sea and sky each get half the frame.
//
// The water below an above-water world is still drawn from the shallows band, so
// "Glass Shallows" is a shallow sea seen from the air — turquoise over sand, with
// the bottom legible through it — rather than mid-ocean grey. That is the more
// beautiful of the two and it is also the honest one: a 24 m altitude cannot see
// a 3 km seabed, but it can absolutely see a 20 m one.
const (
	minimumBreachAltitudeMetres = 4.0
	breachAltitudeRangeMetres   = 20.0
)

// THE BOUNDARY RULE: every ocean world must be able to see the surface or the
// floor.
//
// Water with neither is not a place, it is a colour. A viewer needs one plane
// of reference to read scale, direction and motion from — take both away and
// the fish have nothing to be near, the god rays have nothing to land on, and
// the frame is a flat wash. This is the rule the twilight zone used to be
// exempt from, on purpose, and the exemption is what made a third of all worlds
// render as an empty blue rectangle.
//
// Both ways of satisfying it are real places, and which one a world gets is
// drawn:
//
//   - RISE THE FLOOR. Seamounts are ordinary — there are on the order of a
//     hundred thousand of them — and a world in open water above one is exactly
//     as honest as a world above an abyssal plain. The viewer's depth, which is
//     this family's whole axis, is untouched.
//   - LIFT THE VIEWER. Most of what anyone has ever seen of open water is from
//     the top of it. The demo's own "open water" view is 17 m down with three
//     kilometres beneath it, and it is the best-looking frame in the study.
//
// The clearance a rise leaves is deliberately generous: close enough to be seen
// through the water, far enough that the floor is a landscape below rather than
// something the viewer is standing on.
//
// Whichever way a world satisfies it, THE ZONE MUST NOT CHANGE. Lifting a
// twilight viewer up to nine metres was the first attempt, and it quietly
// reclassified those worlds as shallows — which contradicted the mood's own
// pinned zone, and then let them draw coastal water whose sighting range could not
// reach the surface it had just been moved to see. So a lift only ever moves a
// world within its OWN depth band.
const (
	seamountRiseProbability    = 0.5
	minimumRiseClearanceMetres = 18.0
	riseClearanceRangeMetres   = 34.0
	// How much of a sighting range a boundary may sit at and still count as
	// visible. The renderer uses the same multiplier to decide whether to draw
	// it, and if these two ever disagree the builder guarantees a boundary the
	// renderer then refuses to draw.
	boundarySightMultiplier = 1.5
)

const (
	twilightReachTopMetres = orangeDeathMetres
	abyssTopMetres         = SunlightFloorMetres
)

// ZoneForDepth is the single definition of which zone a depth belongs to. The
// builder stores both the metres and the zone; this function is what
// guarantees they can never disagree.
func ZoneForDepth(metres float64) string {
	switch {
	case metres < twilightReachTopMetres:
		return ZoneSunlitShallows
	case metres < abyssTopMetres:
		return ZoneTwilightReach
	default:
		return ZoneAbyss
	}
}

// depthBandByZone is where inside a zone a world is actually placed. The bands
// do not fill their zones edge to edge on purpose: a portrait wants a
// characteristic depth, not a uniform sample. A reef sits where reefs sit.
//
// The bands are chosen so the three zones read as three DIFFERENT WORLDS
// rather than as one world under three colour grades, which is the acceptance
// criterion this family was signed off against:
//
//   - 3-28 m is where reef-building coral actually lives, and where caustics
//     are still legible. A "reef in sunlit water" placed at 50 m is a dark
//     green room.
//   - 45-170 m is the deep blue with faint rays and silhouettes. Placed any
//     deeper it becomes indistinguishable from the abyss — the first draft put
//     it at 220-900 m and a 750 m "twilight" world came out byte-identical in
//     water and lighting to a 2400 m abyssal one.
//   - 1050-3800 m is below the sunlight floor, so every abyssal world is lit
//     by bioluminescence alone as a matter of arithmetic.
var depthBandByZone = map[string]floatRange{
	ZoneSunlitShallows: {Minimum: 3, Maximum: 28},
	ZoneTwilightReach:  {Minimum: 45, Maximum: 170},
	ZoneAbyss:          {Minimum: 1050, Maximum: 3800},
}

// floorClearanceBandByZone is the water BELOW the viewer, in metres, and it is
// what finally makes the three zones three different places rather than three
// colour grades of the same place.
//
// The first draft had no such concept, so every world — reef, twilight, trench
// — sat a few metres above a seabed. Two of those three are wrong, and the
// middle one is wrong in the most interesting way:
//
//   - A reef IS shallow water over a floor. You are on the continental shelf,
//     the bottom is right there, and kelp confirms it: kelp forests are rarely
//     deeper than 15-40 m because they need light. Floor visible.
//   - The twilight zone is OPEN WATER. Against a mean ocean depth of 3682 m,
//     a world at 143 m has kilometres of nothing beneath it, so no floor.
//
//     It used to have no surface either, and that was written down here as a
//     virtue: "the one zone where you can see neither boundary, which is
//     precisely what makes the midwater unnerving rather than empty". It is
//     wrong, and it is wrong in a way only a rendered frame shows. A viewer at
//     143 m with fifty metres of sighting range is not unnerved — there is
//     nothing in frame to be unnerved BY. It renders as a flat blue rectangle
//     with some fish in it, which is the single ugliest thing this family can
//     produce, and it produced it for a third of all worlds. See
//     surfacedByBoundaryRule below.
//   - The abyssal worlds are placed ON the bottom, because everything that
//     makes the abyss worth drawing lives there: hydrothermal vents (mean
//     ~2100 m along the mid-ocean ridges), whale falls, tubeworm fields. An
//     abyssal world suspended in mid-water would be a black screen.
//
// The renderer never reads this table, or the zone. It subtracts, compares the
// result against visibility, and draws a floor or does not.
// The two on-the-bottom bands must stay INSIDE the visibility at their own
// depth, or "this world sits on the seabed" silently becomes "this world sits
// slightly too far above the seabed to see it". The abyss is the tight case:
// visibility down there is about 12 m, so a 3-26 m band left more than a third
// of abyssal worlds staring into nothing. TestOnBottomZonesCanActuallySeeTheir
// Floor pins this against the depth curve rather than against a comment.
var floorClearanceBandByZone = map[string]floatRange{
	ZoneSunlitShallows: {Minimum: 2, Maximum: 14},
	ZoneTwilightReach:  {Minimum: 1900, Maximum: 3900},
	ZoneAbyss:          {Minimum: 2, Maximum: 9},
}

// onBottomZones are the zones whose worlds are placed on the seabed. The
// twilight reach is deliberately absent: it is open water and its floor is
// SUPPOSED to be out of sight.
var onBottomZones = []string{ZoneSunlitShallows, ZoneAbyss}

// Current kinds. Still water belongs to the deep, surge to the shallows — the
// per-zone weight tables below encode the whole compatibility matrix, the same
// way the forest encodes "snow only in winter".
const (
	CurrentStill = "still"
	CurrentDrift = "drift"
	CurrentSurge = "surge"
)

// Landmark kinds — the ocean counterpart of the forest's landmark kinds. The
// first DNA landmark always becomes the kelp cathedral (the hero of the
// portrait); the rest draw from nonHeroLandmarkKinds with a deterministic
// dedupe walk.
//
// These are also the only place in this service the word "abyssal" appears as
// an identifier, and that is intentional: the abyss is a zone and a landmark,
// never the family. See contracts.WorldFamilyOcean.
const (
	LandmarkKelpCathedral    = "kelpCathedral"
	LandmarkSunkenRelic      = "sunkenRelic"
	LandmarkHydrothermalVent = "hydrothermalVent"
	LandmarkCoralGarden      = "coralGarden"
	LandmarkAbyssalTrench    = "abyssalTrench"
	LandmarkWhaleFall        = "whaleFall"
)

var nonHeroLandmarkKinds = []string{LandmarkSunkenRelic, LandmarkHydrothermalVent, LandmarkCoralGarden, LandmarkAbyssalTrench, LandmarkWhaleFall}

// Model keys the configs may reference.
//
// The ocean-1 catalogue resolves every key below to PROCEDURAL geometry built
// in the browser, not to a downloaded GLB. That is the decision phase O4 of
// notes/vision/ocean-service-plan.md left open, taken this way because no
// agent-downloadable CC0 abyssal creature exists and a species list the
// renderer cannot draw is the one mistake in this family that cannot be undone
// cheaply — species are selected by floor(roll x len), so the order is frozen
// the moment the first world ships.
//
// Swapping a key to a self-hosted GLB later is a purely frontend change: it
// alters no stored config and re-renders every existing world.
const (
	ModelKeyFloraKelpGiant     = "flora-kelp-giant"
	ModelKeyFloraSeagrass      = "flora-seagrass"
	ModelKeyFloraCoralBrain    = "flora-coral-brain"
	ModelKeyFloraCoralStaghorn = "flora-coral-staghorn"
	ModelKeyFloraCoralSoft     = "flora-coral-soft"
	ModelKeyFloraAnemone       = "flora-anemone"
	ModelKeyFloraTubeworm      = "flora-tubeworm"
	ModelKeyFloraGlassSponge   = "flora-glass-sponge"
	ModelKeyFloraSeaPen        = "flora-sea-pen"

	ModelKeyFishReefSchool  = "fish-reef-school"
	ModelKeyFishSilverside  = "fish-silverside"
	ModelKeyFishBarracuda   = "fish-barracuda"
	ModelKeyFishRay         = "fish-ray"
	ModelKeyFishLanternfish = "fish-lanternfish"
	ModelKeyFishHatchetfish = "fish-hatchetfish"

	ModelKeyDrifterMoonJelly    = "drifter-moon-jelly"
	ModelKeyDrifterCombJelly    = "drifter-comb-jelly"
	ModelKeyDrifterSiphonophore = "drifter-siphonophore"

	ModelKeyGiantManta      = "giant-manta"
	ModelKeyGiantWhaleShark = "giant-whale-shark"
	ModelKeyGiantHumpback   = "giant-humpback"
	ModelKeyGiantSpermWhale = "giant-sperm-whale"

	ModelKeyRockBasalt = "rock-basalt"
)

var landmarkModelKeysByKind = map[string]string{
	LandmarkKelpCathedral:    "landmark-kelp-cathedral",
	LandmarkSunkenRelic:      "landmark-sunken-relic",
	LandmarkHydrothermalVent: "landmark-hydrothermal-vent",
	LandmarkCoralGarden:      "landmark-coral-garden",
	LandmarkAbyssalTrench:    "landmark-abyssal-trench",
	LandmarkWhaleFall:        "landmark-whale-fall",
}

// assetCatalogVersion pins which frontend catalogue resolves the model keys, so
// stored configs stay interpretable when the catalogue evolves.
const assetCatalogVersion = "ocean-1"

// oceanMoodProfile tunes the deterministic ocean numbers by atmospheric mood.
//
// Zone is a HOME, not an absolute pin — and that has been true twice, for two
// different reasons.
//
// It started as `ZoneWeights [3]float64` — a probability per zone — on the
// reasoning that a hard mapping would make repeated generations too samey.
// What it actually produced was a control that lies: the create form labels
// these four options DEPTH & MOOD and names them after depths, so choosing
// "The Abyss" and receiving a view of the water surface is not pleasant
// variety, it is the control not working. That combination had a 5% chance
// every time somebody picked the abyss (15% weight on the shallows, times a
// one-in-three breach), and it was reported as a bug the first time anyone
// saw it. The fix was to pin Zone absolutely.
//
// Once that shipped, the opposite complaint arrived: every generation of the
// same mood came out at the same depth, and that felt less like a portrait
// than a colour swatch. So the zone is a weighted home again — see
// oceanZoneDriftWeightsByMood — but built so it CANNOT reproduce the original
// bug:
//
//   - Drift is ADJACENT-ONLY. A zone can lean one step up or down the stack;
//     it can never skip one. The Abyss can reach the twilight reach but never
//     the sunlit shallows, in the same roll.
//   - The direction that recreated the bug is zeroed outright, not just made
//     unlikely. The Abyss's weight on the shallows is exactly 0, not a small
//     number — "The Abyss never shows the water surface" is a guarantee this
//     family makes, not a tendency.
//
// AboveWaterProbability got the same correction one step later, for the
// identical reason: it used to be a plain bool, absolutely pinned, so
// "Glass Shallows" broke the surface every single seed. That was deliberate —
// it is the create form's default mood and therefore the first view of the
// whole family — but pinning it 100% made every "Glass Shallows" generation the
// same photograph, exactly the complaint the zone pin drew the first time.
// It is now a weighted roll like the zone is, MOST of the time a surface (so
// the default first view still usually is one) and otherwise the calm shallow
// sea it sits above — never the rougher "Reef Crest" reading, because the two
// keep their own current/fauna multipliers below. No other mood's probability
// moved: only "Glass Shallows" was asked for this, so only it has it.
type oceanMoodProfile struct {
	// Zone is the home the mood leans toward — see oceanZoneDriftWeightsByMood
	// for how far a given generation may drift from it.
	Zone string
	// AboveWaterProbability is how often this mood lifts the viewer out of the
	// water entirely: depth goes negative and the world is the sea seen from
	// the air. Rolled once per generation against aboveWaterRoll in
	// buildDepthConfig. 0 for every mood but "Glass Shallows": a mood that has
	// never been asked to surface should never surface, full stop, not "rarely".
	// Not a fourth zone either way — the zone below is still the one named above.
	AboveWaterProbability float64
	CurrentMultiplier     float64
	FaunaMultiplier       float64
	BloomMultiplier       float64
}

// The fallback for a mood this family does not know. Twilight because it is the
// middle of the axis and unambiguously underwater: an unknown mood should get
// the most ordinary ocean there is, not an edge of the range.
var neutralOceanProfile = oceanMoodProfile{
	Zone:                  ZoneTwilightReach,
	AboveWaterProbability: 0,
	CurrentMultiplier:     1.0,
	FaunaMultiplier:       1.0,
	BloomMultiplier:       1.0,
}

// Keyed by the atmospheric mood values the create form sends — the same four
// backend values every family uses. Four moods across an axis with three zones
// and a negative half, which is what makes the table square without inventing
// anything: three depths under the water and one above it.
//
//	focused    Glass Shallows       MOSTLY the sea from the air, sometimes the
//	                                calm shallow water beneath it — this mood
//	                                already had the calmest wind of the four,
//	                                above or below.
//	energetic  Reef Crest           the shallows, floor in frame, most fauna,
//	                                surge.
//	dreamy     Mesophotic Current   the twilight reach: midwater, no floor,
//	                                drifting.
//	reflective The Abyss            on the bottom, kilometres down, one light.
//
// Read down the Zone column and it is the depth axis in order, which is the
// property the form's own labels promise and the old weights could not keep.
var oceanMoodProfiles = map[string]oceanMoodProfile{
	"focused":    {Zone: ZoneSunlitShallows, AboveWaterProbability: 0.7, CurrentMultiplier: 0.75, FaunaMultiplier: 0.80, BloomMultiplier: 1.00},
	"energetic":  {Zone: ZoneSunlitShallows, AboveWaterProbability: 0, CurrentMultiplier: 1.35, FaunaMultiplier: 1.35, BloomMultiplier: 1.15},
	"dreamy":     {Zone: ZoneTwilightReach, AboveWaterProbability: 0, CurrentMultiplier: 0.85, FaunaMultiplier: 1.00, BloomMultiplier: 1.35},
	"reflective": {Zone: ZoneAbyss, AboveWaterProbability: 0, CurrentMultiplier: 0.70, FaunaMultiplier: 0.75, BloomMultiplier: 0.85},
}

func oceanProfileForMood(mood string) oceanMoodProfile {
	if profile, ok := oceanMoodProfiles[strings.ToLower(strings.TrimSpace(mood))]; ok {
		return profile
	}
	return neutralOceanProfile
}

// oceanZoneDriftWeights are relative probabilities over the three underwater
// zones. They do not need to sum to 1 (see zoneForDriftRoll), and any weight
// left at 0 is a wall the drift may not cross, not a rounding artefact.
type oceanZoneDriftWeights struct {
	Shallow  float64
	Twilight float64
	Abyss    float64
}

// Per-mood drift weights. Every table is biased toward the shallow end —
// "the water someone can actually see the surface or the reef through" is
// the more common photograph in real diving and diving media both, and the
// person who wants certainty about the deep end still has The Abyss, whose
// own weight there is 0.70.
//
// Read as: each mood's HOME zone (see oceanMoodProfiles) carries the
// plurality, drift reaches one zone over, and the zone that would recreate
// the original bug — Reef Crest into the abyss, The Abyss into the shallows —
// carries exactly 0.
var oceanZoneDriftWeightsByMood = map[string]oceanZoneDriftWeights{
	// energetic (Reef Crest): shallow is home; drifts down into the twilight
	// reach sometimes; never all the way to the abyss.
	"energetic": {Shallow: 0.75, Twilight: 0.25, Abyss: 0.00},
	// dreamy (Mesophotic Current): twilight is home, and being the middle of the axis it
	// is the one mood that may drift either way — weighted toward the
	// shallower neighbour, per the family bias.
	"dreamy": {Shallow: 0.30, Twilight: 0.55, Abyss: 0.15},
	// reflective (The Abyss): abyss is home; drifts up into the twilight reach
	// sometimes; NEVER into the shallows, which is the one direction that used
	// to put a diver who asked for the trench in front of a coral reef.
	"reflective": {Shallow: 0.00, Twilight: 0.30, Abyss: 0.70},
}

// neutralZoneDriftWeights backs an unrecognised mood, matching
// neutralOceanProfile's own twilight-reach home.
var neutralZoneDriftWeights = oceanZoneDriftWeights{Shallow: 0.30, Twilight: 0.55, Abyss: 0.15}

// driftZone turns a mood's home zone into the zone one particular seed
// actually lands in. A mood that can ever surface is exempt from zone drift
// entirely: "Glass Shallows" is a calm shallow sea whether it is showing that sea
// from above the water or from just under it, so its zone stays pinned to its
// home rather than roaming through the twilight reach and the abyss too —
// only whether it surfaces is a roll (see AboveWaterProbability); which
// underwater zone it would show if it did not is not a separate question.
func driftZone(mood string, moodProfile oceanMoodProfile, roll float64) string {
	if moodProfile.AboveWaterProbability > 0 {
		return moodProfile.Zone
	}
	weights, ok := oceanZoneDriftWeightsByMood[strings.ToLower(strings.TrimSpace(mood))]
	if !ok {
		weights = neutralZoneDriftWeights
	}
	total := weights.Shallow + weights.Twilight + weights.Abyss
	if total <= 0 {
		return moodProfile.Zone
	}
	cumulative := weights.Shallow
	if roll < cumulative/total {
		return ZoneSunlitShallows
	}
	cumulative += weights.Twilight
	if roll < cumulative/total {
		return ZoneTwilightReach
	}
	return ZoneAbyss
}

type weightedCurrentKind struct {
	Kind   string
	Weight float64
}

// The zone <-> current compatibility matrix, as weights. Weights are relative
// probabilities; they do not need to sum to 1. Surge is a surface phenomenon:
// it is almost absent from the abyss because the energy driving it is.
var currentWeightsByZone = map[string][]weightedCurrentKind{
	ZoneSunlitShallows: {
		{Kind: CurrentStill, Weight: 0.15},
		{Kind: CurrentDrift, Weight: 0.45},
		{Kind: CurrentSurge, Weight: 0.40},
	},
	ZoneTwilightReach: {
		{Kind: CurrentStill, Weight: 0.30},
		{Kind: CurrentDrift, Weight: 0.55},
		{Kind: CurrentSurge, Weight: 0.15},
	},
	ZoneAbyss: {
		{Kind: CurrentStill, Weight: 0.62},
		{Kind: CurrentDrift, Weight: 0.36},
		{Kind: CurrentSurge, Weight: 0.02},
	},
}

// Canvas clear colour behind the water fog — the ocean counterpart of the
// forest's per-season background. Unlike the fog colour, this one IS a table:
// it is the colour of nothing, and nothing has no physics.
var backgroundColorsByZone = map[string]string{
	ZoneSunlitShallows: "#06283A",
	ZoneTwilightReach:  "#041A2B",
	ZoneAbyss:          "#01070F",
}

// Two flora mixes per zone; a seeded roll picks one. The sunlit zone is the
// only one with reef-building corals and the only one where kelp reaches its
// full height, because both need light. The abyss has no photosynthetic life
// at all — tubeworms live on vent chemistry, glass sponges and sea pens
// filter-feed.
var floraSpeciesMixesByZone = map[string][][]models.FloraSpeciesMixEntry{
	ZoneSunlitShallows: {
		{
			{ModelKey: ModelKeyFloraCoralStaghorn, Weight: 0.35},
			{ModelKey: ModelKeyFloraCoralBrain, Weight: 0.25},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.20},
			{ModelKey: ModelKeyFloraSeagrass, Weight: 0.20},
		},
		{
			{ModelKey: ModelKeyFloraKelpGiant, Weight: 0.40},
			{ModelKey: ModelKeyFloraSeagrass, Weight: 0.30},
			{ModelKey: ModelKeyFloraCoralStaghorn, Weight: 0.30},
		},
	},
	ZoneTwilightReach: {
		{
			{ModelKey: ModelKeyFloraKelpGiant, Weight: 0.45},
			{ModelKey: ModelKeyFloraCoralSoft, Weight: 0.30},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.25},
		},
		{
			{ModelKey: ModelKeyFloraCoralSoft, Weight: 0.40},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.35},
			{ModelKey: ModelKeyFloraAnemone, Weight: 0.25},
		},
	},
	ZoneAbyss: {
		{
			{ModelKey: ModelKeyFloraTubeworm, Weight: 0.45},
			{ModelKey: ModelKeyFloraGlassSponge, Weight: 0.35},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.20},
		},
		{
			{ModelKey: ModelKeyFloraGlassSponge, Weight: 0.50},
			{ModelKey: ModelKeyFloraSeaPen, Weight: 0.50},
		},
	},
}

// Reordering or extending any list below shifts the species draw for existing
// seeds, because selection is floor(roll x len). That is a BREAKING change:
// bump oceanSchemaVersion and regenerate the goldens deliberately.
var fishSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyFishReefSchool, ModelKeyFishSilverside, ModelKeyFishBarracuda, ModelKeyFishRay},
	ZoneTwilightReach:  {ModelKeyFishSilverside, ModelKeyFishLanternfish, ModelKeyFishRay, ModelKeyFishHatchetfish},
	ZoneAbyss:          {ModelKeyFishLanternfish, ModelKeyFishHatchetfish},
}

var drifterSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyDrifterMoonJelly, ModelKeyDrifterCombJelly},
	ZoneTwilightReach:  {ModelKeyDrifterMoonJelly, ModelKeyDrifterSiphonophore, ModelKeyDrifterCombJelly},
	ZoneAbyss:          {ModelKeyDrifterSiphonophore, ModelKeyDrifterCombJelly},
}

var giantSpeciesByZone = map[string][]string{
	ZoneSunlitShallows: {ModelKeyGiantManta, ModelKeyGiantWhaleShark},
	ZoneTwilightReach:  {ModelKeyGiantHumpback, ModelKeyGiantManta},
	ZoneAbyss:          {ModelKeyGiantSpermWhale},
}

// A giant is a moment, not a fixture. It is rarer the deeper you go, because
// down there it is one animal in a very large volume rather than a herd on a
// reef.
var giantProbabilityByZone = map[string]float64{
	ZoneSunlitShallows: 0.45,
	ZoneTwilightReach:  0.35,
	ZoneAbyss:          0.22,
}

// Base active slot counts before the mood fauna multiplier; fractional so the
// multiplier has room to round up or down. The abyss is emptier of schools and
// fuller of drifters, which is what the deep actually looks like.
var baseSchoolSlotsByZone = map[string]float64{
	ZoneSunlitShallows: 2.8,
	ZoneTwilightReach:  2.0,
	ZoneAbyss:          1.0,
}

var baseDrifterSlotsByZone = map[string]float64{
	ZoneSunlitShallows: 1.0,
	ZoneTwilightReach:  1.8,
	ZoneAbyss:          2.0,
}

// Bioluminescence rises as sunlight falls — not because it is brighter down
// there, but because there is nothing else. Counts are for the plankton haze;
// the drifters carry their own emissive colour separately.
var basePlanktonCountByZone = map[string]int{
	ZoneSunlitShallows: 120,
	ZoneTwilightReach:  520,
	ZoneAbyss:          900,
}

var planktonCountSpreadByZone = map[string]int{
	ZoneSunlitShallows: 121,
	ZoneTwilightReach:  321,
	ZoneAbyss:          501,
}

// Emissive palettes per zone. Shallow bioluminescence is a faint green-white
// that daylight nearly hides; the abyss adds the blue-violet end, which is
// what actually travels furthest in seawater.
var bioluminescenceColorsByZone = map[string][]string{
	ZoneSunlitShallows: {"#8FF3D2", "#B6ECFF"},
	ZoneTwilightReach:  {"#5EEAD4", "#67E8F9", "#A78BFA"},
	ZoneAbyss:          {"#22D3EE", "#818CF8", "#4ADE80"},
}

// Flora keeps more of its own colour than rock does at the same depth, and
// less of it the deeper the zone.
var floraDepthTintBaseByZone = map[string]float64{
	ZoneSunlitShallows: 0.30,
	ZoneTwilightReach:  0.50,
	ZoneAbyss:          0.70,
}

// Per-zone colour grades — the ocean counterpart of the forest's per-season
// grade table. This USED TO BE a bare table lookup with no PRNG draw at all,
// flagged in its own comment as the one deliberately static spot in the whole
// builder: "two worlds in the same zone always grade identically." It is the
// base a small per-world jitter (see gradeHueJitterRange and friends) is now
// applied on top of, so the zone still reads as a coherent look and no two
// worlds in it are the same photograph.
var oceanGradesByZone = map[string]models.PostFXGradeConfig{
	ZoneSunlitShallows: {HueRadians: 0.02, Saturation: 0.14, Brightness: 0.02, Contrast: 0.05},
	ZoneTwilightReach:  {HueRadians: 0.04, Saturation: 0.05, Brightness: 0.03, Contrast: 0.08},
	ZoneAbyss:          {HueRadians: 0.06, Saturation: -0.10, Brightness: 0.06, Contrast: 0.12},
}

type floatRange struct {
	Minimum float64
	Maximum float64
}

// Numeric bounds for every seeded draw. Ranges are expressed as base + range
// so `base + roll*range` reads directly against this table.
const (
	// depth
	zoneTransitionProbability = 0.20
	minimumZoneBlendAmount    = 0.20
	zoneBlendAmountRange      = 0.40

	// lighting. The surface elevation is the angle daylight enters the water
	// at, not the sun's position in a sky this family does not have: it sets
	// the slant of the god rays and the stretch of the caustic pattern.
	//
	// 0.55-1.30 rad is 31.5-74.5 degrees, and for a world UNDER the water that
	// band is correct rather than conservative. Fresnel reflectance at the
	// air-water interface climbs steeply below about 20 degrees and Snell's
	// window narrows with it, so a low sun does not light a water column at all —
	// it bounces off the top of it. A 5-degree sun underwater is a black frame.
	minimumSurfaceElevation = 0.55
	surfaceElevationRange   = 0.75

	// ABOVE the waterline the same low sun is the best light there is, and the
	// premise above stops applying: nothing has to survive a trip through the
	// surface, so the only thing a shallow angle costs is height in the sky and
	// the only thing it buys is every warm colour the atmosphere makes.
	//
	// This is why the sun's band now depends on which medium the viewer is in.
	// The band was one number for both, so every ocean world was drawn at
	// midday — the renderer could draw a sunrise correctly and no world ever
	// asked it to. 0.06-0.70 rad is 3.4-40 degrees: golden hour at the bottom of
	// the band, mid-morning at the top.
	//
	// The roll is unchanged and comes from the same stream, so no underwater world
	// moves by a single digit. Only a breached one reads its roll into a different
	// band.
	minimumBreachedSurfaceElevation = 0.06
	breachedSurfaceElevationRange   = 0.64
	exposureJitterRange     = 0.10
	baseBloomIntensity      = 0.30
	bloomIntensityRange     = 0.55
	minimumBloomIntensity   = 0.25
	maximumBloomIntensity   = 1.40

	// Grade jitter, applied on top of oceanGradesByZone. Small relative to the
	// gap BETWEEN zones on every channel (saturation alone spans 0.24 across
	// the axis) — enough that two worlds in the same zone are not the same
	// photograph, not so much that a zone stops reading as a coherent look.
	gradeHueJitterRange        = 0.015
	gradeSaturationJitterRange = 0.03
	gradeBrightnessJitterRange = 0.015
	gradeContrastJitterRange   = 0.03

	// seafloor
	minimumBasinRadius         = 26.0
	basinRadiusRange           = 12.0
	minimumRidgeAmplitude      = 1.2
	ridgeAmplitudeRange        = 2.6
	minimumRidgeFrequency      = 0.02
	ridgeFrequencyRange        = 0.05
	minimumRockCount           = 10
	rockCountSpread            = 15 // Intn(15) -> 10..24
	minimumSedimentTuftCount   = 400
	sedimentTuftCountSpread    = 501 // 400..900
	mobileSedimentTuftFraction = 0.35
	minimumCameraDistance      = 16.0
	cameraDistanceRange        = 8.0
	oceanCameraFOV             = 55.0

	// current
	currentIntensityBase     = 0.30
	currentIntensityRange    = 0.55
	minimumCurrentIntensity  = 0.05
	maximumCurrentIntensity  = 1.00
	gustFrequencyBase        = 0.18
	gustFrequencyRange       = 0.34
	baseMarineSnowCount      = 900
	marineSnowCountSpread    = 901 // 900..1800
	mobileMarineSnowFraction = 0.30

	// flora
	baseFloraCount         = 90
	floraCountSpread       = 111 // 90..200 before the zone multiplier
	minimumFloraCount      = 40
	maximumFloraCount      = 260
	mobileFloraFraction    = 0.40
	floraScaleMinimumBase  = 0.70
	floraScaleMinimumRange = 0.20
	floraScaleMaximumBase  = 1.25
	floraScaleMaximumRange = 0.45
	swayStrengthBase       = 0.25
	swayStrengthRange      = 0.55
	minimumSwayStrength    = 0.05
	maximumSwayStrength    = 1.00
	floraDepthTintRange    = 0.25

	// fauna — slots are FIXED so the PRNG draw count never changes; the active
	// count only gates how many drawn slots are kept.
	maximumSchoolSlots  = 3
	maximumDrifterSlots = 2
	schoolCountBase     = 9
	schoolCountSpread   = 16 // 9..24 fish per school
	swimSpeedBase       = 0.35
	swimSpeedRange      = 0.55
	cohesionBase        = 0.45
	cohesionRange       = 0.40
	separationBase      = 0.25
	separationRange     = 0.35
	// Depth bands are metres ABOVE the seafloor, not absolute depths: a school
	// keeps its height over the floor as the floor rises and falls.
	schoolBandBase      = 1.5
	schoolBandBaseRange = 9.0
	schoolBandSpanBase  = 2.5
	schoolBandSpanRange = 5.0

	drifterCountBase   = 4
	drifterCountSpread = 9 // 4..12
	pulseRateBase      = 0.25
	pulseRateRange     = 0.45

	// A giant approaches to near the water's visibility limit and no closer,
	// which is what keeps it a silhouette arriving out of the fog.
	giantApproachFraction      = 0.80
	giantApproachFractionRange = 0.35
	giantPassDurationBase      = 22.0
	giantPassDurationRange     = 20.0

	// bioluminescence
	bioluminescenceBloomBase  = 0.20
	bioluminescenceBloomRange = 0.55

	// landmarks
	landmarkAngleJitterRadians  = 0.25
	// LANDMARKS ARE PLACED RELATIVE TO THE CAMERA, NOT TO THE BASIN.
	//
	// They used to be a fraction of the basin radius, 0.50 to 0.88. The basin is
	// 26 to 38 m, so the ring landed anywhere from 13 to 33 m out — and the camera
	// orbits at 16 to 24 m. The two ranges overlap almost completely, which means
	// a landmark standing exactly where the viewer does was not a rare accident
	// but the ordinary case, and a landmark at arm's length is not a landmark: it
	// is a flat pale slab filling the frame with no readable shape. On the
	// abyssal-plain fixture one came to rest 9.6 m from the lens and measured
	// three times the reference's brightness, which was first misread as a seabed
	// lighting fault.
	//
	// Tying the ring to the camera's own distance makes the collision impossible
	// by construction rather than unlikely by luck. 8 m of standoff is enough that
	// the nearest landmark reads as an object across a space; 26 m of ring depth
	// keeps the furthest inside the mid boulder band, so they still sit in a
	// landscape rather than out past its edge.
	landmarkCameraStandoffMetres = 8.0
	landmarkRingDepthMetres      = 26.0
	landmarkHeightBase          = 0.0
	landmarkHeightRange         = 6.0
)

// adjacentZone picks the zone above or below. Unlike the forest's seasons this
// does NOT wrap: the surface has nothing above it and the abyss nothing below,
// so a roll toward the outside of the stack falls back to the inside
// neighbour rather than teleporting a reef into the trench.
func adjacentZone(kind string, directionRoll float64) string {
	index := 0
	for i, zoneKind := range zoneKindsInOrder {
		if zoneKind == kind {
			index = i
			break
		}
	}
	if directionRoll < 0.5 {
		if index+1 < len(zoneKindsInOrder) {
			return zoneKindsInOrder[index+1]
		}
		return zoneKindsInOrder[index-1]
	}
	if index-1 >= 0 {
		return zoneKindsInOrder[index-1]
	}
	return zoneKindsInOrder[index+1]
}

func currentKindForRoll(roll float64, entries []weightedCurrentKind) string {
	total := 0.0
	for _, entry := range entries {
		total += entry.Weight
	}
	if total <= 0 || len(entries) == 0 {
		return CurrentDrift
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
