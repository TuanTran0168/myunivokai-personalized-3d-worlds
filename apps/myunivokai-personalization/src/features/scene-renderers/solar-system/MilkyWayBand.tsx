"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, NormalBlending, type Group } from "three";
import type { SceneMilkyWayConfig, WeightedSkyColor } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "../shared/SizedStarPoints";
import {
  DUST_CLOUD_ATLAS_VARIANT_INDEX,
  EMISSIVE_CLOUD_ATLAS_VARIANT_COUNT
} from "../shared/nebulaCloudTexture";
import { NebulaCloudPoints, type CloudLayerAttributes } from "./NebulaCloudPoints";

/**
 * A procedural Milky Way modeled on wide-field photographs. Everything it
 * draws with — seeds, star/cloud counts, weighted palettes, opacities, tilt,
 * drift speed — comes from the scene config's `sky.milkyWay` section that the
 * BACKEND generates and stores per world; the constants below are only the
 * fallback for worlds created before schemaVersion 1.1 (and a defensive clamp
 * against malformed data).
 *
 * Structure (in band coordinates, azimuth = position along the band):
 *   - star sizes/brightness follow the real magnitude system: counts triple
 *     per magnitude step, brightness falls 2.512x per step (photographically
 *     compressed), size ~ luminance^0.45 (Stellarium's rule);
 *   - the band's half-width wobbles and WIDENS around the galactic-core
 *     azimuth (the bulge), where warm core stars and amber clouds cluster;
 *   - the GREAT RIFT — a meandering dark absorption lane — rejects stars and
 *     emissive clouds near its centerline over roughly half the band, and the
 *     dark dust sprites are laid ALONG it, splitting the band into the two
 *     bright rails real photographs show;
 *   - hero stars render with diffraction spikes (only the brightest stars
 *     show spikes in real photos).
 */

// --- fallbacks for pre-1.1 configs + defensive clamps ------------------------
const DEFAULT_MILKY_WAY_SEED = "myunivokai-milky-way";
const DEFAULT_ALL_SKY_STAR_COUNT = 5200;
const DEFAULT_BAND_STAR_COUNT = 5600;
const DEFAULT_CORE_STAR_COUNT = 2600;
const DEFAULT_HERO_STAR_COUNT = 26;
const DEFAULT_NEBULA_CLOUD_COUNT = 420;
const DEFAULT_CORE_CLOUD_COUNT = 160;
const DEFAULT_DUST_CLOUD_COUNT = 260;
const DEFAULT_NEBULA_CLOUD_OPACITY = 0.1;
const DEFAULT_CORE_CLOUD_OPACITY = 0.12;
const DEFAULT_DUST_CLOUD_OPACITY = 0.4;
const DEFAULT_BAND_TILT_X_RADIANS = 0.5;
const DEFAULT_BAND_TILT_Z_RADIANS = 0.35;
const DEFAULT_ROTATION_RADIANS_PER_SECOND = 0.003;

const MAXIMUM_STAR_COUNT_PER_LAYER = 20000;
const MAXIMUM_CLOUD_COUNT_PER_LAYER = 2000;
const MAXIMUM_BAND_TILT_RADIANS = Math.PI / 2;
const MAXIMUM_ROTATION_RADIANS_PER_SECOND = 0.05;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Blackbody fallback palettes (vendian.org spectral anchors) for pre-1.1 configs.
const FALLBACK_STAR_COLOR_DISTRIBUTION: WeightedColorEntry[] = [
  { hexColor: "#9BB0FF", weight: 0.1 },
  { hexColor: "#AABFFF", weight: 0.18 },
  { hexColor: "#CAD7FF", weight: 0.22 },
  { hexColor: "#F8F7FF", weight: 0.2 },
  { hexColor: "#FFF4EA", weight: 0.15 },
  { hexColor: "#FFD2A1", weight: 0.1 },
  { hexColor: "#FFCC6F", weight: 0.05 }
];
const FALLBACK_CORE_STAR_COLOR_DISTRIBUTION: WeightedColorEntry[] = [
  { hexColor: "#FFF4EA", weight: 0.3 },
  { hexColor: "#FFD2A1", weight: 0.35 },
  { hexColor: "#FFCC6F", weight: 0.25 },
  { hexColor: "#F8F7FF", weight: 0.1 }
];
const FALLBACK_NEBULA_CLOUD_COLOR_DISTRIBUTION: WeightedColorEntry[] = [
  { hexColor: "#2A3550", weight: 0.26 },
  { hexColor: "#8FA5CE", weight: 0.22 },
  { hexColor: "#E8DCC0", weight: 0.18 },
  { hexColor: "#C9B7D6", weight: 0.14 },
  { hexColor: "#6B4530", weight: 0.12 },
  { hexColor: "#4A3020", weight: 0.08 }
];
const FALLBACK_CORE_CLOUD_COLOR_DISTRIBUTION: WeightedColorEntry[] = [
  { hexColor: "#F5E3B8", weight: 0.4 },
  { hexColor: "#E8C79A", weight: 0.3 },
  { hexColor: "#D9A468", weight: 0.2 },
  { hexColor: "#B98A58", weight: 0.1 }
];
const FALLBACK_DUST_CLOUD_COLOR_DISTRIBUTION: WeightedColorEntry[] = [
  { hexColor: "#0D0D12", weight: 0.4 },
  { hexColor: "#120C08", weight: 0.3 },
  { hexColor: "#1A1210", weight: 0.3 }
];

