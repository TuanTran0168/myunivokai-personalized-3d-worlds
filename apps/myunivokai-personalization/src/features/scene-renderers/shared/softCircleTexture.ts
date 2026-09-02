import { CanvasTexture } from "three";

/**
 * A tiny runtime-generated sprite: a soft radial white circle fading to
 * transparent. three.js renders untextured points as hard SQUARES — any
 * point layer big enough to see needs this map to read as a star/glow.
 * Lazy singleton: one canvas, shared by every material that asks.
 */

const TEXTURE_SIZE_PIXELS = 64;
const GRADIENT_INNER_STOP = 0.15;

let sharedSoftCircleTexture: CanvasTexture | null = null;

export function getSoftCircleTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (sharedSoftCircleTexture) {
    return sharedSoftCircleTexture;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE_PIXELS;
  canvas.height = TEXTURE_SIZE_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const center = TEXTURE_SIZE_PIXELS / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(GRADIENT_INNER_STOP, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, TEXTURE_SIZE_PIXELS, TEXTURE_SIZE_PIXELS);
  sharedSoftCircleTexture = new CanvasTexture(canvas);
  return sharedSoftCircleTexture;
}
