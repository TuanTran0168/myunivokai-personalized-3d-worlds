/**
 * Small math helpers shared by the CPU procedural bakes (gas giant surfaces,
 * planet ring strips, moon geometry). Kept dependency-free on purpose: these
 * run inside canvas/geometry bake loops, and the hex parser deliberately
 * avoids three.js Color, whose color management would convert hex values to
 * the linear working space and double-convert once the baked canvas is
 * tagged SRGBColorSpace.
 */

export type RgbTriple = [number, number, number];

export function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)));
  return normalized * normalized * (3 - 2 * normalized);
}

/** Parses #RRGGBB into raw sRGB 0-255 channels. */
export function hexColorToRgbTriple(hexColor: string): RgbTriple {
  const normalized = hexColor.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
}
