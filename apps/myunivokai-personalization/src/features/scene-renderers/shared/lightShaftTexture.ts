import { CanvasTexture } from "three";

/**
 * A runtime-generated light-shaft sprite: white, brightest along the vertical
 * center line, fading out toward both side edges (gaussian-ish) and toward
 * the bottom. An untextured quad renders god-rays as hard-edged rectangles;
 * this map gives them the soft falloff real crepuscular rays have.
 * Lazy singleton, same pattern as softCircleTexture.
 */

const TEXTURE_WIDTH_PIXELS = 64;
const TEXTURE_HEIGHT_PIXELS = 256;
const HORIZONTAL_FALLOFF_SHARPNESS = 3.2;
const VERTICAL_FADE_START_FRACTION = 0.15;

let sharedLightShaftTexture: CanvasTexture | null = null;

export function getLightShaftTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (sharedLightShaftTexture) {
    return sharedLightShaftTexture;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH_PIXELS;
  canvas.height = TEXTURE_HEIGHT_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const imageData = context.createImageData(TEXTURE_WIDTH_PIXELS, TEXTURE_HEIGHT_PIXELS);
  for (let y = 0; y < TEXTURE_HEIGHT_PIXELS; y += 1) {
    // Full strength at the top, fading to nothing at the bottom.
    const verticalFraction = y / (TEXTURE_HEIGHT_PIXELS - 1);
    const verticalFade =
      verticalFraction < VERTICAL_FADE_START_FRACTION
        ? verticalFraction / VERTICAL_FADE_START_FRACTION
        : 1 - (verticalFraction - VERTICAL_FADE_START_FRACTION) / (1 - VERTICAL_FADE_START_FRACTION);
    for (let x = 0; x < TEXTURE_WIDTH_PIXELS; x += 1) {
      const horizontalOffset = (x / (TEXTURE_WIDTH_PIXELS - 1)) * 2 - 1;
      const horizontalFalloff = Math.exp(-HORIZONTAL_FALLOFF_SHARPNESS * horizontalOffset * horizontalOffset);
      const alpha = Math.max(0, Math.min(1, verticalFade * horizontalFalloff));
      const pixelIndex = (y * TEXTURE_WIDTH_PIXELS + x) * 4;
      imageData.data[pixelIndex] = 255;
      imageData.data[pixelIndex + 1] = 255;
      imageData.data[pixelIndex + 2] = 255;
      imageData.data[pixelIndex + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(imageData, 0, 0);
  sharedLightShaftTexture = new CanvasTexture(canvas);
  return sharedLightShaftTexture;
}
