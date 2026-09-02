import { randomFromSeed } from "@/lib/scene";

/**
 * Pure, deterministic "recipe" for a procedural gas giant surface: band
 * colors derived from the planet's DNA color, turbulence/detail amounts and
 * 0-2 storm ovals — all drawn from one seeded stream. The recipe is plain
 * data (no three.js, no canvas) so determinism is unit-testable; the actual
 * pixel bake lives in gasGiantTexture.ts.
 */

export const GAS_GIANT_MINIMUM_BAND_COUNT = 5;
export const GAS_GIANT_BAND_COUNT_RANGE = 4;
export const GAS_GIANT_MAXIMUM_STORM_COUNT = 2;

// How many band-widths the fBm turbulence can bend a stripe boundary.
const TURBULENCE_BAND_UNITS_MINIMUM = 0.35;
const TURBULENCE_BAND_UNITS_RANGE = 0.45;
const NOISE_FREQUENCY_MINIMUM = 1.5;
const NOISE_FREQUENCY_RANGE = 1.5;
// Strength of the high-frequency brightness streaks layered over the bands.
const DETAIL_STRENGTH_MINIMUM = 0.05;
const DETAIL_STRENGTH_RANGE = 0.06;
// Jupiter-style polar hoods: how much the poles darken relative to the equator.
const POLAR_DARKENING_MINIMUM = 0.12;
const POLAR_DARKENING_RANGE = 0.18;

// Band colors alternate lighter/darker around the planet's base color.
const BAND_LIGHTNESS_STEP_MINIMUM = 0.05;
const BAND_LIGHTNESS_STEP_RANGE = 0.08;
const BAND_LIGHTNESS_JITTER = 0.03;
const BAND_HUE_DRIFT = 0.03;
const BAND_SATURATION_MULTIPLIER_MINIMUM = 0.7;
const BAND_SATURATION_MULTIPLIER_RANGE = 0.5;
// Occasional cream-colored "zone" bands (Jupiter's bright zones).
const ZONE_BAND_PROBABILITY = 0.28;
const ZONE_BAND_SATURATION_MULTIPLIER = 0.25;
const ZONE_BAND_LIGHTNESS_MINIMUM = 0.64;
const ZONE_BAND_LIGHTNESS_RANGE = 0.08;
const BAND_SATURATION_CLAMP_MINIMUM = 0.08;
const BAND_SATURATION_CLAMP_MAXIMUM = 0.85;
const BAND_LIGHTNESS_CLAMP_MINIMUM = 0.18;
const BAND_LIGHTNESS_CLAMP_MAXIMUM = 0.74;

const STORM_COUNT_ZERO_PROBABILITY = 0.35;
const STORM_COUNT_ONE_PROBABILITY = 0.45;
// Storms stay away from the poles where the equirect projection pinches.
const STORM_LATITUDE_MINIMUM_FRACTION = 0.25;
const STORM_LATITUDE_RANGE_FRACTION = 0.5;
const STORM_LONGITUDE_RADIUS_MINIMUM_RADIANS = 0.15;
const STORM_LONGITUDE_RADIUS_RANGE_RADIANS = 0.25;
const STORM_LATITUDE_RADIUS_MINIMUM_FRACTION = 0.03;
const STORM_LATITUDE_RADIUS_RANGE_FRACTION = 0.03;
const STORM_HUE_DRIFT = 0.06;
const STORM_SATURATION_MINIMUM = 0.55;
const STORM_SATURATION_RANGE = 0.3;
const STORM_BRIGHT_LIGHTNESS = 0.62;
const STORM_DARK_LIGHTNESS = 0.28;
const STORM_BRIGHT_PROBABILITY = 0.5;

export type GasGiantStormRecipe = {
  longitudeRadians: number;
  /** 0 = north pole, 1 = south pole. */
  latitudeFraction: number;
  longitudeRadiusRadians: number;
  latitudeRadiusFraction: number;
  colorHex: string;
};

export type GasGiantRecipe = {
  noiseSeed: string;
  bandColorsHex: string[];
  turbulenceBandUnits: number;
  noiseFrequency: number;
  detailStrength: number;
  polarDarkening: number;
  storms: GasGiantStormRecipe[];
};

export type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapUnitFraction(value: number): number {
  return ((value % 1) + 1) % 1;
}

// Plain sRGB hex <-> HSL math, kept away from three.js Color on purpose:
// three's color management converts hex to the linear working space, which
// would double-convert once the baked canvas is tagged as an sRGB texture.
export function hexColorToHsl(hexColor: string): HslColor {
  const normalized = hexColor.replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const maximumChannel = Math.max(red, green, blue);
  const minimumChannel = Math.min(red, green, blue);
  const lightness = (maximumChannel + minimumChannel) / 2;
  const channelSpread = maximumChannel - minimumChannel;
  if (channelSpread === 0) {
    return { hue: 0, saturation: 0, lightness };
  }
  const saturation =
    lightness > 0.5 ? channelSpread / (2 - maximumChannel - minimumChannel) : channelSpread / (maximumChannel + minimumChannel);
  let hue: number;
  if (maximumChannel === red) {
    hue = ((green - blue) / channelSpread + (green < blue ? 6 : 0)) / 6;
  } else if (maximumChannel === green) {
    hue = ((blue - red) / channelSpread + 2) / 6;
  } else {
    hue = ((red - green) / channelSpread + 4) / 6;
  }
  return { hue, saturation, lightness };
}

