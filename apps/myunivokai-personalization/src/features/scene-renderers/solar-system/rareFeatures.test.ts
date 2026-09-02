import { describe, expect, it } from "vitest";
import { RARE_FEATURE_PROBABILITIES, hasRareFeature, resolveRareFeatures } from "./rareFeatures";

const SAMPLE_SEED = "test-world-seed-rare-9";
const FREQUENCY_SAMPLE_SEED_COUNT = 1000;
// Expected hits over 1000 seeds: meteor shower 5% -> 50 (sd ~6.9), binary sun
// 3% -> 30 (sd ~5.4). Ranges span beyond +-3.5 standard deviations, so a
// healthy PRNG passes deterministically while a broken roll (0%, 100%, or a
// heavily biased stream) still fails loudly.
const METEOR_SHOWER_MINIMUM_HITS = 25;
const METEOR_SHOWER_MAXIMUM_HITS = 80;
const BINARY_SUN_MINIMUM_HITS = 10;
const BINARY_SUN_MAXIMUM_HITS = 55;

describe("RARE_FEATURE_PROBABILITIES", () => {
  // Upper bound walked 0.2 -> 0.25 -> 0.5 (owner decisions): the black hole is
  // the showpiece and is now deliberately tuned to 40% so it is easy to find
  // while the scene is being iterated on. The bound still guards the real
  // invariant — a "rare" feature must never be the MAJORITY case.
  it("keeps every probability rare but possible", () => {
    for (const definition of RARE_FEATURE_PROBABILITIES) {
      expect(definition.probability).toBeGreaterThan(0);
      expect(definition.probability).toBeLessThan(0.5);
      expect(definition.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveRareFeatures", () => {
  it("returns identical features for the same seed", () => {
    const firstResolution = resolveRareFeatures(SAMPLE_SEED);
    const secondResolution = resolveRareFeatures(SAMPLE_SEED);
    expect(secondResolution).toEqual(firstResolution);
  });

  it("only ever returns defined feature keys", () => {
    const definedKeys = new Set(RARE_FEATURE_PROBABILITIES.map((definition) => definition.key));
    for (let seedIndex = 0; seedIndex < 100; seedIndex += 1) {
      for (const feature of resolveRareFeatures(`${SAMPLE_SEED}-${seedIndex}`)) {
        expect(definedKeys.has(feature.key)).toBe(true);
      }
    }
  });

  it("keeps observed frequencies near the configured probabilities", () => {
    let meteorShowerHits = 0;
    let binarySunHits = 0;
    for (let seedIndex = 0; seedIndex < FREQUENCY_SAMPLE_SEED_COUNT; seedIndex += 1) {
      const rareFeatures = resolveRareFeatures(`rare-frequency-seed-${seedIndex}`);
      if (hasRareFeature(rareFeatures, "meteor-shower")) {
        meteorShowerHits += 1;
      }
      if (hasRareFeature(rareFeatures, "binary-sun")) {
        binarySunHits += 1;
      }
    }
    expect(meteorShowerHits).toBeGreaterThanOrEqual(METEOR_SHOWER_MINIMUM_HITS);
    expect(meteorShowerHits).toBeLessThanOrEqual(METEOR_SHOWER_MAXIMUM_HITS);
    expect(binarySunHits).toBeGreaterThanOrEqual(BINARY_SUN_MINIMUM_HITS);
    expect(binarySunHits).toBeLessThanOrEqual(BINARY_SUN_MAXIMUM_HITS);
  });
});
