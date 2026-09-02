import { describe, expect, it } from "vitest";
import {
  PLANET_RING_BAND_COUNT_RANGE,
  PLANET_RING_MINIMUM_BAND_COUNT,
  buildPlanetRingRecipe
} from "./planetRingRecipe";

const SAMPLE_SEED = "test-world-seed-ring-4";
const SAMPLE_BASE_COLOR = "#7FB2E5";
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const BOUNDS_SAMPLE_SEED_COUNT = 50;
// Alphas below this read as a gap division; above the solid threshold they
// read as a filled band. Both must occur across the sample.
const GAP_ALPHA_THRESHOLD = 0.2;
const SOLID_ALPHA_THRESHOLD = 0.4;

describe("buildPlanetRingRecipe", () => {
  it("returns the identical recipe for the same seed and base color", () => {
    const firstRecipe = buildPlanetRingRecipe(SAMPLE_SEED, SAMPLE_BASE_COLOR);
    const secondRecipe = buildPlanetRingRecipe(SAMPLE_SEED, SAMPLE_BASE_COLOR);
    expect(secondRecipe).toEqual(firstRecipe);
  });

  it("varies across different seeds", () => {
    const serializedRecipes = new Set(
      Array.from({ length: 30 }, (_, seedIndex) =>
        JSON.stringify(buildPlanetRingRecipe(`${SAMPLE_SEED}-variety-${seedIndex}`, SAMPLE_BASE_COLOR))
      )
    );
    expect(serializedRecipes.size).toBeGreaterThan(1);
  });

  it("keeps every sampled recipe inside its documented bounds", () => {
    let sawGapBand = false;
    let sawSolidBand = false;
    for (let seedIndex = 0; seedIndex < BOUNDS_SAMPLE_SEED_COUNT; seedIndex += 1) {
      const recipe = buildPlanetRingRecipe(`${SAMPLE_SEED}-${seedIndex}`, SAMPLE_BASE_COLOR);

      expect(recipe.bandColorsHex.length).toBeGreaterThanOrEqual(PLANET_RING_MINIMUM_BAND_COUNT);
      expect(recipe.bandColorsHex.length).toBeLessThanOrEqual(
        PLANET_RING_MINIMUM_BAND_COUNT + PLANET_RING_BAND_COUNT_RANGE
      );
      expect(recipe.bandAlphas.length).toBe(recipe.bandColorsHex.length);

      for (const bandColorHex of recipe.bandColorsHex) {
        expect(bandColorHex).toMatch(HEX_COLOR_PATTERN);
      }
      for (const bandAlpha of recipe.bandAlphas) {
        expect(bandAlpha).toBeGreaterThanOrEqual(0);
        expect(bandAlpha).toBeLessThanOrEqual(1);
        if (bandAlpha < GAP_ALPHA_THRESHOLD) {
          sawGapBand = true;
        }
        if (bandAlpha > SOLID_ALPHA_THRESHOLD) {
          sawSolidBand = true;
        }
      }

      expect(recipe.innerRadiusMultiplier).toBeGreaterThan(1);
      expect(recipe.outerRadiusMultiplier).toBeGreaterThan(recipe.innerRadiusMultiplier);
      expect(recipe.opacity).toBeGreaterThan(0);
      expect(recipe.opacity).toBeLessThanOrEqual(1);
    }
    expect(sawGapBand).toBe(true);
    expect(sawSolidBand).toBe(true);
  });
});