// --- geometry ----------------------------------------------------------------
// Between the constellations (52) and the skybox (60).
const BAND_SPHERE_RADIUS = 56;
const DUST_SPHERE_RADIUS = 55;
const SPHERE_RADIUS_JITTER_RATIO = 0.04;
const BAND_WIDTH_WOBBLE_RATIO = 0.35;
const BAND_WIDTH_WOBBLE_WAVES = 2;
const BAND_STAR_SIGMA_RADIANS = 0.1;
const NEBULA_CLOUD_SIGMA_RADIANS = 0.085;

// Galactic core (bulge): one azimuth where the band widens, brightens and warms.
const CORE_AZIMUTH_CENTER_RADIANS = 0.9;
const CORE_STAR_AZIMUTH_SIGMA_RADIANS = 0.35;
const CORE_STAR_BAND_SIGMA_RADIANS = 0.15;
const CORE_CLOUD_AZIMUTH_SIGMA_RADIANS = 0.32;
const CORE_CLOUD_SIGMA_RADIANS = 0.12;
const BULGE_SIGMA_WIDENING_RATIO = 0.9;
const BULGE_AZIMUTH_SIGMA_RADIANS = 0.45;

// Great Rift: a meandering absorption lane over roughly half the band, offset
// from the core the way the real rift runs from Cygnus to Sagittarius.
const RIFT_CENTER_AZIMUTH_OFFSET_RADIANS = 0.9;
const RIFT_AZIMUTH_SIGMA_RADIANS = 1.1;
const RIFT_MAXIMUM_ABSORPTION = 0.85;
const RIFT_BASE_HALF_WIDTH_RADIANS = 0.035;
const RIFT_HALF_WIDTH_WAVE_RADIANS = 0.02;
const RIFT_MEANDER_PRIMARY_RADIANS = 0.02;
const RIFT_MEANDER_SECONDARY_RADIANS = 0.012;
const MAXIMUM_RIFT_RESAMPLE_ATTEMPTS = 4;
// Dust sprites hug the rift centerline; these spread them along/across it.
const DUST_ALONG_RIFT_AZIMUTH_RATIO = 0.9;
const DUST_ACROSS_RIFT_WIDTH_RATIO = 0.8;

// --- star magnitudes (real-sky statistics) -----------------------------------
// Counts roughly triple per magnitude step (pdf ~ 3^m) and brightness falls
// 2.512x per step; photographic response compresses that huge range.
const MAGNITUDE_COUNT_GROWTH = Math.log(3);
const MAGNITUDE_BRIGHTNESS_FACTOR = 2.512;
const PHOTOGRAPHIC_COMPRESSION_EXPONENT = 0.55;
// Stellarium's rule: rendered radius ~ luminance^0.45.
const STAR_SIZE_LUMINANCE_EXPONENT = 0.45;
const FIELD_STAR_BRIGHTEST_MAGNITUDE = -1.5;
const FIELD_STAR_FAINTEST_MAGNITUDE = 6.5;
const HERO_STAR_BRIGHTEST_MAGNITUDE = -2.2;
const HERO_STAR_FAINTEST_MAGNITUDE = -1.2;
const MINIMUM_STAR_BRIGHTNESS = 0.16;

const FIELD_STAR_MINIMUM_SIZE = 0.05;
const FIELD_STAR_SIZE_RANGE = 0.85;
const HERO_STAR_MINIMUM_SIZE = 1.6;
const HERO_STAR_SIZE_RANGE = 1.2;
const HERO_STAR_SPIKE_STRENGTH = 1;

