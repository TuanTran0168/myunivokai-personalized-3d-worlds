package contracts

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

// The fixture is generated from the frontend's own lottery with
//
//	UPDATE_GOLDEN=1 npx vitest run src/lib/rarityGolden.test.ts
//
// in apps/myunivokai-personalization. It lives under fixtures/rarity/ rather than beside
// the events because schema_conformance_test.go globs ../fixtures/*.json and
// requires every match to be a valid event envelope, which this is not.
const rarityFixturePath = "../fixtures/rarity/rare-feature-rolls.v1.json"

type rarityGoldenFixture struct {
	Catalogue []struct {
		Key         string   `json:"key"`
		Family      string   `json:"family"`
		Probability float64  `json:"probability"`
		SeedSuffix  string   `json:"seedSuffix"`
		Species     []string `json:"species"`
	} `json:"catalogue"`
	Rolls []struct {
		VariantSeed string `json:"variantSeed"`
		Draws       []struct {
			Feature     string   `json:"feature"`
			Roll        float64  `json:"roll"`
			SpeciesRoll *float64 `json:"speciesRoll"`
		} `json:"draws"`
	} `json:"rolls"`
}

func loadRarityFixture(t *testing.T) rarityGoldenFixture {
	t.Helper()
	var fixture rarityGoldenFixture
	decoder := json.NewDecoder(bytes.NewReader(readFixture(t, rarityFixturePath)))
	// A field the frontend generator emits and this side never declared is
	// exactly the drift this fixture exists to catch.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatalf("decode rarity fixture: %v", err)
	}
	return fixture
}

// TestRarityCatalogueMatchesTheRenderer is the half of the contract that is
// about WHAT the lotteries are. A feature added on one side only, a re-tuned
// probability, or — the dangerous one — a reordered species list all land here.
func TestRarityCatalogueMatchesTheRenderer(t *testing.T) {
	fixture := loadRarityFixture(t)
	if len(fixture.Catalogue) != len(RarityCatalogue) {
		t.Fatalf("catalogue has %d features, the renderer has %d", len(RarityCatalogue), len(fixture.Catalogue))
	}
	for index, expected := range fixture.Catalogue {
		actual := RarityCatalogue[index]
		if actual.Key != expected.Key {
			t.Fatalf("feature %d: key %q, renderer has %q", index, actual.Key, expected.Key)
		}
		if string(actual.Family) != expected.Family {
			t.Fatalf("%s: family %q, renderer has %q", actual.Key, actual.Family, expected.Family)
		}
		if actual.Probability != expected.Probability {
			t.Fatalf("%s: probability %v, renderer has %v", actual.Key, actual.Probability, expected.Probability)
		}
		if actual.SeedSuffix != expected.SeedSuffix {
			t.Fatalf("%s: seed suffix %q, renderer has %q — this moves the lottery, not just its name", actual.Key, actual.SeedSuffix, expected.SeedSuffix)
		}
		if len(actual.Species) != len(expected.Species) {
			t.Fatalf("%s: %d species, renderer has %d", actual.Key, len(actual.Species), len(expected.Species))
		}
		for speciesIndex, expectedKey := range expected.Species {
			if actual.Species[speciesIndex].Key != expectedKey {
				t.Fatalf("%s: species %d is %q, renderer has %q — the species is chosen by index, so this reassigns every past world",
					actual.Key, speciesIndex, actual.Species[speciesIndex].Key, expectedKey)
			}
		}
	}
}

// TestRarityRollsMatchTheRenderer is the half that is about the ARITHMETIC:
// the FNV-1a hash, the xorshift order, the UTF-16 walk and the quantisation all
// have to agree to the last digit, or the dashboard reports a rate for worlds
// that rendered something else.
func TestRarityRollsMatchTheRenderer(t *testing.T) {
	fixture := loadRarityFixture(t)
	if len(fixture.Rolls) == 0 {
		t.Fatal("the rarity fixture records no seeds")
	}
	for _, seedCase := range fixture.Rolls {
		if len(seedCase.Draws) != len(RarityCatalogue) {
			t.Fatalf("seed %q: fixture has %d draws, the catalogue has %d features",
				seedCase.VariantSeed, len(seedCase.Draws), len(RarityCatalogue))
		}
		for index, expected := range seedCase.Draws {
			feature := RarityCatalogue[index]
			if feature.Key != expected.Feature {
				t.Fatalf("seed %q draw %d: catalogue has %q, fixture has %q", seedCase.VariantSeed, index, feature.Key, expected.Feature)
			}
			actual := RarityRollFor(feature, seedCase.VariantSeed)
			// Exact equality, not a tolerance: both sides quantise to
			// ten-thousandths and then divide, so every value is the same IEEE
			// double on both sides or the port is wrong.
			if actual.Roll != expected.Roll {
				t.Fatalf("seed %q %s: rolled %v, the renderer rolls %v", seedCase.VariantSeed, feature.Key, actual.Roll, expected.Roll)
			}
			switch {
			case expected.SpeciesRoll == nil && actual.SpeciesRoll != nil:
				t.Fatalf("seed %q %s: drew a species the renderer does not", seedCase.VariantSeed, feature.Key)
			case expected.SpeciesRoll != nil && actual.SpeciesRoll == nil:
				t.Fatalf("seed %q %s: drew no species where the renderer draws one", seedCase.VariantSeed, feature.Key)
			case expected.SpeciesRoll != nil && *actual.SpeciesRoll != *expected.SpeciesRoll:
				t.Fatalf("seed %q %s: species roll %v, the renderer rolls %v",
					seedCase.VariantSeed, feature.Key, *actual.SpeciesRoll, *expected.SpeciesRoll)
			}
		}
	}
}

