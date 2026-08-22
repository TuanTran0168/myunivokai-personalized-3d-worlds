/**
 * Types for the plain-ESM measurement helper.
 *
 * `frameMetrics.mjs` stays JavaScript because `measure.mjs` is run directly with
 * `node` and has no build step. Declaring its surface here means the budget test
 * imports it with real types rather than a `@ts-ignore`, which is the difference
 * between a typed boundary and a hole.
 */

export type FrameMetrics = {
  /** Mean perceived brightness, 0..1. */
  luma: number;
  /** Fraction of pixels at or near pure white. */
  blown: number;
  /** Fraction at or near pure black. */
  crush: number;
  /** Mean HSV saturation. */
  sat: number;
  /** Mean absolute luma difference between neighbouring pixels, x100. */
  detail: number;
  /** Average colour as a `#rrggbb` string. */
  mean: string;
};

export type MeasurementWindow = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Measure one PNG. `isReference` selects the prototype's chrome mask (a left
 * crop) instead of the app's (a central band) — see APP_WINDOW in the source for
 * why the two differ and why it matters.
 */
export function measureFrame(path: string, isReference: boolean): FrameMetrics;

export const APP_WINDOW_DESKTOP: MeasurementWindow;
export const APP_WINDOW_MOBILE: MeasurementWindow;

/** The window for a frame of this pixel width. Derived, never passed in. */
export function appWindowForWidth(width: number): MeasurementWindow;
export const REFERENCE_WINDOW: MeasurementWindow;
/**
 * False for frames that contain no rendered scene, which must not be given scene
 * metrics. See the source for which and why.
 */
export function isSceneFrame(project: string, name: string): boolean;

export const REFERENCE_PREFIX: string;
export const SHOTS_ROOT: string;