function hueChannelValue(temporary1: number, temporary2: number, hueOffset: number): number {
  const wrappedHue = wrapUnitFraction(hueOffset);
  if (wrappedHue < 1 / 6) {
    return temporary1 + (temporary2 - temporary1) * 6 * wrappedHue;
  }
  if (wrappedHue < 1 / 2) {
    return temporary2;
  }
  if (wrappedHue < 2 / 3) {
    return temporary1 + (temporary2 - temporary1) * (2 / 3 - wrappedHue) * 6;
  }
  return temporary1;
}

export function hslToHexColor(hsl: HslColor): string {
  const saturation = clamp(hsl.saturation, 0, 1);
  const lightness = clamp(hsl.lightness, 0, 1);
  let red: number;
  let green: number;
  let blue: number;
  if (saturation === 0) {
    red = lightness;
    green = lightness;
    blue = lightness;
  } else {
    const temporary2 = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const temporary1 = 2 * lightness - temporary2;
    red = hueChannelValue(temporary1, temporary2, hsl.hue + 1 / 3);
    green = hueChannelValue(temporary1, temporary2, hsl.hue);
    blue = hueChannelValue(temporary1, temporary2, hsl.hue - 1 / 3);
  }
  const toHexPair = (channel: number) =>
    Math.round(clamp(channel, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHexPair(red)}${toHexPair(green)}${toHexPair(blue)}`.toUpperCase();
}

function buildStormRecipe(random: () => number, baseHsl: HslColor): GasGiantStormRecipe {
  const isBrightStorm = random() < STORM_BRIGHT_PROBABILITY;
  return {
    longitudeRadians: random() * Math.PI * 2,
    latitudeFraction: STORM_LATITUDE_MINIMUM_FRACTION + random() * STORM_LATITUDE_RANGE_FRACTION,
    longitudeRadiusRadians: STORM_LONGITUDE_RADIUS_MINIMUM_RADIANS + random() * STORM_LONGITUDE_RADIUS_RANGE_RADIANS,
    latitudeRadiusFraction: STORM_LATITUDE_RADIUS_MINIMUM_FRACTION + random() * STORM_LATITUDE_RADIUS_RANGE_FRACTION,
    colorHex: hslToHexColor({
      hue: wrapUnitFraction(baseHsl.hue + (random() * 2 - 1) * STORM_HUE_DRIFT),
      saturation: STORM_SATURATION_MINIMUM + random() * STORM_SATURATION_RANGE,
      lightness: isBrightStorm ? STORM_BRIGHT_LIGHTNESS : STORM_DARK_LIGHTNESS
    })
  };
}

/**
 * Derives the full band/storm recipe from one seeded stream. Same
 * (recipeSeed, baseColorHex) always returns the identical recipe.
 */
export function buildGasGiantRecipe(recipeSeed: string, baseColorHex: string): GasGiantRecipe {
  const random = randomFromSeed(`${recipeSeed}-recipe`);
  const baseHsl = hexColorToHsl(baseColorHex);

  const bandCount = GAS_GIANT_MINIMUM_BAND_COUNT + Math.floor(random() * (GAS_GIANT_BAND_COUNT_RANGE + 1));
  const lightnessStep = BAND_LIGHTNESS_STEP_MINIMUM + random() * BAND_LIGHTNESS_STEP_RANGE;

  const bandColorsHex: string[] = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const isZoneBand = random() < ZONE_BAND_PROBABILITY;
    const alternatingDirection = bandIndex % 2 === 0 ? 1 : -1;
    const hue = wrapUnitFraction(baseHsl.hue + (random() * 2 - 1) * BAND_HUE_DRIFT);
    let saturation = clamp(
      baseHsl.saturation * (BAND_SATURATION_MULTIPLIER_MINIMUM + random() * BAND_SATURATION_MULTIPLIER_RANGE),
      BAND_SATURATION_CLAMP_MINIMUM,
      BAND_SATURATION_CLAMP_MAXIMUM
    );
    let lightness = clamp(
      baseHsl.lightness + alternatingDirection * lightnessStep + (random() * 2 - 1) * BAND_LIGHTNESS_JITTER,
      BAND_LIGHTNESS_CLAMP_MINIMUM,
      BAND_LIGHTNESS_CLAMP_MAXIMUM
    );
    if (isZoneBand) {
      saturation *= ZONE_BAND_SATURATION_MULTIPLIER;
      lightness = ZONE_BAND_LIGHTNESS_MINIMUM + random() * ZONE_BAND_LIGHTNESS_RANGE;
    }
    bandColorsHex.push(hslToHexColor({ hue, saturation, lightness }));
  }

  const stormCountRoll = random();
  let stormCount = GAS_GIANT_MAXIMUM_STORM_COUNT;
  if (stormCountRoll < STORM_COUNT_ZERO_PROBABILITY) {
    stormCount = 0;
  } else if (stormCountRoll < STORM_COUNT_ZERO_PROBABILITY + STORM_COUNT_ONE_PROBABILITY) {
    stormCount = 1;
  }
  const storms = Array.from({ length: stormCount }, () => buildStormRecipe(random, baseHsl));

  return {
    noiseSeed: `${recipeSeed}-surface-noise`,
    bandColorsHex,
    turbulenceBandUnits: TURBULENCE_BAND_UNITS_MINIMUM + random() * TURBULENCE_BAND_UNITS_RANGE,
    noiseFrequency: NOISE_FREQUENCY_MINIMUM + random() * NOISE_FREQUENCY_RANGE,
    detailStrength: DETAIL_STRENGTH_MINIMUM + random() * DETAIL_STRENGTH_RANGE,
    polarDarkening: POLAR_DARKENING_MINIMUM + random() * POLAR_DARKENING_RANGE,
    storms
  };
}
