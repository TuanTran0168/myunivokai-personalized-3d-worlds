import { CanvasTexture } from "three";
import { randomFromSeed } from "@/lib/scene";

/**
 * Runtime-baked nebula sprites: a horizontal ATLAS of three 256px variants,
 * each a domain-warped multi-octave fBm (Inigo Quilez's warp recipe:
 * f = fbm(p + W*r), r = fbm(p + W*q), q = fbm(p)) shaped by a radial falloff
 * and stored in the ALPHA channel (RGB stays white so materials tint it).
 *
 *   variant 0, 1 — warped fBm with different seeds (emissive nebulosity)
 *   variant 2    — ridged warped fBm (the dark dust lanes' torn filaments)
 *
 * Single-octave value noise is exactly why clouds read as smoke puffs: energy
 * at one frequency, isotropic blobs. Five octaves + warping give the streaky,
 * torn structure real interstellar clouds have. The warp fields are computed
 * on a coarse grid and bilinearly upsampled — warping is low-frequency, and
 * this keeps the one-time bake under ~100ms. Lazy singleton, seeded, so every
 * visitor bakes the identical atlas.
 */

export const NEBULA_CLOUD_ATLAS_VARIANT_COUNT = 3;
export const DUST_CLOUD_ATLAS_VARIANT_INDEX = 2;
// Emissive cloud sprites pick randomly among these variants.
export const EMISSIVE_CLOUD_ATLAS_VARIANT_COUNT = 2;

const CLOUD_TEXTURE_SEED_PREFIX = "myunivokai-nebula-cloud-variant-";
const VARIANT_SIZE_PIXELS = 256;
const NOISE_OCTAVE_COUNT = 5;
const NOISE_BASE_CELLS_PER_SIDE = 4;
const NOISE_OCTAVE_GAIN = 0.5;
// Warp amplitude in unit-square coordinates (~1.4 periods of the base noise):
// strong enough for filaments, subtle enough to avoid the "torrid mess" the
// rendering literature warns about.
const DOMAIN_WARP_AMPLITUDE = 0.35;
const WARP_FIELD_RESOLUTION = 64;
// Decorrelation offsets from iq's recipe, rescaled to the unit square.
const WARP_Q_OFFSET_U = 0.26;
const WARP_Q_OFFSET_V = 0.13;
const WARP_R1_OFFSET_U = 0.17;
const WARP_R1_OFFSET_V = 0.92;
const WARP_R2_OFFSET_U = 0.83;
const WARP_R2_OFFSET_V = 0.28;

// Only the brighter half of the noise becomes visible, so clouds have holes
// and filaments instead of reading as an even fog.
const NOISE_VISIBILITY_FLOOR = 0.3;
const NOISE_CONTRAST_EXPONENT = 1.6;
// Alpha is forced to zero before the sprite edge so the square tile can never
// show a hard border, even when rotated in the shader.
const RADIAL_FALLOFF_START_RADIUS = 0.2;

type RandomSource = () => number;

function smoothInterpolationWeight(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
}

// Wrapping (tileable) value noise so warped coordinates outside [0,1] stay valid.
function buildRandomValueGrid(random: RandomSource, cellsPerSide: number): Float32Array {
  const grid = new Float32Array(cellsPerSide * cellsPerSide);
  for (let vertexIndex = 0; vertexIndex < grid.length; vertexIndex += 1) {
    grid[vertexIndex] = random();
  }
  return grid;
}

function wrapIndex(index: number, cellsPerSide: number): number {
  return ((index % cellsPerSide) + cellsPerSide) % cellsPerSide;
}

function sampleWrappedValueGrid(grid: Float32Array, cellsPerSide: number, gridX: number, gridY: number): number {
  const columnIndex = Math.floor(gridX);
  const rowIndex = Math.floor(gridY);
  const weightX = smoothInterpolationWeight(gridX - columnIndex);
  const weightY = smoothInterpolationWeight(gridY - rowIndex);
  const column0 = wrapIndex(columnIndex, cellsPerSide);
  const column1 = wrapIndex(columnIndex + 1, cellsPerSide);
  const row0 = wrapIndex(rowIndex, cellsPerSide);
  const row1 = wrapIndex(rowIndex + 1, cellsPerSide);
  const topLeft = grid[row0 * cellsPerSide + column0];
  const topRight = grid[row0 * cellsPerSide + column1];
  const bottomLeft = grid[row1 * cellsPerSide + column0];
  const bottomRight = grid[row1 * cellsPerSide + column1];
  const interpolatedTop = topLeft + (topRight - topLeft) * weightX;
  const interpolatedBottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
  return interpolatedTop + (interpolatedBottom - interpolatedTop) * weightY;
}