// Star cores read white while faint stars keep more of their blackbody tint.
const BRIGHT_STAR_COLOR_SATURATION = 0.35;
const FAINT_STAR_COLOR_SATURATION = 0.75;

// --- clouds -------------------------------------------------------------------
// Many sprites at low alpha (per-sprite alpha spread x layer opacity) so the
// eye sees only their sum, never an individual puff.
const NEBULA_CLOUD_MINIMUM_SIZE = 2.2;
const NEBULA_CLOUD_SIZE_RANGE = 6;
const CORE_CLOUD_MINIMUM_SIZE = 3;
const CORE_CLOUD_SIZE_RANGE = 7;
const DUST_CLOUD_MINIMUM_SIZE = 1.6;
const DUST_CLOUD_SIZE_RANGE = 3.4;
const CLOUD_MINIMUM_ALPHA = 0.2;
const CLOUD_ALPHA_RANGE = 0.6;
const DUST_CLOUD_MINIMUM_ALPHA = 0.25;
const DUST_CLOUD_ALPHA_RANGE = 0.55;

const MILKY_WAY_DUST_RENDER_ORDER = 1;

// Phones get half the cloud sprites (fill-rate) — same check StarParticleField uses.
const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;
const MOBILE_CLOUD_COUNT_RATIO = 0.5;

type RandomSource = () => number;

type WeightedColorEntry = {
  hexColor: string;
  weight: number;
};

type ResolvedMilkyWayConfig = {
  seed: string;
  allSkyStarCount: number;
  bandStarCount: number;
  coreStarCount: number;
  heroStarCount: number;
  nebulaCloudCount: number;
  coreCloudCount: number;
  dustCloudCount: number;
  starColors: WeightedColorEntry[];
  coreStarColors: WeightedColorEntry[];
  nebulaCloudColors: WeightedColorEntry[];
  coreCloudColors: WeightedColorEntry[];
  dustCloudColors: WeightedColorEntry[];
  nebulaCloudOpacity: number;
  coreCloudOpacity: number;
  dustCloudOpacity: number;
  bandTiltXRadians: number;
  bandTiltZRadians: number;
  rotationRadiansPerSecond: number;
};

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveCount(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), maximum);
}

function resolveUnitRange(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    return fallback;
  }
  return value;
}

function resolveRadians(value: number | undefined, fallback: number, maximumMagnitude: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clampNumber(value, -maximumMagnitude, maximumMagnitude);
}

function sanitizeWeightedColors(colors: WeightedSkyColor[] | undefined, fallback: WeightedColorEntry[]): WeightedColorEntry[] {
  if (!Array.isArray(colors)) {
    return fallback;
  }
  const sanitized = colors
    .filter(
      (entry) =>
        typeof entry?.color === "string" &&
        HEX_COLOR_PATTERN.test(entry.color) &&
        typeof entry?.weight === "number" &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0
    )
    .map((entry) => ({ hexColor: entry.color as string, weight: entry.weight as number }));
  return sanitized.length > 0 ? sanitized : fallback;
}

