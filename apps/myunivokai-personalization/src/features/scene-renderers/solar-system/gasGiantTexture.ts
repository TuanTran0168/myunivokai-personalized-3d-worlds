import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { hexColorToRgbTriple, smoothstep } from "../shared/proceduralTextureMath";
import { createSeededNoise3d, fractalNoise3d, type Noise3dSource } from "../shared/seededNoise3d";
import type { GasGiantRecipe } from "./gasGiantRecipe";

/**
 * Bakes a GasGiantRecipe into an equirectangular CanvasTexture (the same
 * runtime-bake approach as nebulaCloudTexture.ts). Baking a texture instead
 * of writing a surface shader keeps the whole meshStandardMaterial pipeline
 * (sun day/night terminator, rim/fill lights, fog, grade, bloom) for free.
 *
 * Seam-free by construction: noise is sampled on a 3D cylinder
 * (cos(longitude), latitude, sin(longitude)), so longitude 0 and 2*PI meet
 * exactly. The expensive fBm fields are evaluated on coarse grids and
 * bilinearly upsampled — band turbulence is low-frequency, so the full bake
 * stays around ~50ms per planet instead of seconds.
 */

const GAS_GIANT_TEXTURE_WIDTH_PIXELS = 1024;
const GAS_GIANT_TEXTURE_HEIGHT_PIXELS = 512;
const TURBULENCE_FIELD_WIDTH_CELLS = 256;
const TURBULENCE_FIELD_HEIGHT_CELLS = 128;
const DETAIL_FIELD_WIDTH_CELLS = 512;
const DETAIL_FIELD_HEIGHT_CELLS = 256;
const TURBULENCE_NOISE_OCTAVE_COUNT = 4;
const DETAIL_NOISE_OCTAVE_COUNT = 2;
// Latitude runs 0..1 while the cylinder cross-section has radius 1, so the
// latitude axis needs its own frequency multiplier to squash the noise into
// horizontally-streaked weather bands.
const TURBULENCE_LATITUDE_FREQUENCY_MULTIPLIER = 2.2;
const DETAIL_LONGITUDE_FREQUENCY_MULTIPLIER = 3;
const DETAIL_LATITUDE_FREQUENCY_MULTIPLIER = 12;
// Fraction of each band over which its color blends into the next band.
const BAND_EDGE_BLEND_FRACTION = 0.4;
// Storm ovals: soft edge width and how much turbulence tears that edge.
const STORM_EDGE_SOFTNESS = 0.45;
const STORM_EDGE_TURBULENCE = 0.3;
const STORM_COLOR_MAXIMUM_INFLUENCE = 0.85;
// Polar hoods start darkening at this |latitude - 0.5| distance from equator.
const POLAR_HOOD_START_FRACTION = 0.32;
const POLAR_HOOD_END_FRACTION = 0.5;
// Worlds hold at most a handful of gas giants; keep a small LRU-ish cache so
// revisiting a world reuses its bakes without hoarding GPU memory forever.
const TEXTURE_CACHE_ENTRY_LIMIT = 12;

/**
 * fBm evaluated on a coarse (longitude, latitude) grid over the cylinder
 * domain. Columns wrap (longitude is periodic); rows clamp at the poles.
 */
function buildCylinderNoiseField(
  noise: Noise3dSource,
  widthCells: number,
  heightCells: number,
  longitudeFrequency: number,
  latitudeFrequency: number,
  octaveCount: number
): Float32Array {
  const field = new Float32Array(widthCells * heightCells);
  for (let rowIndex = 0; rowIndex < heightCells; rowIndex += 1) {
    const latitudeFraction = rowIndex / (heightCells - 1);
    for (let columnIndex = 0; columnIndex < widthCells; columnIndex += 1) {
      const longitudeRadians = (columnIndex / widthCells) * Math.PI * 2;
      field[rowIndex * widthCells + columnIndex] = fractalNoise3d(
        noise,
        Math.cos(longitudeRadians) * longitudeFrequency,
        latitudeFraction * latitudeFrequency,
        Math.sin(longitudeRadians) * longitudeFrequency,
        octaveCount
      );
    }
  }
  return field;
}

