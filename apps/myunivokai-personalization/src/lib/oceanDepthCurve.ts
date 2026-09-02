/**
 * The depth curve, in TypeScript.
 *
 * This is the SECOND implementation of it. The first is
 * services/ocean-service/internal/services/depth_curve.go, and the two have no
 * compiler between them — exactly the drift risk the rarity catalogue has
 * between Go and TypeScript, and it gets the same treatment: the Go builder's
 * committed golden fixtures are replayed against this file by
 * oceanDepthCurve.test.ts, so the two cannot diverge without a red test.
 *
 * It exists because the create form renders a live WebGL preview BEFORE
 * anything is generated, from a client-side mirror of the backend builder. A
 * preview whose water was a different colour from the world it promises would
 * be worse than no preview.
 *
 * # Why this is not a single exponential
 *
 * Beer-Lambert with one coefficient does not fit measured seawater. Anchoring
 * it on the 1 m value gives k = 0.80/m, which predicts 0.03% of surface light
 * at 10 m against a measured 16% — wrong by three orders of magnitude. The
 * attenuation coefficient itself FALLS with depth, because by then the strongly
 * absorbed wavelengths are already gone. So the curve is monotone
 * piecewise-exponential between measured anchors.
 */

/**
 * Where downwelling sunlight stops being a light source at all. Also the top of
 * the abyss zone, which is what makes "the abyss has no caustics" a consequence
 * of the physics rather than a rule somebody has to remember.
 */
export const SUNLIGHT_FLOOR_METRES = 1000;

/** Challenger Deep, rounded. Depths outside [0, this] clamp, never extrapolate. */
export const MAXIMUM_DEPTH_METRES = 11000;

type LightAnchor = {
  metres: number;
  fraction: number;
};

/**
 * Measured fractions of just-below-surface downwelling irradiance. Must stay
 * sorted by depth and strictly decreasing in fraction.
 */
const LIGHT_ANCHORS: readonly LightAnchor[] = [
  { metres: 0, fraction: 1.0 },
  { metres: 1, fraction: 0.45 },
  { metres: 10, fraction: 0.16 },
  { metres: 40, fraction: 0.05 },
  { metres: 100, fraction: 0.01 }
];

// Per-wavelength death depths. Red/orange/yellow are the measured ones; green
// and blue are extended to the visually meaningful limits.
export const RED_DEATH_METRES = 10;
export const ORANGE_DEATH_METRES = 40;
export const YELLOW_DEATH_METRES = 100;
const GREEN_DEATH_METRES = 250;
const BLUE_DEATH_METRES = SUNLIGHT_FLOOR_METRES;

export type SpectralSurvival = {
  red: number;
  orange: number;
  yellow: number;
  green: number;
  blue: number;
};

