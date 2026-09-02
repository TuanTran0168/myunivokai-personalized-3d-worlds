package contracts

import (
	"math"
	"unicode/utf16"
)

// The rare-feature lottery, mirrored from the frontend.
//
// A rare feature — a black hole in a universe, a firebird crossing a forest —
// is not stored anywhere. The renderer re-derives it on every draw from the
// world's variant seed, which means "how often does a black hole ACTUALLY come
// up" is a question no table in this system can answer. Reading the configured
// 40% back out of a config file would not answer it either: that is what the
// generator was aimed at, not what it hit.
//
// This file replays the same draws over the seeds of real generated worlds, so
// the admin app can report the observed rate beside the configured one and
// show the worlds behind it. The source of truth is
// apps/myunivokai-personalization/src/lib/rarity.ts; this is the mirror. Neither compiler
// can see the other, so contracts/fixtures/rarity/rare-feature-rolls.v1.json
// pins them together and both suites assert against it.

// RaritySpecies is one variety of a feature that has them. Order is
// load-bearing — see RarityFeature.Species.
type RaritySpecies struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// RarityFeature is one lottery: a stream, a probability, and optionally a set
// of varieties chosen by a second draw on the same stream.
type RarityFeature struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Family is the only world family that can roll this at all. A forest
	// draws no black hole and a universe hosts no rare deer.
	Family      WorldFamily `json:"family"`
	Probability float64     `json:"probability"`
	// SeedSuffix is appended to the VARIANT seed to derive this feature's own
	// PRNG stream, so adding or re-tuning one feature can never shift another
	// feature's roll.
	SeedSuffix string `json:"seedSuffix"`
	// Species is non-empty when a second draw picks a variety. The species is
	// chosen by INDEX — floor(roll * len) — so this slice is an ordered list,
	// not a set: reordering it reassigns the species of every world already
	// generated.
	Species []RaritySpecies `json:"species,omitempty"`
}

// RarityCatalogue mirrors RARITY_CATALOGUE in the frontend, entry for entry.
//
// The forest suffixes carry `-forest-terrain-scatter` because ForestRenderer
// hands ForestWildlife the terrain's placementSeed as its "world seed", and
// nature-service builds that as `<variant seed>-forest-terrain-scatter`. That
// is an accident of plumbing rather than a decision, but it is the stream the
// rendered forests actually used, so it is the stream that has to be replayed.
var RarityCatalogue = []RarityFeature{
	{
		Key:         "meteor-shower",
		Label:       "Meteor Shower",
		Family:      WorldFamilyUniverse,
		Probability: 0.05,
		SeedSuffix:  "-rare-feature-meteor-shower",
	},
	{
		Key:         "binary-sun",
		Label:       "Binary Suns",
		Family:      WorldFamilyUniverse,
		Probability: 0.03,
		SeedSuffix:  "-rare-feature-binary-sun",
	},
	{
		Key:         "black-hole",
		Label:       "Black Hole",
		Family:      WorldFamilyUniverse,
		Probability: 0.4,
		SeedSuffix:  "-rare-feature-black-hole",
	},
	{
		Key:         "forest-special-bird",
		Label:       "Rare bird sighting",
		Family:      WorldFamilyNature,
		Probability: 0.35,
		SeedSuffix:  "-forest-terrain-scatter-forest-special-bird",
		Species: []RaritySpecies{
			{Key: "firebird", Label: "Firebird"},
			{Key: "azure-macaw", Label: "Azure Macaw"},
			{Key: "golden-eagle", Label: "Golden Raptor"},
		},
	},
	{
		Key:         "forest-special-animal",
		Label:       "Rare animal sighting",
		Family:      WorldFamilyNature,
		Probability: 0.4,
		SeedSuffix:  "-forest-terrain-scatter-forest-special-animal",
		Species: []RaritySpecies{
			{Key: "white-stag", Label: "White Stag"},
			{Key: "golden-fox", Label: "Golden Fox"},
			{Key: "spirit-wolf", Label: "Spirit Wolf"},
			{Key: "verdant-stag", Label: "Verdant Stag"},
		},
	},
	// The ocean suffixes are clean, unlike the forest pair above: OceanRenderer
	// receives the variant seed directly as SceneRendererProps.seed and does not
	// have to start from the middle of a placement-seed chain.
	{
		Key:         "ocean-bioluminescent-bloom",
		Label:       "Bioluminescent Bloom",
		Family:      WorldFamilyOcean,
		Probability: 0.35,
		SeedSuffix:  "-ocean-rare-bioluminescent-bloom",
	},
	{
		Key:         "ocean-sunken-relic",
		Label:       "Sunken Relic",
		Family:      WorldFamilyOcean,
		Probability: 0.2,
		SeedSuffix:  "-ocean-rare-sunken-relic",
	},
	{
		Key:         "ocean-whale-passage",
		Label:       "Whale Passage",
		Family:      WorldFamilyOcean,
		Probability: 0.12,
		SeedSuffix:  "-ocean-rare-whale-passage",
		Species: []RaritySpecies{
			{Key: "humpback", Label: "Humpback"},
			{Key: "blue-whale", Label: "Blue Whale"},
			{Key: "manta-parade", Label: "Manta Parade"},
		},
	},
	{
		// This list was the one decision the ocean plan deliberately deferred:
		// species are selected by floor(roll * len), so the ORDER is frozen the
		// moment the first world ships, and shipping a species the renderer
		// cannot draw is the one mistake here that cannot be undone cheaply.
		// It is settled now, against what the procedural ocean-1 catalogue
		// actually builds — all three are geometry, not a download that may
		// never arrive.
		Key:         "ocean-abyss-visitor",
		Label:       "Abyssal Visitor",
		Family:      WorldFamilyOcean,
		Probability: 0.05,
		SeedSuffix:  "-ocean-rare-abyss-visitor",
		Species: []RaritySpecies{
			{Key: "anglerfish", Label: "Anglerfish"},
			{Key: "giant-squid", Label: "Giant Squid"},
			{Key: "gulper-eel", Label: "Gulper Eel"},
		},
	},
}

