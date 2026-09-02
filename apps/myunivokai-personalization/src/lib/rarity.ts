import { randomFromSeed } from "./scene";

/**
 * Every seeded rarity lottery in the app, in one table.
 *
 * A rare feature is not stored anywhere: it is re-derived on every render from
 * the variant seed, so "how often does a black hole actually come up" has no
 * answer in any database. This table is what makes the question answerable —
 * analytics-service mirrors it in Go (contracts/go/contracts_rarity.go) and
 * replays the same draws over the seeds of real generated worlds.
 *
 * The two sides are pinned to each other by
 * contracts/fixtures/rare-feature-rolls.v1.json, generated from THIS file and
 * asserted by both suites. A probability may be re-tuned freely — the fixture
 * records raw draws, which do not depend on it — but a changed seed suffix or a
 * reordered species list moves the lottery itself and will fail there.
 *
 * WHY THE SUFFIXES LOOK LIKE THAT: each feature draws from its own stream
 * (`<seed><suffix>`) so adding or removing one can never shift another's roll.
 * The forest pair carries `-forest-terrain-scatter` because ForestRenderer
 * hands ForestWildlife the terrain's placementSeed as its "world seed", and
 * nature-service builds that as `<variant seed>-forest-terrain-scatter`. That
 * is an accident of plumbing rather than a decision, but it is the stream the
 * rendered forests actually used, so it is the stream that has to be replayed.
 */

export type RarityFamily = "universe" | "nature" | "ocean";

export type RaritySpecies = {
  key: string;
  label: string;
};

export type RarityFeature = {
  key: string;
  label: string;
  /** Which world family can roll this at all. */
  family: RarityFamily;
  probability: number;
  /** Appended to the VARIANT seed to derive this feature's own PRNG stream. */
  seedSuffix: string;
  /**
   * Present when a SECOND draw from the same stream picks one of these. Order
   * is load-bearing: the species is `floor(roll * species.length)`, so
   * reordering this list silently reassigns every past world's species.
   */
  species?: RaritySpecies[];
};

// The forest wildlife lotteries hang off the terrain's placementSeed, which
// ForestRenderer already holds and passes down as its "world seed". These two
// halves are exported separately because the renderer starts from the middle
// of the chain and analytics starts from the variant seed at the top of it —
// one literal each, rather than the same string typed in two files.
const FOREST_WILDLIFE_STREAM_PREFIX = "-forest-terrain-scatter";
export const FOREST_SPECIAL_BIRD_STREAM_SUFFIX = "-forest-special-bird";
export const FOREST_SPECIAL_ANIMAL_STREAM_SUFFIX = "-forest-special-animal";

// The ocean lotteries hang off the VARIANT seed itself, with no prefix chain:
// OceanRenderer receives it as SceneRendererProps.seed, so the accident that
// forced the forest pair to start halfway down a placement seed does not repeat
// here. Exported so the renderer and the catalogue share one literal each.
export const OCEAN_BIOLUMINESCENT_BLOOM_STREAM_SUFFIX = "-ocean-rare-bioluminescent-bloom";
export const OCEAN_SUNKEN_RELIC_STREAM_SUFFIX = "-ocean-rare-sunken-relic";
export const OCEAN_WHALE_PASSAGE_STREAM_SUFFIX = "-ocean-rare-whale-passage";
export const OCEAN_ABYSS_VISITOR_STREAM_SUFFIX = "-ocean-rare-abyss-visitor";