function sampleCylinderNoiseField(
  field: Float32Array,
  widthCells: number,
  heightCells: number,
  longitudeFraction: number,
  latitudeFraction: number
): number {
  const gridX = longitudeFraction * widthCells;
  const gridY = latitudeFraction * (heightCells - 1);
  const column0 = Math.floor(gridX) % widthCells;
  const column1 = (column0 + 1) % widthCells;
  const row0 = Math.min(Math.floor(gridY), heightCells - 2);
  const row1 = row0 + 1;
  const weightX = gridX - Math.floor(gridX);
  const weightY = gridY - row0;
  const top = field[row0 * widthCells + column0] * (1 - weightX) + field[row0 * widthCells + column1] * weightX;
  const bottom = field[row1 * widthCells + column0] * (1 - weightX) + field[row1 * widthCells + column1] * weightX;
  return top + (bottom - top) * weightY;
}

function wrapBandIndex(bandIndex: number, bandCount: number): number {
  return ((bandIndex % bandCount) + bandCount) % bandCount;
}

// Shortest signed longitude distance, handling the 0/2*PI wrap.
function wrappedLongitudeDelta(longitudeRadians: number, stormLongitudeRadians: number): number {
  return Math.atan2(
    Math.sin(longitudeRadians - stormLongitudeRadians),
    Math.cos(longitudeRadians - stormLongitudeRadians)
  );
}

