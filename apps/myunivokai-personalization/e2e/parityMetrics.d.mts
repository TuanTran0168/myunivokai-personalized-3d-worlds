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

/**
 * Standard deviation of per-pixel luminance over the frame's centred half: how
 * much structure the frame has WHERE THE SCENE IS.
 *
 * The crop is load-bearing. A Playwright element screenshot is a viewport
 * capture clipped to the element's box, so a shot of the scene canvas contains
 * every HTML overlay on top of it — enough structure to pass an empty 3D canvas.
 *
 * A frame filled with one colour measures 0. The gate that asks whether a leg
 * drew anything at all, before any comparison asks whether two legs agree.
 */
export function luminanceStandardDeviation(frame: DecodedFrame): number;

/** The luminance deviation below which a frame is called blank. */
export const BLANK_FRAME_LUMINANCE_DEVIATION: number;

/**
 * Share of pixels with any channel at or above `clippedByte`.
 *
 * The one-frame measurement: a missing tone curve clips every frame including
 * the reference, so no comparison between frames can see it.
 */
export function clippedChannelFraction(frame: DecodedFrame, clippedByte?: number): number;

/** The byte at which a channel counts as clipped. */
export const CLIPPED_CHANNEL_BYTE: number;

/** Two runs of the SAME renderer. The stability gate; assert it first. */
export const SAME_RENDERER_TOLERANCE: ParityTolerance;
/** Two DIFFERENT backends. Looser on purpose, and deliberately not zero. */
export const CROSS_BACKEND_TOLERANCE: ParityTolerance;
/** Per-channel byte difference below which a pixel counts as unchanged. */
export const PIXEL_NOISE_FLOOR: number;
