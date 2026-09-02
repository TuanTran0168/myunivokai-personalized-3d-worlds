import { describe, expect, it } from "vitest";
import { randomFromSeed } from "@/lib/scene";
import {
  beaufort,
  buildSeaState,
  foamFoldThreshold,
  peakWavelengthMetres,
  significantWaveHeightMetres,
  whitecapFraction,
} from "./oceanSeaState";

describe("sea state from wind speed", () => {
  it("matches the Beaufort scale's own wave heights", () => {
    // WMO gives roughly 1-1.5 m at force 4, 2.5-4 m at force 6 and 5.5-7.5 m at
    // force 8. These are Pierson-Moskowitz, so they are the fully developed end
    // of each band.
    expect(significantWaveHeightMetres(7)).toBeGreaterThan(0.8);
    expect(significantWaveHeightMetres(7)).toBeLessThan(1.6);
    expect(significantWaveHeightMetres(12)).toBeGreaterThan(2.5);
    expect(significantWaveHeightMetres(12)).toBeLessThan(4.0);
    expect(significantWaveHeightMetres(19)).toBeGreaterThan(6.5);
    expect(significantWaveHeightMetres(19)).toBeLessThan(9.0);
  });

  it("names the force the way a forecast does", () => {
    expect(beaufort(0.2).force).toBe(0);
    expect(beaufort(7).force).toBe(4);
    expect(beaufort(12).force).toBe(6);
    expect(beaufort(30).name).toBe("Storm");
  });

  it("grows the peak wavelength with the wind", () => {
    expect(peakWavelengthMetres(5)).toBeLessThan(peakWavelengthMetres(10));
    expect(peakWavelengthMetres(10)).toBeLessThan(peakWavelengthMetres(20));
    // A 10 m/s wind raises a fully developed sea with roughly a 90 m peak.
    expect(peakWavelengthMetres(10)).toBeGreaterThan(70);
    expect(peakWavelengthMetres(10)).toBeLessThan(120);
  });

  it("puts about one percent of the surface under whitecaps at ten metres a second", () => {
    // Monahan & O'Muircheartaigh 1980.
    expect(whitecapFraction(10)).toBeGreaterThan(0.005);
    expect(whitecapFraction(10)).toBeLessThan(0.02);
    expect(whitecapFraction(0)).toBe(0);
    expect(whitecapFraction(20)).toBeGreaterThan(whitecapFraction(15));
  });

  it("keeps the promise its wave height makes", () => {
    // A spectrum sampled at twelve points does not carry its own variance
    // faithfully, so the components are rescaled until Hs comes out exactly.
    for (const wind of [3, 7.5, 12, 18]) {
      const sea = buildSeaState({
        windSpeedMps: wind,
        windDirectionRadians: 0.5,
        random: randomFromSeed("wave-test"),
      });
      const variance = sea.components.reduce(
        (sum, wave) => sum + (wave.amplitude * wave.amplitude) / 2,
        0,
      );
      expect(4 * Math.sqrt(variance)).toBeCloseTo(significantWaveHeightMetres(wind), 6);
    }
  });

  it("never lets Gerstner tie knots", () => {
    // Past Q * sum(A k) = 1 the surface self-intersects. The safety factor is
    // 0.72, so the product must never reach 1.
    for (const wind of [1, 6, 12, 24]) {
      const sea = buildSeaState({
        windSpeedMps: wind,
        windDirectionRadians: 0,
        random: randomFromSeed("knot-test"),
      });
      const steepness = sea.components.reduce(
        (sum, wave) => sum + wave.amplitude * wave.wavenumber,
        0,
      );
      expect(sea.choppiness * steepness).toBeLessThanOrEqual(0.7201);
    }
  });

  it("is deterministic from its seed", () => {
    const first = buildSeaState({
      windSpeedMps: 9,
      windDirectionRadians: 1.1,
      random: randomFromSeed("same-world"),
    });
    const second = buildSeaState({
      windSpeedMps: 9,
      windDirectionRadians: 1.1,
      random: randomFromSeed("same-world"),
    });
    expect(first.components).toEqual(second.components);
  });

  it("spreads the components in direction, or the sea is corrugated fabric", () => {
    const sea = buildSeaState({
      windSpeedMps: 10,
      windDirectionRadians: 0,
      random: randomFromSeed("spread-test"),
    });
    const directions = sea.components.map((wave) => wave.direction);
    expect(Math.max(...directions) - Math.min(...directions)).toBeGreaterThan(0.3);
  });

  it("opens the foam threshold as the sea whitens", () => {
    expect(foamFoldThreshold(whitecapFraction(4))).toBeLessThan(
      foamFoldThreshold(whitecapFraction(16)),
    );
  });
});