export type DepthResponse = {
  lightFraction: number;
  brightness: number;
  spectral: SpectralSurvival;
  fogColor: string;
  fogDensity: number;
  visibilityMetres: number;
  tintStrength: number;
  surfaceLightColor: string;
  ambientColor: string;
  godRayStrength: number;
  causticStrength: number;
  baseExposure: number;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

// The only hand-picked colours in the family's lighting. Everything else is
// this trio put through the physics above.
const CLEAR_WATER_COLOR: RgbColor = { red: 0.55, green: 0.86, blue: 0.92 };
const ABYSSAL_FLOOR_COLOR: RgbColor = { red: 0.012, green: 0.035, blue: 0.078 };
const SURFACE_SUN_COLOR: RgbColor = { red: 1.0, green: 0.97, blue: 0.9 };
// Legibility floors, stated as such: physics puts the directional key at zero
// below the sunlight floor, and a scene with no key light loses the shape of
// everything in it.
const KEY_LIGHT_FLOOR_COLOR: RgbColor = { red: 0.06, green: 0.12, blue: 0.2 };
const AMBIENT_FLOOR_COLOR: RgbColor = { red: 0.02, green: 0.05, blue: 0.09 };

const BRIGHTNESS_COMPRESSION = 0.3;
// Mirrors minimumVisibilityMetres / visibilityMetresRange in depth_curve.go.
// Raised once the fog was actually connected to the scene: at the old 38 m
// ceiling, a basin 36 m across was 46% hazed through its middle, which is not
// what clear tropical water looks like. Clear ocean runs 30-80 m horizontally.
const MINIMUM_VISIBILITY_METRES = 14;
const VISIBILITY_METRES_RANGE = 76;
const MINIMUM_TINT_STRENGTH = 0.15;
const MAXIMUM_TINT_STRENGTH = 0.95;
// Renderer parameters in 0..1, not irradiances: the physics owns the shape of
// the falloff and where it hits zero, the gain owns only how strongly the
// renderer expresses what is left.
const GOD_RAY_GAIN = 4.0;
const CAUSTIC_GAIN = 3.2;
const BASE_EXPOSURE_AT_SURFACE = 1.0;
const EXPOSURE_DEPTH_GAIN = 0.35;

export function clampNumber(value: number, minimum: number, maximum: number): number {
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
}

/** Mirrors round() in ocean_config_builder.go — two decimals. */
export function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mirrors roundToThousandths() in ocean_config_builder.go. */
export function roundToThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function scaleColor(color: RgbColor, factor: number): RgbColor {
  return { red: color.red * factor, green: color.green * factor, blue: color.blue * factor };
}

function multiplyColor(color: RgbColor, other: RgbColor): RgbColor {
  return { red: color.red * other.red, green: color.green * other.green, blue: color.blue * other.blue };
}

function addColor(color: RgbColor, other: RgbColor): RgbColor {
  return { red: color.red + other.red, green: color.green + other.green, blue: color.blue + other.blue };
}

/** A per-channel floor, so a floor can never darken a channel already above it. */
function maximumColor(color: RgbColor, other: RgbColor): RgbColor {
  return {
    red: Math.max(color.red, other.red),
    green: Math.max(color.green, other.green),
    blue: Math.max(color.blue, other.blue)
  };
}

function colorChannelByte(value: number): number {
  return Math.round(clampNumber(value, 0, 1) * 255);
}

function colorToHex(color: RgbColor): string {
  const channels = [colorChannelByte(color.red), colorChannelByte(color.green), colorChannelByte(color.blue)];
  return `#${channels.map((channel) => channel.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
}

function smoothstep(t: number): number {
  const clamped = clampNumber(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function bandSurvival(depth: number, deathMetres: number): number {
  if (depth >= deathMetres) {
    return 0;
  }
  if (depth <= 0) {
    return 1;
  }
  return 1 - smoothstep(depth / deathMetres);
}

export function spectralSurvivalAtDepth(depth: number): SpectralSurvival {
  return {
    red: bandSurvival(depth, RED_DEATH_METRES),
    orange: bandSurvival(depth, ORANGE_DEATH_METRES),
    yellow: bandSurvival(depth, YELLOW_DEATH_METRES),
    green: bandSurvival(depth, GREEN_DEATH_METRES),
    blue: bandSurvival(depth, BLUE_DEATH_METRES)
  };
}

/**
 * Five bands onto three channels. A display's red channel carries orange energy
 * as well as red, and its green channel carries yellow, so each channel is a
 * weighted mix rather than a single band.
 */
function spectralAsRgbMultiplier(survival: SpectralSurvival): RgbColor {
  return {
    red: 0.65 * survival.red + 0.35 * survival.orange,
    green: 0.45 * survival.yellow + 0.55 * survival.green,
    blue: survival.blue
  };
}

export function lightFractionAtDepth(depth: number): number {
  if (depth <= 0) {
    return 1;
  }
  for (let index = 1; index < LIGHT_ANCHORS.length; index += 1) {
    const previous = LIGHT_ANCHORS[index - 1];
    const current = LIGHT_ANCHORS[index];
    if (depth <= current.metres) {
      const coefficient = Math.log(previous.fraction / current.fraction) / (current.metres - previous.metres);
      return previous.fraction * Math.exp(-coefficient * (depth - previous.metres));
    }
  }
  if (depth >= SUNLIGHT_FLOOR_METRES) {
    return 0;
  }
  const last = LIGHT_ANCHORS[LIGHT_ANCHORS.length - 1];
  const previous = LIGHT_ANCHORS[LIGHT_ANCHORS.length - 2];
  const coefficient = Math.log(previous.fraction / last.fraction) / (last.metres - previous.metres);
  const decayed = last.fraction * Math.exp(-coefficient * (depth - last.metres));
  const ramp = 1 - (depth - last.metres) / (SUNLIGHT_FLOOR_METRES - last.metres);
  return decayed * ramp;
}

/**
 * The whole curve at one depth. A pure function of depth: no seed, no mood, no
 * randomness — which is what makes two worlds at the same depth share a sea,
 * and what makes this file pinnable against the Go builder's fixtures.
 */
export function depthAt(metres: number): DepthResponse {
  const depth = clampNumber(metres, 0, MAXIMUM_DEPTH_METRES);
  const lightFraction = lightFractionAtDepth(depth);
  const brightness =
    lightFraction > 0 ? clampNumber(Math.exp(BRIGHTNESS_COMPRESSION * Math.log(lightFraction)), 0, 1) : 0;
  const spectral = spectralSurvivalAtDepth(depth);
  const spectralRgb = spectralAsRgbMultiplier(spectral);

  const fog = addColor(
    multiplyColor(scaleColor(CLEAR_WATER_COLOR, brightness), spectralRgb),
    scaleColor(ABYSSAL_FLOOR_COLOR, 1 - brightness)
  );
  const surfaceLight = maximumColor(
    scaleColor(multiplyColor(SURFACE_SUN_COLOR, spectralRgb), brightness),
    KEY_LIGHT_FLOOR_COLOR
  );
  const ambient = maximumColor(scaleColor(fog, 0.55), AMBIENT_FLOOR_COLOR);
  const visibility = MINIMUM_VISIBILITY_METRES + VISIBILITY_METRES_RANGE * brightness;

  return {
    lightFraction,
    brightness,
    spectral,
    fogColor: colorToHex(fog),
    fogDensity: roundToThousandths(1 / visibility),
    visibilityMetres: roundToHundredths(visibility),
    tintStrength: roundToHundredths(clampNumber(1 - brightness, MINIMUM_TINT_STRENGTH, MAXIMUM_TINT_STRENGTH)),
    surfaceLightColor: colorToHex(surfaceLight),
    ambientColor: colorToHex(ambient),
    // Both are the light fraction itself, gained, so both are exactly zero at
    // and below the sunlight floor without any depth test anywhere.
    godRayStrength: roundToHundredths(clampNumber(lightFraction * GOD_RAY_GAIN, 0, 1)),
    causticStrength: roundToHundredths(clampNumber(lightFraction * CAUSTIC_GAIN, 0, 1)),
    baseExposure: roundToHundredths(BASE_EXPOSURE_AT_SURFACE + EXPOSURE_DEPTH_GAIN * (1 - brightness))
  };
}