function bakeGasGiantCanvas(recipe: GasGiantRecipe): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = GAS_GIANT_TEXTURE_WIDTH_PIXELS;
  canvas.height = GAS_GIANT_TEXTURE_HEIGHT_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const turbulenceNoise = createSeededNoise3d(recipe.noiseSeed);
  const detailNoise = createSeededNoise3d(`${recipe.noiseSeed}-detail`);
  const turbulenceField = buildCylinderNoiseField(
    turbulenceNoise,
    TURBULENCE_FIELD_WIDTH_CELLS,
    TURBULENCE_FIELD_HEIGHT_CELLS,
    recipe.noiseFrequency,
    recipe.noiseFrequency * TURBULENCE_LATITUDE_FREQUENCY_MULTIPLIER,
    TURBULENCE_NOISE_OCTAVE_COUNT
  );
  const detailField = buildCylinderNoiseField(
    detailNoise,
    DETAIL_FIELD_WIDTH_CELLS,
    DETAIL_FIELD_HEIGHT_CELLS,
    recipe.noiseFrequency * DETAIL_LONGITUDE_FREQUENCY_MULTIPLIER,
    recipe.noiseFrequency * DETAIL_LATITUDE_FREQUENCY_MULTIPLIER,
    DETAIL_NOISE_OCTAVE_COUNT
  );

  const bandColors = recipe.bandColorsHex.map(hexColorToRgbTriple);
  const bandCount = bandColors.length;
  const stormColors = recipe.storms.map((storm) => hexColorToRgbTriple(storm.colorHex));

  const imageData = context.createImageData(GAS_GIANT_TEXTURE_WIDTH_PIXELS, GAS_GIANT_TEXTURE_HEIGHT_PIXELS);
  for (let pixelY = 0; pixelY < GAS_GIANT_TEXTURE_HEIGHT_PIXELS; pixelY += 1) {
    const latitudeFraction = (pixelY + 0.5) / GAS_GIANT_TEXTURE_HEIGHT_PIXELS;
    const polarBrightness =
      1 -
      recipe.polarDarkening *
        smoothstep(POLAR_HOOD_START_FRACTION, POLAR_HOOD_END_FRACTION, Math.abs(latitudeFraction - 0.5));
    for (let pixelX = 0; pixelX < GAS_GIANT_TEXTURE_WIDTH_PIXELS; pixelX += 1) {
      const longitudeFraction = (pixelX + 0.5) / GAS_GIANT_TEXTURE_WIDTH_PIXELS;
      const longitudeRadians = longitudeFraction * Math.PI * 2;
      const turbulence = sampleCylinderNoiseField(
        turbulenceField,
        TURBULENCE_FIELD_WIDTH_CELLS,
        TURBULENCE_FIELD_HEIGHT_CELLS,
        longitudeFraction,
        latitudeFraction
      );

      const bandCoordinate = latitudeFraction * bandCount + turbulence * recipe.turbulenceBandUnits;
      const lowerBandIndex = Math.floor(bandCoordinate);
      const bandFraction = bandCoordinate - lowerBandIndex;
      const currentBand = bandColors[wrapBandIndex(lowerBandIndex, bandCount)];
      const nextBand = bandColors[wrapBandIndex(lowerBandIndex + 1, bandCount)];
      const edgeBlend = smoothstep(1 - BAND_EDGE_BLEND_FRACTION, 1, bandFraction);
      let red = currentBand[0] + (nextBand[0] - currentBand[0]) * edgeBlend;
      let green = currentBand[1] + (nextBand[1] - currentBand[1]) * edgeBlend;
      let blue = currentBand[2] + (nextBand[2] - currentBand[2]) * edgeBlend;

      for (let stormIndex = 0; stormIndex < recipe.storms.length; stormIndex += 1) {
        const storm = recipe.storms[stormIndex];
        const normalizedStormDistance =
          Math.hypot(
            wrappedLongitudeDelta(longitudeRadians, storm.longitudeRadians) / storm.longitudeRadiusRadians,
            (latitudeFraction - storm.latitudeFraction) / storm.latitudeRadiusFraction
          ) +
          turbulence * STORM_EDGE_TURBULENCE;
        const stormInfluence =
          (1 - smoothstep(1 - STORM_EDGE_SOFTNESS, 1, normalizedStormDistance)) * STORM_COLOR_MAXIMUM_INFLUENCE;
        if (stormInfluence > 0) {
          const stormColor = stormColors[stormIndex];
          red += (stormColor[0] - red) * stormInfluence;
          green += (stormColor[1] - green) * stormInfluence;
          blue += (stormColor[2] - blue) * stormInfluence;
        }
      }

      const detailBrightness =
        1 +
        recipe.detailStrength *
          sampleCylinderNoiseField(
            detailField,
            DETAIL_FIELD_WIDTH_CELLS,
            DETAIL_FIELD_HEIGHT_CELLS,
            longitudeFraction,
            latitudeFraction
          );
      const brightness = detailBrightness * polarBrightness;

      const pixelOffset = (pixelY * GAS_GIANT_TEXTURE_WIDTH_PIXELS + pixelX) * 4;
      imageData.data[pixelOffset] = Math.min(255, Math.max(0, Math.round(red * brightness)));
      imageData.data[pixelOffset + 1] = Math.min(255, Math.max(0, Math.round(green * brightness)));
      imageData.data[pixelOffset + 2] = Math.min(255, Math.max(0, Math.round(blue * brightness)));
      imageData.data[pixelOffset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

const gasGiantTextureCache = new Map<string, CanvasTexture>();

/**
 * Returns the baked surface texture for a recipe, cached by key so React
 * re-renders never re-bake. Returns null outside the browser (the R3F canvas
 * only renders client-side, so callers just fall back to the photo texture).
 */
export function getGasGiantSurfaceTexture(cacheKey: string, recipe: GasGiantRecipe): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cachedTexture = gasGiantTextureCache.get(cacheKey);
  if (cachedTexture) {
    return cachedTexture;
  }
  const canvas = bakeGasGiantCanvas(recipe);
  if (!canvas) {
    return null;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Longitude is periodic; wrapping lets the sampler blend across the seam.
  texture.wrapS = RepeatWrapping;
  if (gasGiantTextureCache.size >= TEXTURE_CACHE_ENTRY_LIMIT) {
    const oldestEntry = gasGiantTextureCache.entries().next().value;
    if (oldestEntry) {
      oldestEntry[1].dispose();
      gasGiantTextureCache.delete(oldestEntry[0]);
    }
  }
  gasGiantTextureCache.set(cacheKey, texture);
  return texture;
}