function resolveMilkyWayConfig(sky: SceneMilkyWayConfig | undefined): ResolvedMilkyWayConfig {
  return {
    seed: typeof sky?.seed === "string" && sky.seed.length > 0 ? sky.seed : DEFAULT_MILKY_WAY_SEED,
    allSkyStarCount: resolveCount(sky?.allSkyStarCount, DEFAULT_ALL_SKY_STAR_COUNT, MAXIMUM_STAR_COUNT_PER_LAYER),
    bandStarCount: resolveCount(sky?.bandStarCount, DEFAULT_BAND_STAR_COUNT, MAXIMUM_STAR_COUNT_PER_LAYER),
    coreStarCount: resolveCount(sky?.coreStarCount, DEFAULT_CORE_STAR_COUNT, MAXIMUM_STAR_COUNT_PER_LAYER),
    heroStarCount: resolveCount(sky?.heroStarCount, DEFAULT_HERO_STAR_COUNT, MAXIMUM_STAR_COUNT_PER_LAYER),
    nebulaCloudCount: resolveCount(sky?.nebulaCloudCount, DEFAULT_NEBULA_CLOUD_COUNT, MAXIMUM_CLOUD_COUNT_PER_LAYER),
    coreCloudCount: resolveCount(sky?.coreCloudCount, DEFAULT_CORE_CLOUD_COUNT, MAXIMUM_CLOUD_COUNT_PER_LAYER),
    dustCloudCount: resolveCount(sky?.dustCloudCount, DEFAULT_DUST_CLOUD_COUNT, MAXIMUM_CLOUD_COUNT_PER_LAYER),
    starColors: sanitizeWeightedColors(sky?.starColors, FALLBACK_STAR_COLOR_DISTRIBUTION),
    coreStarColors: sanitizeWeightedColors(sky?.coreStarColors, FALLBACK_CORE_STAR_COLOR_DISTRIBUTION),
    nebulaCloudColors: sanitizeWeightedColors(sky?.nebulaCloudColors, FALLBACK_NEBULA_CLOUD_COLOR_DISTRIBUTION),
    coreCloudColors: sanitizeWeightedColors(sky?.coreCloudColors, FALLBACK_CORE_CLOUD_COLOR_DISTRIBUTION),
    dustCloudColors: sanitizeWeightedColors(sky?.dustCloudColors, FALLBACK_DUST_CLOUD_COLOR_DISTRIBUTION),
    nebulaCloudOpacity: resolveUnitRange(sky?.nebulaCloudOpacity, DEFAULT_NEBULA_CLOUD_OPACITY),
    coreCloudOpacity: resolveUnitRange(sky?.coreCloudOpacity, DEFAULT_CORE_CLOUD_OPACITY),
    dustCloudOpacity: resolveUnitRange(sky?.dustCloudOpacity, DEFAULT_DUST_CLOUD_OPACITY),
    bandTiltXRadians: resolveRadians(sky?.bandTiltXRadians, DEFAULT_BAND_TILT_X_RADIANS, MAXIMUM_BAND_TILT_RADIANS),
    bandTiltZRadians: resolveRadians(sky?.bandTiltZRadians, DEFAULT_BAND_TILT_Z_RADIANS, MAXIMUM_BAND_TILT_RADIANS),
    rotationRadiansPerSecond: resolveRadians(
      sky?.rotationRadiansPerSecond,
      DEFAULT_ROTATION_RADIANS_PER_SECOND,
      MAXIMUM_ROTATION_RADIANS_PER_SECOND
    )
  };
}

// --- band structure -----------------------------------------------------------

// Box-Muller: turns two uniform samples into one gaussian sample.
function gaussianSample(random: RandomSource): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

function wrappedAngleDelta(angleRadians: number): number {
  const fullCircle = Math.PI * 2;
  return ((((angleRadians + Math.PI) % fullCircle) + fullCircle) % fullCircle) - Math.PI;
}

// The band's half-width breathes along its length and widens into the bulge.
function bandSigmaAt(baseSigmaRadians: number, azimuthRadians: number): number {
  const wobble = 1 + BAND_WIDTH_WOBBLE_RATIO * Math.sin(BAND_WIDTH_WOBBLE_WAVES * azimuthRadians);
  const bulgeDelta = wrappedAngleDelta(azimuthRadians - CORE_AZIMUTH_CENTER_RADIANS);
  const bulgeWidening =
    1 +
    BULGE_SIGMA_WIDENING_RATIO *
      Math.exp(-(bulgeDelta * bulgeDelta) / (2 * BULGE_AZIMUTH_SIGMA_RADIANS * BULGE_AZIMUTH_SIGMA_RADIANS));
  return baseSigmaRadians * wobble * bulgeWidening;
}

function riftCenterLatitude(azimuthRadians: number): number {
  return (
    RIFT_MEANDER_PRIMARY_RADIANS * Math.sin(azimuthRadians + 0.4) +
    RIFT_MEANDER_SECONDARY_RADIANS * Math.sin(azimuthRadians * 3 + 1.7)
  );
}

function riftHalfWidth(azimuthRadians: number): number {
  return RIFT_BASE_HALF_WIDTH_RADIANS + RIFT_HALF_WIDTH_WAVE_RADIANS * (0.5 + 0.5 * Math.sin(azimuthRadians * 2 + 0.8));
}

function riftCenterAzimuth(): number {
  return CORE_AZIMUTH_CENTER_RADIANS + RIFT_CENTER_AZIMUTH_OFFSET_RADIANS;
}