type NoiseOctave = {
  grid: Float32Array;
  cellsPerSide: number;
  amplitude: number;
};

function buildNoiseOctaves(random: RandomSource): { octaves: NoiseOctave[]; amplitudeSum: number } {
  const octaves: NoiseOctave[] = [];
  let amplitudeSum = 0;
  for (let octaveIndex = 0; octaveIndex < NOISE_OCTAVE_COUNT; octaveIndex += 1) {
    const cellsPerSide = NOISE_BASE_CELLS_PER_SIDE * 2 ** octaveIndex;
    const amplitude = NOISE_OCTAVE_GAIN ** octaveIndex;
    amplitudeSum += amplitude;
    octaves.push({ grid: buildRandomValueGrid(random, cellsPerSide), cellsPerSide, amplitude });
  }
  return { octaves, amplitudeSum };
}

function fractalNoise(octaves: NoiseOctave[], amplitudeSum: number, u: number, v: number): number {
  let noiseValue = 0;
  for (const octave of octaves) {
    noiseValue += sampleWrappedValueGrid(octave.grid, octave.cellsPerSide, u * octave.cellsPerSide, v * octave.cellsPerSide) * octave.amplitude;
  }
  return noiseValue / amplitudeSum;
}

// Ridged fBm: per-octave (1 - |2n - 1|)^2 — sharp crease lines for dust.
function ridgedFractalNoise(octaves: NoiseOctave[], amplitudeSum: number, u: number, v: number): number {
  let noiseValue = 0;
  for (const octave of octaves) {
    const sample = sampleWrappedValueGrid(octave.grid, octave.cellsPerSide, u * octave.cellsPerSide, v * octave.cellsPerSide);
    const ridge = 1 - Math.abs(2 * sample - 1);
    noiseValue += ridge * ridge * octave.amplitude;
  }
  return noiseValue / amplitudeSum;
}

function radialFalloff(normalizedRadius: number): number {
  if (normalizedRadius <= RADIAL_FALLOFF_START_RADIUS) {
    return 1;
  }
  if (normalizedRadius >= 1) {
    return 0;
  }
  const falloffFraction = (1 - normalizedRadius) / (1 - RADIAL_FALLOFF_START_RADIUS);
  return smoothInterpolationWeight(falloffFraction);
}

/**
 * Paints one atlas tile: double-domain-warped fBm through a radial mask.
 * The warp displacement field (q -> r) is evaluated on a coarse grid and
 * bilinearly upsampled to full resolution.
 */
