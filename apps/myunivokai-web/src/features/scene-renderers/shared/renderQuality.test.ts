import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_MINIMUM_PIXEL_RATIO,
  ADAPTIVE_PIXEL_RATIO_STEP,
  ADAPTIVE_TARGET_FRAMES_PER_SECOND,
  COMPOSER_MULTISAMPLING_STANDARD,
  adaptiveDevicePixelRatio,
  composerMultisamplingFor,
  shouldComputeAmbientOcclusionAtHalfResolution
} from "./renderQuality";

describe("composerMultisamplingFor", () => {
  it("buys the most anti-aliasing on the displays that need it", () => {
    // At dpr 1 there is nothing else smoothing an edge.
    expect(composerMultisamplingFor(1)).toBe(COMPOSER_MULTISAMPLING_STANDARD);
  });

  it("backs off as the display's own density takes over", () => {
    expect(composerMultisamplingFor(1.5)).toBeLessThan(composerMultisamplingFor(1));
    expect(composerMultisamplingFor(2)).toBeLessThan(composerMultisamplingFor(1.5));
    expect(composerMultisamplingFor(3)).toBeLessThanOrEqual(composerMultisamplingFor(2));
  });

  it("never turns anti-aliasing off entirely", () => {
    // A thin branch against a bright sky steps at any density, and the second
    // sample is the cheapest one there is.
    for (const pixelRatio of [1, 1.25, 1.5, 2, 2.5, 3, 4]) {
      expect(composerMultisamplingFor(pixelRatio)).toBeGreaterThanOrEqual(2);
    }
  });

  it("never rises with density", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let pixelRatio = 1; pixelRatio <= 4; pixelRatio += 0.25) {
      const samples = composerMultisamplingFor(pixelRatio);
      expect(samples).toBeLessThanOrEqual(previous);
      previous = samples;
    }
  });

  it("falls back to the full setting on a nonsense ratio", () => {
    // A zero here would otherwise read as "very low density" and buy the most
    // expensive path on a device that reported nothing useful.
    expect(composerMultisamplingFor(0)).toBe(COMPOSER_MULTISAMPLING_STANDARD);
    expect(composerMultisamplingFor(-1)).toBe(COMPOSER_MULTISAMPLING_STANDARD);
    expect(composerMultisamplingFor(Number.NaN)).toBe(COMPOSER_MULTISAMPLING_STANDARD);
  });
});

describe("shouldComputeAmbientOcclusionAtHalfResolution", () => {
  it("keeps AO at full resolution on a standard display", () => {
    expect(shouldComputeAmbientOcclusionAtHalfResolution(1)).toBe(false);
    expect(shouldComputeAmbientOcclusionAtHalfResolution(1.25)).toBe(false);
  });

  it("halves it once half is still as many samples as a standard display had", () => {
    expect(shouldComputeAmbientOcclusionAtHalfResolution(1.5)).toBe(true);
    expect(shouldComputeAmbientOcclusionAtHalfResolution(2)).toBe(true);
    expect(shouldComputeAmbientOcclusionAtHalfResolution(3)).toBe(true);
  });

  it("treats a nonsense ratio as a standard display", () => {
    expect(shouldComputeAmbientOcclusionAtHalfResolution(Number.NaN)).toBe(false);
  });
});

