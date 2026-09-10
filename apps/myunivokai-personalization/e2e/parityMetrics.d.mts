/**
 * Types for the parity comparison helper.
 *
 * Same reason `frameMetrics.d.mts` exists: `parityMetrics.mjs` stays plain
 * JavaScript so it can be run and reused under bare `node` alongside
 * `measure.mjs` and the demos' own measure scripts, and declaring its surface
 * here means `scene-parity.spec.ts` imports it with real types instead of a
 * `@ts-ignore` — the difference between a typed boundary and a hole.
 */

export type ParityTolerance = {
  /** Mean per-channel byte error over the whole frame. */
  meanAbsoluteError: number;
  /** Mean error inside the worst 16x16 block — the local-failure detector. */
  worstBlockError: number;
  /** Share of pixels past PIXEL_NOISE_FLOOR on any channel. */
  differingFraction: number;
};

export type ParityComparison = ParityTolerance & {
  /** Top-left corner of the worst block, in frame pixels. */
  worstBlockAt: { x: number; y: number };
  pixelCount: number;
};

export type DecodedFrame = {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major from the top. */
  pixels: Buffer;
};

/**
 * PNG → RGBA. `inflateSync` is passed in rather than imported so this module
 * stays free of node-only imports and can be read by a browser page too.
 */
export function inflatePng(buffer: Buffer, inflateSync: (input: Buffer) => Buffer): DecodedFrame;

/** Throws when the two frames are different sizes — a harness fault, not a parity one. */
export function compareFrames(left: DecodedFrame, right: DecodedFrame): ParityComparison;

/** Which tolerances a comparison broke, named, or an empty array. */
export function toleranceBreaches(comparison: ParityComparison, tolerance: ParityTolerance): string[];

export function describeComparison(comparison: ParityComparison): string;

/** Two runs of the SAME renderer. The stability gate; assert it first. */
export const SAME_RENDERER_TOLERANCE: ParityTolerance;
/** Two DIFFERENT backends. Looser on purpose, and deliberately not zero. */
export const CROSS_BACKEND_TOLERANCE: ParityTolerance;
/** Per-channel byte difference below which a pixel counts as unchanged. */
export const PIXEL_NOISE_FLOOR: number;
