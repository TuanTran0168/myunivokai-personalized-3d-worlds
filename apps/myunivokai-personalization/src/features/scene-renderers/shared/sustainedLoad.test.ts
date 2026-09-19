import { describe, expect, it } from "vitest";
import {
  percentileOf,
  summariseSustainedLoad,
  sustainedFrameTimestamps,
  SIXTY_FRAMES_PER_SECOND_BUDGET_MILLISECONDS,
  SUSTAINED_FRAME_INTERVAL_SECONDS,
  SUSTAINED_SAMPLE_FRAME_COUNT,
  SUSTAINED_WARM_UP_FRAME_COUNT
} from "./sustainedLoad";

/** One to a hundred, so a percentile's answer is its own index. */
const ONE_TO_ONE_HUNDRED = Array.from({ length: 100 }, (_, index) => index + 1);

describe("percentileOf", () => {
  it("returns a value that was actually measured, never an interpolation", () => {
    // THE PROPERTY THIS FUNCTION EXISTS FOR. An interpolated p99 of a frame-time
    // list is a duration no frame ever took, and the tail is the whole point:
    // the repo's bar is a floor, and a floor is broken by real worst frames.
    expect(percentileOf(ONE_TO_ONE_HUNDRED, 50)).toBe(50);
    expect(percentileOf(ONE_TO_ONE_HUNDRED, 95)).toBe(95);
    expect(percentileOf(ONE_TO_ONE_HUNDRED, 99)).toBe(99);
    expect(percentileOf(ONE_TO_ONE_HUNDRED, 100)).toBe(100);
  });

  it("clamps rather than reading off the end", () => {
    expect(percentileOf([7], 99)).toBe(7);
    expect(percentileOf([], 50)).toBe(0);
    expect(percentileOf([1, 2, 3], 0)).toBe(1);
  });
});

describe("summariseSustainedLoad", () => {
  it("summarises an unsorted list without needing it sorted first", () => {
    const report = summariseSustainedLoad([9, 1, 5, 3, 7]);
    expect(report.frameCount).toBe(5);
    expect(report.medianMilliseconds).toBe(5);
    expect(report.worstMilliseconds).toBe(9);
    expect(report.meanMilliseconds).toBe(5);
    expect(report.totalMilliseconds).toBe(25);
  });

  it("counts frames over a 60 fps budget, which is the number the bar is about", () => {
    const justUnder = SIXTY_FRAMES_PER_SECOND_BUDGET_MILLISECONDS - 0.1;
    const justOver = SIXTY_FRAMES_PER_SECOND_BUDGET_MILLISECONDS + 0.1;
    const report = summariseSustainedLoad([justUnder, justUnder, justOver, justOver, justOver]);
    expect(report.framesOverBudget).toBe(3);
  });

  it("survives an empty run rather than reporting NaN", () => {
    // A renderer that failed to build reports no frames, and a NaN percentile
    // in a table reads as a measurement rather than as an absence.
    const report = summariseSustainedLoad([]);
    expect(report.frameCount).toBe(0);
    expect(report.meanMilliseconds).toBe(0);
    expect(report.worstMilliseconds).toBe(0);
    expect(report.framesOverBudget).toBe(0);
  });
});

describe("sustainedFrameTimestamps", () => {
  it("steps at the cadence the app's motion was authored against", () => {
    const timestamps = sustainedFrameTimestamps(3);
    expect(timestamps).toHaveLength(3);
    expect(timestamps[0]).toBeCloseTo(SUSTAINED_FRAME_INTERVAL_SECONDS, 10);
    expect(timestamps[2] - timestamps[1]).toBeCloseTo(SUSTAINED_FRAME_INTERVAL_SECONDS, 10);
  });

  it("continues the warm-up's timeline instead of restarting it", () => {
    // Restarting at zero would hand every integrating thing in the scene — the
    // camera's easing, a drifter's position — its opening state a second time,
    // and the sampled frames would be measuring the intro rather than the
    // settled scene. `ParityHarnessBridge` records the same trap.
    const continued = sustainedFrameTimestamps(2, SUSTAINED_WARM_UP_FRAME_COUNT);
    expect(continued[0]).toBeCloseTo((SUSTAINED_WARM_UP_FRAME_COUNT + 1) * SUSTAINED_FRAME_INTERVAL_SECONDS, 10);
  });

  it("samples long enough for a 99th percentile to be more than one frame", () => {
    // 300 frames means p99 is the worst three, not the worst one. A single
    // unlucky frame should not be able to name the tail by itself.
    expect(SUSTAINED_SAMPLE_FRAME_COUNT * 0.01).toBeGreaterThanOrEqual(3);
  });
});