describe("adaptiveDevicePixelRatio", () => {
  it("jumps straight to the ratio the measurement asks for", () => {
    // The measured case: a forest at 2560x1440 on a HiDPI display renders at 30
    // fps. Half the frame rate wanted means half the pixels, and pixels go as
    // the ratio squared, so the ratio wants sqrt(0.5) = 0.707 of what it is —
    // 1.41, floored onto the grid at 1.25. One adjustment, not three.
    expect(adaptiveDevicePixelRatio(2, 30)).toBe(1.25);
    expect(adaptiveDevicePixelRatio(2, 15)).toBe(1);
  });

  it("still moves a whole step when the shortfall is tiny", () => {
    // sqrt(59/60) x 1.5 = 1.487, which floors straight back onto 1.25 anyway
    // here — but at ratios where it would quantise onto ITSELF, a scene would
    // sit missing frames forever with the controller reporting no change.
    expect(adaptiveDevicePixelRatio(1.5, 59)).toBeLessThanOrEqual(1.5 - ADAPTIVE_PIXEL_RATIO_STEP);
    expect(adaptiveDevicePixelRatio(3, 59.9)).toBeLessThanOrEqual(3 - ADAPTIVE_PIXEL_RATIO_STEP);
  });

  it("lands on the step grid, never between steps", () => {
    for (const framesPerSecond of [10, 22, 35, 47, 55, 59]) {
      for (const currentPixelRatio of [1.25, 1.5, 2, 2.5, 3]) {
        const next = adaptiveDevicePixelRatio(currentPixelRatio, framesPerSecond);
        expect(Math.round(next / ADAPTIVE_PIXEL_RATIO_STEP) * ADAPTIVE_PIXEL_RATIO_STEP).toBeCloseTo(next, 9);
      }
    }
  });

  it("never renders below the display's own CSS resolution", () => {
    // Past here the scene stops being the thing the product is selling. A
    // beautiful world at 40 fps beats a smeared one at 60.
    expect(adaptiveDevicePixelRatio(1, 12)).toBe(ADAPTIVE_MINIMUM_PIXEL_RATIO);
    expect(adaptiveDevicePixelRatio(ADAPTIVE_MINIMUM_PIXEL_RATIO, 5)).toBe(ADAPTIVE_MINIMUM_PIXEL_RATIO);
  });

  it("holds still the moment the target is met", () => {
    for (const framesPerSecond of [60, 61, 90, 144, 400]) {
      expect(adaptiveDevicePixelRatio(1.5, framesPerSecond)).toBe(1.5);
    }
  });

  it("NEVER climbs, whatever the headroom looks like", () => {
    // With vsync on, a scene holding 60 on a 60 Hz panel is indistinguishable
    // from one that could have managed 200. A climb rule was written against
    // that reading and made the ratio hunt: up a step, miss, down a step, hit,
    // up again — with the whole image visibly resampling on every swing.
    for (const framesPerSecond of [60, 120, 240, 1000]) {
      expect(adaptiveDevicePixelRatio(1, framesPerSecond)).toBeLessThanOrEqual(1);
    }
  });

  it("does nothing at all on a reading it cannot trust", () => {
    // The monitor reports 0 before it has enough samples, and a 0 read as
    // "missing frames" would drop the resolution on every scene mount.
    expect(adaptiveDevicePixelRatio(2, 0)).toBe(2);
    expect(adaptiveDevicePixelRatio(2, Number.NaN)).toBe(2);
    expect(adaptiveDevicePixelRatio(2, -30)).toBe(2);
  });

  it("converges in one or two readings and then sits still", () => {
    // Driven by a machine whose frame rate really does go as 1/pixels — 60 fps
    // at ratio 1.5 and proportionally worse above it — the controller has to
    // come to rest, and fast. The whole reason it is proportional rather than
    // stepped is that four visible resamples over seven seconds is not a smooth
    // start, so "eventually converges" is not the bar; two readings is.
    const framesPerSecondAt = (pixelRatio: number) => 60 * (1.5 / pixelRatio) ** 2;
    let pixelRatio = 3;
    const visited: number[] = [];
    for (let reading = 0; reading < 20; reading += 1) {
      pixelRatio = adaptiveDevicePixelRatio(pixelRatio, framesPerSecondAt(pixelRatio));
      visited.push(pixelRatio);
    }
    expect(visited[0]).toBeLessThanOrEqual(1.5);
    expect(new Set(visited).size).toBeLessThanOrEqual(2);
    expect(framesPerSecondAt(visited[visited.length - 1])).toBeGreaterThanOrEqual(60);
  });

  it("targets sixty, not whatever the panel happens to run at", () => {
    // A 30 Hz panel must not make 30 fps acceptable.
    expect(ADAPTIVE_TARGET_FRAMES_PER_SECOND).toBe(60);
    expect(adaptiveDevicePixelRatio(2, 31)).toBeLessThan(2);
  });
});
