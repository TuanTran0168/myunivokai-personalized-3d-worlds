import { CanvasTexture, SRGBColorSpace } from "three";
import { hexColorToRgbTriple, smoothstep } from "../shared/proceduralTextureMath";
import type { PlanetRingRecipe } from "./planetRingRecipe";

/**
 * Bakes a PlanetRingRecipe into a small radial-strip CanvasTexture. The ring
 * mesh uses buildRadialRingGeometry (SolarPlanet.tsx), whose UVs map U to the
 * radial fraction and pin V to 0.5 — so the strip only needs to vary along X:
 * column = one radial position, from the inner edge (x=0) to the outer (x=1).
 * Alpha carries the band structure (gap divisions, soft inner/outer fades).
 */

const RING_TEXTURE_WIDTH_PIXELS = 256;
const RING_TEXTURE_HEIGHT_PIXELS = 4;
// Fraction of each band over which its color/alpha blends into the next.
const RING_BAND_EDGE_BLEND_FRACTION = 0.3;
// The ring fades in over the first stretch of radius and out over the last,
// so the texture never ends in a hard circle.
const RING_INNER_EDGE_FADE_FRACTION = 0.06;
const RING_OUTER_EDGE_FADE_FRACTION = 0.08;
// A world holds a handful of ringed planets at most; small dispose-evict
// cache, same policy as the gas giant surface cache.
const TEXTURE_CACHE_ENTRY_LIMIT = 12;

function bakePlanetRingCanvas(recipe: PlanetRingRecipe): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = RING_TEXTURE_WIDTH_PIXELS;
  canvas.height = RING_TEXTURE_HEIGHT_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const bandColors = recipe.bandColorsHex.map(hexColorToRgbTriple);
  const bandCount = bandColors.length;
  const lastBandIndex = bandCount - 1;

  const imageData = context.createImageData(RING_TEXTURE_WIDTH_PIXELS, RING_TEXTURE_HEIGHT_PIXELS);
  for (let pixelX = 0; pixelX < RING_TEXTURE_WIDTH_PIXELS; pixelX += 1) {
    // radialFraction stays below 1 (pixel centers), so bandIndex never
    // exceeds the last band.
    const radialFraction = (pixelX + 0.5) / RING_TEXTURE_WIDTH_PIXELS;
    const bandCoordinate = radialFraction * bandCount;
    const bandIndex = Math.min(Math.floor(bandCoordinate), lastBandIndex);
    // Bands do not wrap radially: the outermost band blends into itself.
    const nextBandIndex = Math.min(bandIndex + 1, lastBandIndex);
    const bandFraction = bandCoordinate - bandIndex;
    const edgeBlend = smoothstep(1 - RING_BAND_EDGE_BLEND_FRACTION, 1, bandFraction);

    const currentColor = bandColors[bandIndex];
    const nextColor = bandColors[nextBandIndex];
    const red = currentColor[0] + (nextColor[0] - currentColor[0]) * edgeBlend;
    const green = currentColor[1] + (nextColor[1] - currentColor[1]) * edgeBlend;
    const blue = currentColor[2] + (nextColor[2] - currentColor[2]) * edgeBlend;

    const bandAlpha =
      recipe.bandAlphas[bandIndex] + (recipe.bandAlphas[nextBandIndex] - recipe.bandAlphas[bandIndex]) * edgeBlend;
    const edgeFade =
      smoothstep(0, RING_INNER_EDGE_FADE_FRACTION, radialFraction) *
      (1 - smoothstep(1 - RING_OUTER_EDGE_FADE_FRACTION, 1, radialFraction));
    const alpha = Math.min(1, Math.max(0, bandAlpha * edgeFade));

    for (let pixelY = 0; pixelY < RING_TEXTURE_HEIGHT_PIXELS; pixelY += 1) {
      const pixelOffset = (pixelY * RING_TEXTURE_WIDTH_PIXELS + pixelX) * 4;
      imageData.data[pixelOffset] = Math.round(red);
      imageData.data[pixelOffset + 1] = Math.round(green);
      imageData.data[pixelOffset + 2] = Math.round(blue);
      imageData.data[pixelOffset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

const planetRingTextureCache = new Map<string, CanvasTexture>();

/**
 * Returns the baked radial ring strip for a recipe, cached by key so React
 * re-renders never re-bake. Returns null outside the browser (the R3F canvas
 * only renders client-side; the caller simply skips the ring on the server).
 */
export function getPlanetRingTexture(cacheKey: string, recipe: PlanetRingRecipe): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cachedTexture = planetRingTextureCache.get(cacheKey);
  if (cachedTexture) {
    return cachedTexture;
  }
  const canvas = bakePlanetRingCanvas(recipe);
  if (!canvas) {
    return null;
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (planetRingTextureCache.size >= TEXTURE_CACHE_ENTRY_LIMIT) {
    const oldestEntry = planetRingTextureCache.entries().next().value;
    if (oldestEntry) {
      oldestEntry[1].dispose();
      planetRingTextureCache.delete(oldestEntry[0]);
    }
  }
  planetRingTextureCache.set(cacheKey, texture);
  return texture;
}