// A world projected before the seed crossed the data boundary has no lottery to
// replay. Rolling the empty string would produce a perfectly valid-looking draw
// against a world whose rendered scene nobody can reconcile it with — so the
// panel's denominator must not include it.
func TestRarityRollsForRefusesASeedlessWorld(t *testing.T) {
	if rolls := RarityRollsFor(WorldFamilyUniverse, ""); rolls != nil {
		t.Fatalf("expected no rolls for an empty seed, got %d", len(rolls))
	}
}

func TestRarityRollsForStaysInsideItsFamily(t *testing.T) {
	for _, testCase := range []struct {
		family   WorldFamily
		expected int
	}{
		{WorldFamilyUniverse, 3},
		{WorldFamilyNature, 2},
		{WorldFamilyOcean, 4},
	} {
		rolls := RarityRollsFor(testCase.family, "WLD-ABC1234567")
		if len(rolls) != testCase.expected {
			t.Fatalf("%s: %d rolls, want %d", testCase.family, len(rolls), testCase.expected)
		}
		for _, roll := range rolls {
			feature, found := RarityFeatureByKey(roll.Feature)
			if !found {
				t.Fatalf("%s: rolled unknown feature %q", testCase.family, roll.Feature)
			}
			if feature.Family != testCase.family {
				t.Fatalf("%s: rolled %s, which belongs to %s", testCase.family, feature.Key, feature.Family)
			}
		}
	}
}

// The species index has to cover the whole unit interval and never fall off the
// end. A roll of exactly 1 is impossible from the PRNG (it quantises to at most
// 9999/10000), but the clamp is what makes that a fact of this function rather
// than a fact of its caller.
func TestSpeciesIndexCoversTheInterval(t *testing.T) {
	for _, testCase := range []struct {
		speciesRoll float64
		expected    int
	}{
		{0, 0},
		{0.26, 1},
		{0.5, 2},
		{0.9999, 3},
		{1, 3},
	} {
		roll := RarityRoll{Feature: "forest-special-animal", Roll: 0, SpeciesRoll: &testCase.speciesRoll}
		if index := roll.SpeciesIndex(4); index != testCase.expected {
			t.Fatalf("species roll %v selected index %d, want %d", testCase.speciesRoll, index, testCase.expected)
		}
	}
	noSpecies := RarityRoll{Feature: "black-hole", Roll: 0.1}
	if index := noSpecies.SpeciesIndex(0); index != -1 {
		t.Fatalf("a feature without species selected index %d, want -1", index)
	}
}

// Hit is strictly less-than, matching `random() < probability` on the frontend.
// The boundary is where an off-by-one comparison hides: a roll of exactly the
// probability must NOT hit, or a 0% feature would fire on every zero roll.
func TestHitIsStrictlyBelowTheProbability(t *testing.T) {
	if (RarityRoll{Roll: 0.4}).Hit(0.4) {
		t.Fatal("a roll equal to the probability must not hit")
	}
	if !(RarityRoll{Roll: 0.3999}).Hit(0.4) {
		t.Fatal("a roll below the probability must hit")
	}
	if (RarityRoll{Roll: 0}).Hit(0) {
		t.Fatal("a probability of zero must never hit")
	}
}

// The PRNG must never leave [0,1) — a value of 1 would push the species index
// past the end of the list, and a negative would index before the start.
func TestRarityRollsStayInTheUnitInterval(t *testing.T) {
	for index := 0; index < 2000; index++ {
		for _, feature := range RarityCatalogue {
			roll := RarityRollFor(feature, "WLD-RANGE"+string(rune('A'+index%26))+string(rune('0'+index%10)))
			if roll.Roll < 0 || roll.Roll >= 1 || math.IsNaN(roll.Roll) {
				t.Fatalf("%s rolled %v, which is outside [0,1)", feature.Key, roll.Roll)
			}
		}
	}
}