// Absorption probability at a band position: how strongly the Great Rift's
// dust blocks the stars/glow there.
function riftAbsorptionAt(azimuthRadians: number, latitudeRadians: number): number {
  const azimuthDelta = wrappedAngleDelta(azimuthRadians - riftCenterAzimuth());
  const alongRiftStrength =
    RIFT_MAXIMUM_ABSORPTION *
    Math.exp(-(azimuthDelta * azimuthDelta) / (2 * RIFT_AZIMUTH_SIGMA_RADIANS * RIFT_AZIMUTH_SIGMA_RADIANS));
  const latitudeDelta = latitudeRadians - riftCenterLatitude(azimuthRadians);
  const halfWidth = riftHalfWidth(azimuthRadians);
  return alongRiftStrength * Math.exp(-(latitudeDelta * latitudeDelta) / (2 * halfWidth * halfWidth));
}

type SphereDirection = {
  azimuthRadians: number;
  latitudeRadians: number;
};

// Uniform over the whole sphere (uniform in solid angle via asin).
function sampleAllSkyDirection(random: RandomSource): SphereDirection {
  return {
    azimuthRadians: random() * Math.PI * 2,
    latitudeRadians: Math.asin(random() * 2 - 1)
  };
}

type BandAzimuthCluster = {
  centerRadians: number;
  sigmaRadians: number;
};

// Band positions get rejected inside the rift and resampled, which carves the
// dark lane and leaves two bright rails — the real band's signature.
function sampleBandDirection(
  random: RandomSource,
  baseSigmaRadians: number,
  azimuthCluster?: BandAzimuthCluster
): SphereDirection {
  const azimuthRadians = azimuthCluster
    ? azimuthCluster.centerRadians + gaussianSample(random) * azimuthCluster.sigmaRadians
    : random() * Math.PI * 2;
  const sigma = bandSigmaAt(baseSigmaRadians, azimuthRadians);
  let latitudeRadians = gaussianSample(random) * sigma;
  for (let attempt = 0; attempt < MAXIMUM_RIFT_RESAMPLE_ATTEMPTS; attempt += 1) {
    if (random() >= riftAbsorptionAt(azimuthRadians, latitudeRadians)) {
      break;
    }
    latitudeRadians = gaussianSample(random) * sigma;
  }
  return { azimuthRadians, latitudeRadians };
}

// Dust sprites are laid ALONG the rift: clustered around its azimuth arc,
// scattered tightly across its meandering centerline.
function sampleRiftDirection(random: RandomSource): SphereDirection {
  const azimuthRadians =
    riftCenterAzimuth() + gaussianSample(random) * RIFT_AZIMUTH_SIGMA_RADIANS * DUST_ALONG_RIFT_AZIMUTH_RATIO;
  const latitudeRadians =
    riftCenterLatitude(azimuthRadians) + gaussianSample(random) * riftHalfWidth(azimuthRadians) * DUST_ACROSS_RIFT_WIDTH_RATIO;
  return { azimuthRadians, latitudeRadians };
}

function writeSpherePoint(
  positions: Float32Array,
  pointIndex: number,
  radius: number,
  direction: SphereDirection
): void {
  positions[pointIndex * 3] = radius * Math.cos(direction.latitudeRadians) * Math.cos(direction.azimuthRadians);
  positions[pointIndex * 3 + 1] = radius * Math.sin(direction.latitudeRadians);
  positions[pointIndex * 3 + 2] = radius * Math.cos(direction.latitudeRadians) * Math.sin(direction.azimuthRadians);
}

// --- star + cloud population ----------------------------------------------------

// Samples an apparent magnitude with the real sky's count distribution
// (pdf ~ 3^m: each magnitude step has ~3x more stars than the last).
function sampleMagnitude(random: RandomSource, brightestMagnitude: number, faintestMagnitude: number): number {
  const brightestWeight = Math.exp(MAGNITUDE_COUNT_GROWTH * brightestMagnitude);
  const faintestWeight = Math.exp(MAGNITUDE_COUNT_GROWTH * faintestMagnitude);
  return Math.log(brightestWeight + (faintestWeight - brightestWeight) * random()) / MAGNITUDE_COUNT_GROWTH;
}

