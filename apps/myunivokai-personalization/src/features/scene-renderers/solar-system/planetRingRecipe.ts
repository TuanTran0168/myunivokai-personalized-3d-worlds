import { randomFromSeed } from "@/lib/scene";
import { hexColorToHsl, hslToHexColor } from "./gasGiantRecipe";

/**
 * Pure recipe for a seeded procedural planet ring: radial band colors and
 * alphas (including Cassini-like gap divisions), radii and overall opacity,
 * all drawn from one dedicated PRNG stream. Colors derive from the planet's
 * DNA color, heavily desaturated so the ring reads as icy debris rather than
 * a solid color disc. The recipe knows nothing about three.js — baking lives
 * in planetRingTexture.ts — which keeps this module unit-testable in node.
 */

export const PLANET_RING_MINIMUM_BAND_COUNT = 12;
export const PLANET_RING_BAND_COUNT_RANGE = 12;

// A band rolls into a near-transparent gap with this probability — the dark
// divisions that make a ring read as concentric bands instead of a washer.
const RING_BAND_GAP_PROBABILITY = 0.22;
const RING_GAP_MINIMUM_ALPHA = 0.04;
const RING_GAP_ALPHA_RANGE = 0.1;
const RING_BAND_MINIMUM_ALPHA = 0.45;
const RING_BAND_ALPHA_RANGE = 0.45;

// Ring color family: the planet's hue, strongly desaturated, with per-band
// lightness variation and a whisper of hue drift.
const RING_SATURATION_MULTIPLIER_MINIMUM = 0.2;
const RING_SATURATION_MULTIPLIER_RANGE = 0.25;
const RING_MINIMUM_LIGHTNESS = 0.38;
const RING_LIGHTNESS_RANGE = 0.34;
const RING_HUE_MAXIMUM_DRIFT = 0.02;

// Radii in multiples of the planet's rendered size. The photo Saturn ring
// spans 1.35-2.2x; procedural rings roam a similar neighborhood.
const RING_INNER_RADIUS_MULTIPLIER_MINIMUM = 1.3;
const RING_INNER_RADIUS_MULTIPLIER_RANGE = 0.2;
const RING_OUTER_RADIUS_MULTIPLIER_MINIMUM = 1.9;
const RING_OUTER_RADIUS_MULTIPLIER_RANGE = 0.4;

const RING_MINIMUM_OPACITY = 0.5;
const RING_OPACITY_RANGE = 0.3;

export type PlanetRingRecipe = {
  /** One color per radial band, inner edge first. */
  bandColorsHex: string[];
  /** Per-band alpha, aligned with bandColorsHex; gaps sit near zero. */
  bandAlphas: number[];
  innerRadiusMultiplier: number;
  outerRadiusMultiplier: number;
  opacity: number;
};

function wrapHue(hue: number): number {
  return ((hue % 1) + 1) % 1;
}

export function buildPlanetRingRecipe(ringSeed: string, baseColorHex: string): PlanetRingRecipe {
  const random = randomFromSeed(`${ringSeed}-recipe`);
  const baseHsl = hexColorToHsl(baseColorHex);
  const ringSaturation =
    baseHsl.saturation * (RING_SATURATION_MULTIPLIER_MINIMUM + random() * RING_SATURATION_MULTIPLIER_RANGE);

  const bandCount = PLANET_RING_MINIMUM_BAND_COUNT + Math.floor(random() * (PLANET_RING_BAND_COUNT_RANGE + 1));
  const bandColorsHex: string[] = [];
  const bandAlphas: number[] = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    bandColorsHex.push(
      hslToHexColor({
        hue: wrapHue(baseHsl.hue + (random() * 2 - 1) * RING_HUE_MAXIMUM_DRIFT),
        saturation: ringSaturation,
        lightness: RING_MINIMUM_LIGHTNESS + random() * RING_LIGHTNESS_RANGE
      })
    );
    const isGapBand = random() < RING_BAND_GAP_PROBABILITY;
    bandAlphas.push(
      isGapBand
        ? RING_GAP_MINIMUM_ALPHA + random() * RING_GAP_ALPHA_RANGE
        : RING_BAND_MINIMUM_ALPHA + random() * RING_BAND_ALPHA_RANGE
    );
  }

  return {
    bandColorsHex,
    bandAlphas,
    innerRadiusMultiplier: RING_INNER_RADIUS_MULTIPLIER_MINIMUM + random() * RING_INNER_RADIUS_MULTIPLIER_RANGE,
    outerRadiusMultiplier: RING_OUTER_RADIUS_MULTIPLIER_MINIMUM + random() * RING_OUTER_RADIUS_MULTIPLIER_RANGE,
    opacity: RING_MINIMUM_OPACITY + random() * RING_OPACITY_RANGE
  };
}
