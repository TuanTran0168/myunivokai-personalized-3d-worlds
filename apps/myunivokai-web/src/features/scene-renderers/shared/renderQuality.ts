/**
 * How much anti-aliasing and ambient-occlusion resolution to buy at a given
 * device pixel ratio.
 *
 * These scenes are FILL-RATE bound, not geometry bound, and that was measured
 * rather than assumed. On an RTX 4060 the forest holds 100 fps at 1600x900 and
 * 11 fps at 2560x1440 on a HiDPI display — while its draw calls stay at 83 and
 * its triangle count at 4.1 million, unchanged. Ten times the pixels, nine
 * times the frame time, the same geometry. Whatever is costing that is being
 * paid per pixel.
 *
 * So the lever is per-pixel work, and the honest place to take it from is the
 * work that STOPS PAYING as pixel density rises:
 *
 * Multisampling. At dpr 1 an 8x-multisampled buffer is the only thing keeping a
 * branch silhouette from stair-stepping. At dpr 2 the display is already
 * supersampling 4 device pixels into every CSS pixel, so 8x MSAA on top of it
 * is 32 samples per CSS pixel — and the marginal ones are invisible while
 * costing a full 8x resolve of an RGBA16F target every frame. At 5120x2880 that
 * resolve alone moves close to a gigabyte per frame.
 *
 * Ambient occlusion. AO is a low-frequency term: it darkens the crease where a
 * trunk meets the ground over tens of pixels, never one. Computing it at half
 * resolution and upsampling is what every engine that ships it does, and it
 * costs a quarter of the samples.
 *
 * NEITHER of these is a quality setting in the usual sense — nothing here trades
 * a visibly worse frame for a faster one. They remove work whose contribution
 * has already been made by the device's own pixel density. The scene keeps
 * rendering at full native resolution; the repo's quality-first stance is
 * intact. What backs off under genuine load is the pixel ratio itself, and that
 * is `adaptiveDevicePixelRatio` below, which only ever engages when frames are
 * actually being missed.
 */

/** Where the display's own pixel density starts doing the anti-aliasing. */
const HIGH_DENSITY_PIXEL_RATIO = 1.5;
const VERY_HIGH_DENSITY_PIXEL_RATIO = 2;

export const COMPOSER_MULTISAMPLING_STANDARD = 8;
export const COMPOSER_MULTISAMPLING_HIGH_DENSITY = 4;
export const COMPOSER_MULTISAMPLING_VERY_HIGH_DENSITY = 2;

/**
 * Samples per pixel for the composer's render target.
 *
 * Never zero. Two is a floor rather than "off" because a thin branch against a
 * bright sky still steps at any density, and the second sample is the cheapest
 * one there is.
 */
export function composerMultisamplingFor(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    return COMPOSER_MULTISAMPLING_STANDARD;
  }
  if (pixelRatio >= VERY_HIGH_DENSITY_PIXEL_RATIO) {
    return COMPOSER_MULTISAMPLING_VERY_HIGH_DENSITY;
  }
  if (pixelRatio >= HIGH_DENSITY_PIXEL_RATIO) {
    return COMPOSER_MULTISAMPLING_HIGH_DENSITY;
  }
  return COMPOSER_MULTISAMPLING_STANDARD;
}

/**
 * Whether ambient occlusion should be computed at half resolution.
 *
 * Only once the display is dense enough that half of it is still at least as
 * many samples as a standard display would have given the full-resolution pass.
 */
export function shouldComputeAmbientOcclusionAtHalfResolution(pixelRatio: number): boolean {
  return Number.isFinite(pixelRatio) && pixelRatio >= HIGH_DENSITY_PIXEL_RATIO;
}

// --- Adaptive pixel ratio -----------------------------------------------------
//
// The safety net, and the only thing here that ever costs sharpness.
//
// The scene starts at the display's native ratio and STAYS there unless frames
// are genuinely being missed — this machine renders the universe at 424 fps and
// has nothing to gain from being careful. What it is for is the case the
// measurements found: a 4K display, where even a 4060 renders the forest at 11
// fps, and where the alternative to a slightly softer frame is a slideshow.

/** The target every adjustment is aiming at. Below this, back off. */
export const ADAPTIVE_TARGET_FRAMES_PER_SECOND = 60;

