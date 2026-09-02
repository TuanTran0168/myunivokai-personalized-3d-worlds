import { describe, expect, it } from "vitest";
import { MOON_MAXIMUM_COUNT, buildMoonSystemRecipe } from "./moonRecipe";

const SAMPLE_SEED = "test-world-seed-moons-7";
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const BOUNDS_SAMPLE_SEED_COUNT = 50;
const COUNT_DISTRIBUTION_SAMPLE_SEED_COUNT = 200;
const UNIT_LENGTH_TOLERANCE = 1e-6;

describe("buildMoonSystemRecipe", () => {
  it("returns the identical recipe for the same seed", () => {
    const firstRecipe = buildMoonSystemRecipe(SAMPLE_SEED);
    const secondRecipe = buildMoonSystemRecipe(SAMPLE_SEED);
    expect(secondRecipe).toEqual(firstRecipe);
  });

  it("varies across different seeds", () => {
    const serializedRecipes = new Set(
      Array.from({ length: 30 }, (_, seedIndex) =>
        JSON.stringify(buildMoonSystemRecipe(`${SAMPLE_SEED}-variety-${seedIndex}`))
      )
    );
    expect(serializedRecipes.size).toBeGreaterThan(1);
  });

  it("keeps every sampled recipe inside its documented bounds", () => {
    for (let seedIndex = 0; seedIndex < BOUNDS_SAMPLE_SEED_COUNT; seedIndex += 1) {
      const moonSystemSeed = `${SAMPLE_SEED}-${seedIndex}`;
      const recipe = buildMoonSystemRecipe(moonSystemSeed);
      expect(recipe.moons.length).toBeLessThanOrEqual(MOON_MAXIMUM_COUNT);

      let previousOrbitRadiusRatio = 0;
      for (const moon of recipe.moons) {
        expect(moon.sizeRatio).toBeGreaterThan(0);
        expect(moon.sizeRatio).toBeLessThan(1);
        // Orbits clear the planet surface and never overlap each other.
        expect(moon.orbitRadiusRatio).toBeGreaterThan(1);
        expect(moon.orbitRadiusRatio).toBeGreaterThan(previousOrbitRadiusRatio);
        previousOrbitRadiusRatio = moon.orbitRadiusRatio;

        expect(moon.orbitSpeedRadiansPerSecond).toBeGreaterThan(0);
        expect(Math.abs(moon.orbitInclinationRadians)).toBeLessThan(Math.PI / 2);
        expect(moon.surfaceColorHex).toMatch(HEX_COLOR_PATTERN);
        expect(moon.displacementAmplitude).toBeGreaterThan(0);
        expect(moon.displacementAmplitude).toBeLessThan(0.2);
        expect(moon.surfaceNoiseSeed).toContain(moonSystemSeed);

        expect(moon.craters.length).toBeGreaterThanOrEqual(1);
        for (const crater of moon.craters) {
          const directionLength = Math.hypot(crater.directionX, crater.directionY, crater.directionZ);
          expect(Math.abs(directionLength - 1)).toBeLessThan(UNIT_LENGTH_TOLERANCE);
          expect(crater.angularRadiusRadians).toBeGreaterThan(0);
          expect(crater.angularRadiusRadians).toBeLessThan(Math.PI);
          expect(crater.depthFraction).toBeGreaterThan(0);
          expect(crater.depthFraction).toBeLessThan(0.2);
        }
      }
    }
  });

  it("rolls every moon count from zero to the maximum across many seeds", () => {
    const observedMoonCounts = new Set<number>();
    for (let seedIndex = 0; seedIndex < COUNT_DISTRIBUTION_SAMPLE_SEED_COUNT; seedIndex += 1) {
      observedMoonCounts.add(buildMoonSystemRecipe(`${SAMPLE_SEED}-distribution-${seedIndex}`).moons.length);
    }
    for (let moonCount = 0; moonCount <= MOON_MAXIMUM_COUNT; moonCount += 1) {
      expect(observedMoonCounts).toContain(moonCount);
    }
  });
});