export const RARITY_CATALOGUE: readonly RarityFeature[] = [
  {
    key: "meteor-shower",
    label: "Meteor Shower",
    family: "universe",
    probability: 0.05,
    seedSuffix: "-rare-feature-meteor-shower"
  },
  {
    key: "binary-sun",
    label: "Binary Suns",
    family: "universe",
    probability: 0.03,
    seedSuffix: "-rare-feature-binary-sun"
  },
  {
    // Deliberately the loudest of the three: it is the most spectacular
    // feature and the owner wants it findable while tuning the scene, not a
    // true rarity.
    key: "black-hole",
    label: "Black Hole",
    family: "universe",
    probability: 0.4,
    seedSuffix: "-rare-feature-black-hole"
  },
  {
    key: "forest-special-bird",
    label: "Rare bird sighting",
    family: "nature",
    probability: 0.35,
    seedSuffix: `${FOREST_WILDLIFE_STREAM_PREFIX}${FOREST_SPECIAL_BIRD_STREAM_SUFFIX}`,
    species: [
      { key: "firebird", label: "Firebird" },
      { key: "azure-macaw", label: "Azure Macaw" },
      { key: "golden-eagle", label: "Golden Raptor" }
    ]
  },
  {
    key: "forest-special-animal",
    label: "Rare animal sighting",
    family: "nature",
    probability: 0.4,
    seedSuffix: `${FOREST_WILDLIFE_STREAM_PREFIX}${FOREST_SPECIAL_ANIMAL_STREAM_SUFFIX}`,
    species: [
      { key: "white-stag", label: "White Stag" },
      { key: "golden-fox", label: "Golden Fox" },
      { key: "spirit-wolf", label: "Spirit Wolf" },
      { key: "verdant-stag", label: "Verdant Stag" }
    ]
  },
  // The ocean suffixes are clean, unlike the forest pair above: OceanRenderer
  // receives the variant seed directly as SceneRendererProps.seed and does not
  // have to start from the middle of a placement-seed chain.
  {
    key: "ocean-bioluminescent-bloom",
    label: "Bioluminescent Bloom",
    family: "ocean",
    probability: 0.35,
    seedSuffix: OCEAN_BIOLUMINESCENT_BLOOM_STREAM_SUFFIX
  },
  {
    key: "ocean-sunken-relic",
    label: "Sunken Relic",
    family: "ocean",
    probability: 0.2,
    seedSuffix: OCEAN_SUNKEN_RELIC_STREAM_SUFFIX
  },
  {
    key: "ocean-whale-passage",
    label: "Whale Passage",
    family: "ocean",
    probability: 0.12,
    seedSuffix: OCEAN_WHALE_PASSAGE_STREAM_SUFFIX,
    species: [
      { key: "humpback", label: "Humpback" },
      { key: "blue-whale", label: "Blue Whale" },
      { key: "manta-parade", label: "Manta Parade" }
    ]
  },
  {
    // This list was the one decision the ocean plan deliberately deferred:
    // species are selected by floor(roll * species.length), so the ORDER is
    // frozen the moment the first world ships, and shipping a species the
    // renderer cannot draw is the one mistake here that cannot be undone
    // cheaply. It is settled against what the procedural ocean-1 catalogue
    // actually builds — all three are geometry, not a download that may never
    // arrive.
    key: "ocean-abyss-visitor",
    label: "Abyssal Visitor",
    family: "ocean",
    probability: 0.05,
    seedSuffix: OCEAN_ABYSS_VISITOR_STREAM_SUFFIX,
    species: [
      { key: "anglerfish", label: "Anglerfish" },
      { key: "giant-squid", label: "Giant Squid" },
      { key: "gulper-eel", label: "Gulper Eel" }
    ]
  }
];

export function rarityFeature(key: string): RarityFeature {
  const feature = RARITY_CATALOGUE.find((entry) => entry.key === key);
  if (!feature) {
    throw new Error(`unknown rarity feature ${key}`);
  }
  return feature;
}

export type RarityRoll = {
  feature: string;
  /** The first draw. The feature is present when this is below its probability. */
  roll: number;
  /** The second draw, present only for features with species. */
  speciesRoll?: number;
};

/**
 * Replays every lottery for one variant seed and returns the raw draws.
 *
 * Raw draws rather than resolved features on purpose: a draw depends only on
 * the seed, so it stays true forever, while "did it hit" depends on a
 * probability that gets re-tuned. Storing the draw means re-tuning a
 * probability re-derives the whole of history instead of stranding it.
 *
 * The species draw is taken unconditionally even though the renderer only
 * reaches it after the feature has hit. That is the same number either way —
 * the stream is freshly seeded here, so the second value does not depend on
 * what was done with the first.
 */
export function rarityRolls(variantSeed: string): RarityRoll[] {
  return RARITY_CATALOGUE.map((feature) => {
    const nextRandomValue = randomFromSeed(variantSeed + feature.seedSuffix);
    const roll = nextRandomValue();
    if (!feature.species) {
      return { feature: feature.key, roll };
    }
    return { feature: feature.key, roll, speciesRoll: nextRandomValue() };
  });
}

/** The species a passing second draw selects, or undefined if the feature has none. */
export function speciesForRoll(feature: RarityFeature, speciesRoll: number | undefined): RaritySpecies | undefined {
  if (!feature.species || speciesRoll === undefined) {
    return undefined;
  }
  return feature.species[Math.floor(speciesRoll * feature.species.length)] ?? feature.species[0];
}