// Weighted color pick with a temperature bias: palettes are ordered hot -> cool,
// bright stars lean toward the hot head of the list, faint stars toward the
// cool tail — matching real-sky statistics.
function pickWeightedColorWithTemperatureBias(
  random: RandomSource,
  distribution: WeightedColorEntry[],
  hotAffinity: number
): [number, number, number] {
  const entryCount = distribution.length;
  let totalWeight = 0;
  const biasedWeights: number[] = new Array(entryCount);
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const hotRamp = (entryCount - entryIndex) / entryCount;
    const coolRamp = (entryIndex + 1) / entryCount;
    const biasedWeight = distribution[entryIndex].weight * (coolRamp + (hotRamp - coolRamp) * hotAffinity);
    biasedWeights[entryIndex] = biasedWeight;
    totalWeight += biasedWeight;
  }
  let remainingWeight = random() * totalWeight;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    remainingWeight -= biasedWeights[entryIndex];
    if (remainingWeight <= 0) {
      return hexColorToUnitRgb(distribution[entryIndex].hexColor);
    }
  }
  return hexColorToUnitRgb(distribution[entryCount - 1].hexColor);
}

function pickWeightedColor(random: RandomSource, distribution: WeightedColorEntry[]): [number, number, number] {
  const totalWeight = distribution.reduce((weightSum, entry) => weightSum + entry.weight, 0);
  let remainingWeight = random() * totalWeight;
  for (const entry of distribution) {
    remainingWeight -= entry.weight;
    if (remainingWeight <= 0) {
      return hexColorToUnitRgb(entry.hexColor);
    }
  }
  return hexColorToUnitRgb(distribution[distribution.length - 1].hexColor);
}

type StarPopulationOptions = {
  starCount: number;
  minimumSize: number;
  sizeRange: number;
  brightestMagnitude: number;
  faintestMagnitude: number;
  colorDistribution: WeightedColorEntry[];
  sampleDirection: (random: RandomSource) => SphereDirection;
};

