import { describe, expect, it } from "vitest";
import {
  FOREST_SPECIAL_ANIMAL_STREAM_SUFFIX,
  FOREST_SPECIAL_BIRD_STREAM_SUFFIX,
  RARITY_CATALOGUE,
  rarityFeature,
  rarityRolls,
  speciesForRoll
} from "./rarity";
import { resolveRareFeatures } from "@/features/scene-renderers/solar-system/rareFeatures";

const SAMPLE_SEED = "WLD-RARITYSEED";

describe("RARITY_CATALOGUE", () => {
  // The species is chosen by INDEX — floor(roll * length) — so this list is
  // not a set. Reordering it, or inserting a species anywhere but the end,
  // reassigns the species of every world ever generated, and nothing else in
  // the codebase would notice. Pinning the order here is the notice.
  it("pins the species order that past worlds were resolved against", () => {
    expect(rarityFeature("forest-special-bird").species?.map((species) => species.key)).toEqual([
      "firebird",
      "azure-macaw",
      "golden-eagle"
    ]);
    expect(rarityFeature("forest-special-animal").species?.map((species) => species.key)).toEqual([
      "white-stag",
      "golden-fox",
      "spirit-wolf",
      "verdant-stag"
    ]);
  });

  it("gives every feature its own stream", () => {
    const suffixes = RARITY_CATALOGUE.map((feature) => feature.seedSuffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it("keeps every probability rare but possible", () => {
    for (const feature of RARITY_CATALOGUE) {
      expect(feature.probability).toBeGreaterThan(0);
      expect(feature.probability).toBeLessThan(0.5);
    }
  });

  // The renderer starts from the terrain placementSeed, analytics from the
  // variant seed. If these two halves ever stop composing into the catalogue
  // suffix, the admin app reports a rate for a stream nobody rendered.
  it("composes the forest suffixes out of the halves the renderer uses", () => {
    expect(rarityFeature("forest-special-bird").seedSuffix).toBe(
      `-forest-terrain-scatter${FOREST_SPECIAL_BIRD_STREAM_SUFFIX}`
    );
    expect(rarityFeature("forest-special-animal").seedSuffix).toBe(
      `-forest-terrain-scatter${FOREST_SPECIAL_ANIMAL_STREAM_SUFFIX}`
    );
  });
});

describe("rarityRolls", () => {
  it("returns one draw per feature, in [0,1)", () => {
    const rolls = rarityRolls(SAMPLE_SEED);
    expect(rolls).toHaveLength(RARITY_CATALOGUE.length);
    for (const roll of rolls) {
      expect(roll.roll).toBeGreaterThanOrEqual(0);
      expect(roll.roll).toBeLessThan(1);
    }
  });

  it("draws a species only for the features that have one", () => {
    const bySeed = new Map(rarityRolls(SAMPLE_SEED).map((roll) => [roll.feature, roll]));
    expect(bySeed.get("black-hole")?.speciesRoll).toBeUndefined();
    expect(bySeed.get("forest-special-animal")?.speciesRoll).toBeDefined();
  });

  it("is a pure function of the seed", () => {
    expect(rarityRolls(SAMPLE_SEED)).toEqual(rarityRolls(SAMPLE_SEED));
  });

  // The whole point of the panel: what analytics replays must be what the
  // canvas drew. A renderer that changed its stream would show one thing on
  // screen and another on the dashboard, and only this test would say so.
  it("agrees with the renderer about which universe features a seed hit", () => {
    for (let index = 0; index < 200; index += 1) {
      const seed = `${SAMPLE_SEED}-${index}`;
      const replayed = rarityRolls(seed)
        .filter((roll) => {
          const feature = rarityFeature(roll.feature);
          return feature.family === "universe" && roll.roll < feature.probability;
        })
        .map((roll) => roll.feature);
      expect(replayed).toEqual(resolveRareFeatures(seed).map((feature) => feature.key));
    }
  });
});

describe("speciesForRoll", () => {
  it("picks by index across the whole unit interval", () => {
    const feature = rarityFeature("forest-special-animal");
    expect(speciesForRoll(feature, 0)?.key).toBe("white-stag");
    expect(speciesForRoll(feature, 0.26)?.key).toBe("golden-fox");
    expect(speciesForRoll(feature, 0.999)?.key).toBe("verdant-stag");
  });

  it("has nothing to pick for a feature without species", () => {
    expect(speciesForRoll(rarityFeature("black-hole"), 0.5)).toBeUndefined();
  });
});