function paintCloudVariant(
  imageData: ImageData,
  atlasWidthPixels: number,
  variantIndex: number,
  useRidgedNoise: boolean
): void {
  const random = randomFromSeed(`${CLOUD_TEXTURE_SEED_PREFIX}${variantIndex}`);
  const { octaves, amplitudeSum } = buildNoiseOctaves(random);
  const finalNoise = useRidgedNoise ? ridgedFractalNoise : fractalNoise;

  // Coarse warp field: r = warp target offsets, following iq's two-stage warp.
  const warpField = new Float32Array(WARP_FIELD_RESOLUTION * WARP_FIELD_RESOLUTION * 2);
  for (let fieldY = 0; fieldY < WARP_FIELD_RESOLUTION; fieldY += 1) {
    for (let fieldX = 0; fieldX < WARP_FIELD_RESOLUTION; fieldX += 1) {
      const u = fieldX / (WARP_FIELD_RESOLUTION - 1);
      const v = fieldY / (WARP_FIELD_RESOLUTION - 1);
      const qU = fractalNoise(octaves, amplitudeSum, u, v);
      const qV = fractalNoise(octaves, amplitudeSum, u + WARP_Q_OFFSET_U, v + WARP_Q_OFFSET_V);
      const rU = fractalNoise(
        octaves,
        amplitudeSum,
        u + DOMAIN_WARP_AMPLITUDE * qU + WARP_R1_OFFSET_U,
        v + DOMAIN_WARP_AMPLITUDE * qV + WARP_R1_OFFSET_V
      );
      const rV = fractalNoise(
        octaves,
        amplitudeSum,
        u + DOMAIN_WARP_AMPLITUDE * qU + WARP_R2_OFFSET_U,
        v + DOMAIN_WARP_AMPLITUDE * qV + WARP_R2_OFFSET_V
      );
      const fieldOffset = (fieldY * WARP_FIELD_RESOLUTION + fieldX) * 2;
      warpField[fieldOffset] = rU;
      warpField[fieldOffset + 1] = rV;
    }
  }

  const sampleWarpField = (u: number, v: number): [number, number] => {
    const gridX = Math.min(u, 1) * (WARP_FIELD_RESOLUTION - 1);
    const gridY = Math.min(v, 1) * (WARP_FIELD_RESOLUTION - 1);
    const column0 = Math.min(Math.floor(gridX), WARP_FIELD_RESOLUTION - 2);
    const row0 = Math.min(Math.floor(gridY), WARP_FIELD_RESOLUTION - 2);
    const weightX = gridX - column0;
    const weightY = gridY - row0;
    const readField = (column: number, row: number, component: number) =>
      warpField[(row * WARP_FIELD_RESOLUTION + column) * 2 + component];
    const interpolate = (component: number) => {
      const top = readField(column0, row0, component) * (1 - weightX) + readField(column0 + 1, row0, component) * weightX;
      const bottom =
        readField(column0, row0 + 1, component) * (1 - weightX) + readField(column0 + 1, row0 + 1, component) * weightX;
      return top * (1 - weightY) + bottom * weightY;
    };
    return [interpolate(0), interpolate(1)];
  };

  const tileOriginX = variantIndex * VARIANT_SIZE_PIXELS;
  const halfSizePixels = VARIANT_SIZE_PIXELS / 2;
  for (let pixelY = 0; pixelY < VARIANT_SIZE_PIXELS; pixelY += 1) {
    for (let pixelX = 0; pixelX < VARIANT_SIZE_PIXELS; pixelX += 1) {
      const u = pixelX / (VARIANT_SIZE_PIXELS - 1);
      const v = pixelY / (VARIANT_SIZE_PIXELS - 1);
      const [warpU, warpV] = sampleWarpField(u, v);
      const noiseValue = finalNoise(
        octaves,
        amplitudeSum,
        u + DOMAIN_WARP_AMPLITUDE * warpU,
        v + DOMAIN_WARP_AMPLITUDE * warpV
      );
      const liftedValue = Math.max(0, (noiseValue - NOISE_VISIBILITY_FLOOR) / (1 - NOISE_VISIBILITY_FLOOR));
      const shapedValue = liftedValue ** NOISE_CONTRAST_EXPONENT;
      const normalizedRadius = Math.hypot(pixelX - halfSizePixels, pixelY - halfSizePixels) / halfSizePixels;
      const alpha = shapedValue * radialFalloff(normalizedRadius);
      const pixelOffset = (pixelY * atlasWidthPixels + tileOriginX + pixelX) * 4;
      imageData.data[pixelOffset] = 255;
      imageData.data[pixelOffset + 1] = 255;
      imageData.data[pixelOffset + 2] = 255;
      imageData.data[pixelOffset + 3] = Math.round(alpha * 255);
    }
  }
}

let sharedNebulaCloudAtlasTexture: CanvasTexture | null = null;

export function getNebulaCloudAtlasTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (sharedNebulaCloudAtlasTexture) {
    return sharedNebulaCloudAtlasTexture;
  }
  const atlasWidthPixels = VARIANT_SIZE_PIXELS * NEBULA_CLOUD_ATLAS_VARIANT_COUNT;
  const canvas = document.createElement("canvas");
  canvas.width = atlasWidthPixels;
  canvas.height = VARIANT_SIZE_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const imageData = context.createImageData(atlasWidthPixels, VARIANT_SIZE_PIXELS);
  for (let variantIndex = 0; variantIndex < NEBULA_CLOUD_ATLAS_VARIANT_COUNT; variantIndex += 1) {
    paintCloudVariant(imageData, atlasWidthPixels, variantIndex, variantIndex === DUST_CLOUD_ATLAS_VARIANT_INDEX);
  }
  context.putImageData(imageData, 0, 0);
  sharedNebulaCloudAtlasTexture = new CanvasTexture(canvas);
  return sharedNebulaCloudAtlasTexture;
}