function buildStarLayer(random: RandomSource, options: StarPopulationOptions): StarLayerAttributes {
  const positions = new Float32Array(options.starCount * 3);
  const colors = new Float32Array(options.starCount * 3);
  const sizes = new Float32Array(options.starCount);
  const twinklePhases = new Float32Array(options.starCount);
  for (let starIndex = 0; starIndex < options.starCount; starIndex += 1) {
    const radius = BAND_SPHERE_RADIUS * (1 + (random() * 2 - 1) * SPHERE_RADIUS_JITTER_RATIO);
    writeSpherePoint(positions, starIndex, radius, options.sampleDirection(random));

    const magnitude = sampleMagnitude(random, options.brightestMagnitude, options.faintestMagnitude);
    const normalizedLuminance = MAGNITUDE_BRIGHTNESS_FACTOR ** -(magnitude - options.brightestMagnitude);
    const photoBrightness = normalizedLuminance ** PHOTOGRAPHIC_COMPRESSION_EXPONENT;
    sizes[starIndex] = options.minimumSize + options.sizeRange * normalizedLuminance ** STAR_SIZE_LUMINANCE_EXPONENT;

    const brightness = MINIMUM_STAR_BRIGHTNESS + (1 - MINIMUM_STAR_BRIGHTNESS) * photoBrightness;
    const [red, green, blue] = pickWeightedColorWithTemperatureBias(random, options.colorDistribution, photoBrightness);
    // Bright cores wash toward white; faint stars keep more blackbody tint.
    const saturation =
      BRIGHT_STAR_COLOR_SATURATION + (FAINT_STAR_COLOR_SATURATION - BRIGHT_STAR_COLOR_SATURATION) * (1 - photoBrightness);
    colors[starIndex * 3] = (1 + (red - 1) * saturation) * brightness;
    colors[starIndex * 3 + 1] = (1 + (green - 1) * saturation) * brightness;
    colors[starIndex * 3 + 2] = (1 + (blue - 1) * saturation) * brightness;

    twinklePhases[starIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

type CloudPopulationOptions = {
  cloudCount: number;
  minimumSize: number;
  sizeRange: number;
  minimumAlpha: number;
  alphaRange: number;
  colorDistribution: WeightedColorEntry[];
  sphereRadius: number;
  atlasVariantCount: number;
  fixedAtlasVariant?: number;
  sampleDirection: (random: RandomSource) => SphereDirection;
};

function buildCloudLayer(random: RandomSource, options: CloudPopulationOptions): CloudLayerAttributes {
  const positions = new Float32Array(options.cloudCount * 3);
  const colors = new Float32Array(options.cloudCount * 3);
  const sizes = new Float32Array(options.cloudCount);
  const rotations = new Float32Array(options.cloudCount);
  const alphas = new Float32Array(options.cloudCount);
  const variants = new Float32Array(options.cloudCount);
  for (let cloudIndex = 0; cloudIndex < options.cloudCount; cloudIndex += 1) {
    writeSpherePoint(positions, cloudIndex, options.sphereRadius, options.sampleDirection(random));

    const [red, green, blue] = pickWeightedColor(random, options.colorDistribution);
    colors[cloudIndex * 3] = red;
    colors[cloudIndex * 3 + 1] = green;
    colors[cloudIndex * 3 + 2] = blue;

    sizes[cloudIndex] = options.minimumSize + random() * options.sizeRange;
    rotations[cloudIndex] = random() * Math.PI * 2;
    alphas[cloudIndex] = options.minimumAlpha + random() * options.alphaRange;
    variants[cloudIndex] =
      options.fixedAtlasVariant ?? Math.floor(random() * options.atlasVariantCount);
  }
  return { positions, colors, sizes, rotations, alphas, variants };
}

type MilkyWayBandProps = {
  sky?: SceneMilkyWayConfig;
};

export function MilkyWayBand({ sky }: MilkyWayBandProps) {
  const resolvedConfig = useMemo(() => resolveMilkyWayConfig(sky), [sky]);

  const layers = useMemo(() => {
    const random = randomFromSeed(resolvedConfig.seed);
    const isMobileViewport = typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
    const cloudCountRatio = isMobileViewport ? MOBILE_CLOUD_COUNT_RATIO : 1;
    const coreAzimuthCluster: BandAzimuthCluster = {
      centerRadians: CORE_AZIMUTH_CENTER_RADIANS,
      sigmaRadians: CORE_STAR_AZIMUTH_SIGMA_RADIANS
    };
    return {
      allSkyStars: buildStarLayer(random, {
        starCount: resolvedConfig.allSkyStarCount,
        minimumSize: FIELD_STAR_MINIMUM_SIZE,
        sizeRange: FIELD_STAR_SIZE_RANGE,
        brightestMagnitude: FIELD_STAR_BRIGHTEST_MAGNITUDE,
        faintestMagnitude: FIELD_STAR_FAINTEST_MAGNITUDE,
        colorDistribution: resolvedConfig.starColors,
        sampleDirection: sampleAllSkyDirection
      }),
      bandStars: buildStarLayer(random, {
        starCount: resolvedConfig.bandStarCount,
        minimumSize: FIELD_STAR_MINIMUM_SIZE,
        sizeRange: FIELD_STAR_SIZE_RANGE,
        brightestMagnitude: FIELD_STAR_BRIGHTEST_MAGNITUDE,
        faintestMagnitude: FIELD_STAR_FAINTEST_MAGNITUDE,
        colorDistribution: resolvedConfig.starColors,
        sampleDirection: (randomSource) => sampleBandDirection(randomSource, BAND_STAR_SIGMA_RADIANS)
      }),
      coreStars: buildStarLayer(random, {
        starCount: resolvedConfig.coreStarCount,
        minimumSize: FIELD_STAR_MINIMUM_SIZE,
        sizeRange: FIELD_STAR_SIZE_RANGE,
        brightestMagnitude: FIELD_STAR_BRIGHTEST_MAGNITUDE,
        faintestMagnitude: FIELD_STAR_FAINTEST_MAGNITUDE,
        colorDistribution: resolvedConfig.coreStarColors,
        sampleDirection: (randomSource) =>
          sampleBandDirection(randomSource, CORE_STAR_BAND_SIGMA_RADIANS, coreAzimuthCluster)
      }),
      heroStars: buildStarLayer(random, {
        starCount: resolvedConfig.heroStarCount,
        minimumSize: HERO_STAR_MINIMUM_SIZE,
        sizeRange: HERO_STAR_SIZE_RANGE,
        brightestMagnitude: HERO_STAR_BRIGHTEST_MAGNITUDE,
        faintestMagnitude: HERO_STAR_FAINTEST_MAGNITUDE,
        colorDistribution: resolvedConfig.starColors,
        sampleDirection: sampleAllSkyDirection
      }),
      nebulaClouds: buildCloudLayer(random, {
        cloudCount: Math.floor(resolvedConfig.nebulaCloudCount * cloudCountRatio),
        minimumSize: NEBULA_CLOUD_MINIMUM_SIZE,
        sizeRange: NEBULA_CLOUD_SIZE_RANGE,
        minimumAlpha: CLOUD_MINIMUM_ALPHA,
        alphaRange: CLOUD_ALPHA_RANGE,
        colorDistribution: resolvedConfig.nebulaCloudColors,
        sphereRadius: BAND_SPHERE_RADIUS,
        atlasVariantCount: EMISSIVE_CLOUD_ATLAS_VARIANT_COUNT,
        sampleDirection: (randomSource) => sampleBandDirection(randomSource, NEBULA_CLOUD_SIGMA_RADIANS)
      }),
      coreClouds: buildCloudLayer(random, {
        cloudCount: Math.floor(resolvedConfig.coreCloudCount * cloudCountRatio),
        minimumSize: CORE_CLOUD_MINIMUM_SIZE,
        sizeRange: CORE_CLOUD_SIZE_RANGE,
        minimumAlpha: CLOUD_MINIMUM_ALPHA,
        alphaRange: CLOUD_ALPHA_RANGE,
        colorDistribution: resolvedConfig.coreCloudColors,
        sphereRadius: BAND_SPHERE_RADIUS,
        atlasVariantCount: EMISSIVE_CLOUD_ATLAS_VARIANT_COUNT,
        sampleDirection: (randomSource) =>
          sampleBandDirection(randomSource, CORE_CLOUD_SIGMA_RADIANS, {
            centerRadians: CORE_AZIMUTH_CENTER_RADIANS,
            sigmaRadians: CORE_CLOUD_AZIMUTH_SIGMA_RADIANS
          })
      }),
      dustClouds: buildCloudLayer(random, {
        cloudCount: Math.floor(resolvedConfig.dustCloudCount * cloudCountRatio),
        minimumSize: DUST_CLOUD_MINIMUM_SIZE,
        sizeRange: DUST_CLOUD_SIZE_RANGE,
        minimumAlpha: DUST_CLOUD_MINIMUM_ALPHA,
        alphaRange: DUST_CLOUD_ALPHA_RANGE,
        colorDistribution: resolvedConfig.dustCloudColors,
        sphereRadius: DUST_SPHERE_RADIUS,
        atlasVariantCount: EMISSIVE_CLOUD_ATLAS_VARIANT_COUNT,
        fixedAtlasVariant: DUST_CLOUD_ATLAS_VARIANT_INDEX,
        sampleDirection: sampleRiftDirection
      })
    };
  }, [resolvedConfig]);

  const bandGroupReference = useRef<Group>(null);

  useFrame((_, deltaSeconds) => {
    if (bandGroupReference.current) {
      bandGroupReference.current.rotation.y += resolvedConfig.rotationRadiansPerSecond * deltaSeconds;
    }
  });

  const geometryKey = `${resolvedConfig.seed}:${resolvedConfig.allSkyStarCount}:${resolvedConfig.bandStarCount}:${resolvedConfig.coreStarCount}:${resolvedConfig.heroStarCount}:${resolvedConfig.nebulaCloudCount}:${resolvedConfig.coreCloudCount}:${resolvedConfig.dustCloudCount}`;

  return (
    <group ref={bandGroupReference} rotation={[resolvedConfig.bandTiltXRadians, 0, resolvedConfig.bandTiltZRadians]}>
      <NebulaCloudPoints
        clouds={layers.nebulaClouds}
        globalOpacity={resolvedConfig.nebulaCloudOpacity}
        blending={AdditiveBlending}
        geometryKey={`${geometryKey}:nebula`}
      />
      <NebulaCloudPoints
        clouds={layers.coreClouds}
        globalOpacity={resolvedConfig.coreCloudOpacity}
        blending={AdditiveBlending}
        geometryKey={`${geometryKey}:core-clouds`}
      />
      <SizedStarPoints stars={layers.allSkyStars} geometryKey={`${geometryKey}:all-sky`} />
      <SizedStarPoints stars={layers.bandStars} geometryKey={`${geometryKey}:band`} />
      <SizedStarPoints stars={layers.coreStars} geometryKey={`${geometryKey}:core`} />
      <SizedStarPoints
        stars={layers.heroStars}
        spikeStrength={HERO_STAR_SPIKE_STRENGTH}
        geometryKey={`${geometryKey}:hero`}
      />
      <NebulaCloudPoints
        clouds={layers.dustClouds}
        globalOpacity={resolvedConfig.dustCloudOpacity}
        blending={NormalBlending}
        renderOrder={MILKY_WAY_DUST_RENDER_ORDER}
        geometryKey={`${geometryKey}:dust`}
      />
    </group>
  );
}