/**
 * How long a scene is left alone before its frame rate is believed, how long
 * each measuring window then lasts, and how many bad windows in a row it takes
 * to act.
 *
 * None of these is politeness, and the first version of all three was too
 * eager. Measured: with a 1.2 s warm-up and a single bad window, the universe
 * family — which renders at 219 fps once it is running, three and a half times
 * the target — walked itself from a 3200x1800 buffer down to 2000x1125 in the
 * nine seconds after load. Every one of those steps was a reading taken while
 * the scene was still compiling shaders and uploading its 30 MB of textures.
 *
 * So: the controller does not start until the scene has SIGNALLED READY, waits
 * again after that, and then needs two consecutive slow windows before it gives
 * anything up. A single hitch — one texture decode, one garbage collection —
 * must not cost resolution for the life of the scene, because nothing ever
 * gives it back.
 *
 * The warm-up is re-armed after each adjustment too: changing the pixel ratio
 * reallocates every render target, and that frame is slow on its own.
 */
export const ADAPTIVE_WARM_UP_SECONDS = 2.5;
export const ADAPTIVE_SAMPLE_WINDOW_SECONDS = 1;
export const ADAPTIVE_SLOW_WINDOWS_BEFORE_ACTING = 2;

/**
 * Never softer than this, whatever the frame rate. Below about here the scene
 * stops being the thing the product is selling, and a beautiful world at 40 fps
 * beats a smeared one at 60.
 */
export const ADAPTIVE_MINIMUM_PIXEL_RATIO = 1;

/** Ratios are quantised to this, so the image lands on a small set of steps. */
export const ADAPTIVE_PIXEL_RATIO_STEP = 0.25;

/**
 * The next pixel ratio to render at. MONOTONIC and PROPORTIONAL: it starts at
 * the display's own ratio and only ever gives resolution back, jumping straight
 * to the ratio the measurement says will meet the target. It never climbs.
 *
 * Proportional because a fixed step is too slow to be invisible. Frame time in
 * these scenes is very close to linear in pixel count — measured: 1.44M pixels
 * at 9.7 ms, 5.76M at 23.6 ms, 14.7M at 85 ms on the same forest with the same
 * 83 draw calls and 4.1 million triangles throughout — and pixel count goes as
 * the ratio SQUARED. So a scene running at `fps` needs its ratio multiplied by
 * sqrt(fps / target), and that arrives in one adjustment instead of four. Four
 * visible resamples spread over seven seconds is not a smooth start.
 *
 * Monotonic because a climb rule was written first and measured worse than
 * nothing. With vsync on, a scene holding 60 fps on a 60 Hz panel is
 * indistinguishable from one that could have managed 200 — the reading is
 * clamped either way — so "is there headroom" cannot be answered from the frame
 * rate at all. Guessing that there was made the ratio hunt: up, miss, down, hit,
 * up again, with the whole image resampling on every swing.
 *
 * The cost of never climbing is real and accepted: a hitch that is over by the
 * time it is noticed still costs resolution for the life of that scene. A scene
 * mount resets it, and every world change is a scene mount.
 */
export function adaptiveDevicePixelRatio(currentPixelRatio: number, framesPerSecond: number): number {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    return currentPixelRatio;
  }
  if (framesPerSecond >= ADAPTIVE_TARGET_FRAMES_PER_SECOND) {
    return currentPixelRatio;
  }
  const requiredScale = Math.sqrt(framesPerSecond / ADAPTIVE_TARGET_FRAMES_PER_SECOND);
  // Floored onto the step grid, not rounded: rounding up lands on a ratio the
  // measurement has just said is too expensive, and the next window would only
  // have to undo it.
  const quantised =
    Math.floor((currentPixelRatio * requiredScale) / ADAPTIVE_PIXEL_RATIO_STEP) * ADAPTIVE_PIXEL_RATIO_STEP;
  return Math.max(
    ADAPTIVE_MINIMUM_PIXEL_RATIO,
    // Always at least one step, however small the shortfall: a ratio that
    // quantises back onto itself would leave the scene missing frames forever.
    Math.min(quantised, currentPixelRatio - ADAPTIVE_PIXEL_RATIO_STEP)
  );
}
