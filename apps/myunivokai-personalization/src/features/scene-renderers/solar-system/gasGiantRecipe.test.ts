import { describe, expect, it } from "vitest";
import {
  GAS_GIANT_BAND_COUNT_RANGE,
  GAS_GIANT_MAXIMUM_STORM_COUNT,
  GAS_GIANT_MINIMUM_BAND_COUNT,
  buildGasGiantRecipe,
  hexColorToHsl,
  hslToHexColor
} from "./gasGiantRecipe";

const SAMPLE_SEED = "test-world-seed-gas-giant-2";
const SAMPLE_BASE_COLOR = "#C4835A";
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const DETERMINISM_SAMPLE_SEED_COUNT = 50;

describe("buildGasGiantRecipe", () => {
  it("returns the identical recipe for the same seed and base color", () => {
    const firstRecipe = buildGasGiantRecipe(SAMPLE_SEED, SAMPLE_BASE_COLOR);
    const secondRecipe = buildGasGiantRecipe(SAMPLE_SEED, SAMPLE_BASE_COLOR);
    expect(secondRecipe).toEqual(firstRecipe);
  });

  it("returns different band colors for different seeds", () => {
    const firstRecipe = buildGasGiantRecipe(`${SAMPLE_SEED}-a`, SAMPLE_BASE_COLOR);
    const secondRecipe = buildGasGiantRecipe(`${SAMPLE_SEED}-b`, SAMPLE_BASE_COLOR);
    expect(secondRecipe.bandColorsHex).not.toEqual(firstRecipe.bandColorsHex);
  });

  it("keeps every sampled recipe inside its documented bounds", () => {
    for (let seedIndex = 0; seedIndex < DETERMINISM_SAMPLE_SEED_COUNT; seedIndex += 1) {
      const recipe = buildGasGiantRecipe(`${SAMPLE_SEED}-${seedIndex}`, SAMPLE_BASE_COLOR);
      expect(recipe.bandColorsHex.length).toBeGreaterThanOrEqual(GAS_GIANT_MINIMUM_BAND_COUNT);
      expect(recipe.bandColorsHex.length).toBeLessThanOrEqual(
        GAS_GIANT_MINIMUM_BAND_COUNT + GAS_GIANT_BAND_COUNT_RANGE
      );
      expect(recipe.storms.length).toBeLessThanOrEqual(GAS_GIANT_MAXIMUM_STORM_COUNT);
      for (const bandColorHex of recipe.bandColorsHex) {
        expect(bandColorHex).toMatch(HEX_COLOR_PATTERN);
      }
      for (const storm of recipe.storms) {
        expect(storm.colorHex).toMatch(HEX_COLOR_PATTERN);
        expect(storm.latitudeFraction).toBeGreaterThan(0);
        expect(storm.latitudeFraction).toBeLessThan(1);
        expect(storm.longitudeRadiusRadians).toBeGreaterThan(0);
        expect(storm.latitudeRadiusFraction).toBeGreaterThan(0);
      }
      expect(recipe.turbulenceBandUnits).toBeGreaterThan(0);
      expect(recipe.noiseFrequency).toBeGreaterThan(0);
      expect(recipe.noiseSeed).toContain(`${SAMPLE_SEED}-${seedIndex}`);
    }
  });
});

describe("hex/HSL color conversion", () => {
  it("round-trips saturated, gray and boundary colors", () => {
    for (const hexColor of ["#C4835A", "#808080", "#FF0000", "#000000", "#FFFFFF", "#123ABC"]) {
      expect(hslToHexColor(hexColorToHsl(hexColor))).toBe(hexColor);
    }
  });
});