// RarityFeatureByKey looks a feature up, reporting whether it exists rather
// than returning a zero value: an unknown key arriving from a query string is
// a filter that matches nothing, not a feature with probability zero.
func RarityFeatureByKey(key string) (RarityFeature, bool) {
	for _, feature := range RarityCatalogue {
		if feature.Key == key {
			return feature, true
		}
	}
	return RarityFeature{}, false
}

// RarityRoll is one feature's draws for one seed.
type RarityRoll struct {
	Feature string  `json:"feature"`
	Roll    float64 `json:"roll"`
	// SpeciesRoll is the second draw, taken only for features with species.
	SpeciesRoll *float64 `json:"speciesRoll,omitempty"`
}

// Hit reports whether this draw produced the feature at the given probability.
// The comparison is strictly less-than, matching the frontend's `random() <
// probability`, so a probability of 0 can never hit.
func (roll RarityRoll) Hit(probability float64) bool {
	return roll.Roll < probability
}

// SpeciesIndex is which variety a passing draw selected, or -1 when the
// feature has no varieties.
func (roll RarityRoll) SpeciesIndex(speciesCount int) int {
	if roll.SpeciesRoll == nil || speciesCount <= 0 {
		return -1
	}
	index := int(math.Floor(*roll.SpeciesRoll * float64(speciesCount)))
	if index >= speciesCount {
		return speciesCount - 1
	}
	return index
}

// RarityRollsFor replays every lottery a world of this family can enter.
//
// Raw draws rather than resolved features, deliberately: a draw depends only on
// the seed and stays true forever, while "did it hit" depends on a probability
// that gets re-tuned. Storing the draw means re-tuning a probability re-derives
// the whole of history instead of stranding it.
//
// An empty seed returns nothing at all. A world projected before the seed
// crossed the data boundary has no lottery to replay, and inventing one from
// the empty string would put a real draw against a world nobody can look up.
func RarityRollsFor(family WorldFamily, variantSeed string) []RarityRoll {
	if variantSeed == "" {
		return nil
	}
	rolls := make([]RarityRoll, 0, len(RarityCatalogue))
	for _, feature := range RarityCatalogue {
		if feature.Family != family {
			continue
		}
		rolls = append(rolls, RarityRollFor(feature, variantSeed))
	}
	return rolls
}

// RarityRollFor replays one feature's stream. It ignores the feature's family,
// so the golden fixture can check every entry against one seed the way the
// frontend generates it; RarityRollsFor above is the one that decides which
// lotteries a given world is actually in.
func RarityRollFor(feature RarityFeature, variantSeed string) RarityRoll {
	random := newRarityPRNG(variantSeed + feature.SeedSuffix)
	roll := RarityRoll{Feature: feature.Key, Roll: random.next()}
	if len(feature.Species) > 0 {
		// Taken unconditionally even though the renderer only reaches it after
		// the feature has hit. It is the same number either way: the stream is
		// freshly seeded, so the second value does not depend on what was done
		// with the first.
		speciesRoll := random.next()
		roll.SpeciesRoll = &speciesRoll
	}
	return roll
}

// rarityPRNG is a port of randomFromSeed in apps/myunivokai-personalization/src/lib/scene.ts:
// FNV-1a over the seed, then xorshift32, then a value in [0,1) quantised to
// ten-thousandths.
//
// uint32 throughout is what makes the port exact. JavaScript's bitwise
// operators coerce to int32 and `>>>` to uint32, so its state is signed
// between steps and unsigned at the end — but the BITS are identical to
// unsigned arithmetic at every step, and only the bits reach the output.
type rarityPRNG struct {
	state uint32
}

func newRarityPRNG(seed string) *rarityPRNG {
	state := rarityHashSeed(seed)
	// `hashSeed(seed) || 1` on the frontend: a state of zero is the xorshift's
	// fixed point and would return 0 forever.
	if state == 0 {
		state = 1
	}
	return &rarityPRNG{state: state}
}

func (prng *rarityPRNG) next() float64 {
	prng.state ^= prng.state << 13
	prng.state ^= prng.state >> 17
	prng.state ^= prng.state << 5
	return float64(prng.state%10000) / 10000
}

// rarityHashSeed iterates UTF-16 code units, not bytes, because the frontend
// walks the string with charCodeAt. Every seed this system generates is ASCII,
// where the two agree — but "every seed is ASCII" is an assumption about a
// value that arrives from another service, and the fixture covers a non-ASCII
// seed precisely so this stays a fact rather than a hope.
func rarityHashSeed(seed string) uint32 {
	hash := uint32(2166136261)
	for _, unit := range utf16.Encode([]rune(seed)) {
		hash ^= uint32(unit)
		hash *= 16777619
	}
	return hash
}
