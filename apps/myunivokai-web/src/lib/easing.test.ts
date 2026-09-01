import { describe, expect, it } from "vitest";
import { clampUnitInterval, easeInOutCubic, easeInQuad, lerp, staggeredProgress } from "./easing";

describe("clampUnitInterval", () => {
  it("passes values in range through", () => {
    expect(clampUnitInterval(0.42)).toBe(0.42);
  });

  it("clamps rather than extrapolating", () => {
    expect(clampUnitInterval(-2)).toBe(0);
    expect(clampUnitInterval(9)).toBe(1);
  });

  it("treats a nonsense value as the start, never as NaN downstream", () => {
    expect(clampUnitInterval(Number.NaN)).toBe(0);
    expect(clampUnitInterval(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("easeInOutCubic", () => {
  it("pins both ends", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("starts slower than it finishes the first half", () => {
    // The gentle release is the whole point of choosing in-out over out.
    const firstTenth = easeInOutCubic(0.1) - easeInOutCubic(0);
    const tenthBeforeMidpoint = easeInOutCubic(0.5) - easeInOutCubic(0.4);
    expect(firstTenth).toBeLessThan(tenthBeforeMidpoint);
  });

  it("rises monotonically", () => {
    let previous = -1;
    for (let step = 0; step <= 40; step++) {
      const value = easeInOutCubic(step / 40);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("easeInQuad", () => {
  it("pins both ends and leaves slowly", () => {
    expect(easeInQuad(0)).toBe(0);
    expect(easeInQuad(1)).toBe(1);
    expect(easeInQuad(0.5)).toBeLessThan(0.5);
  });
});

describe("lerp", () => {
  it("returns the endpoints exactly", () => {
    expect(lerp(4, 10, 0)).toBe(4);
    expect(lerp(4, 10, 1)).toBe(10);
  });

  it("interpolates in between", () => {
    expect(lerp(4, 10, 0.5)).toBe(7);
  });
});

describe("staggeredProgress", () => {
  it("holds a delayed member at the start until its turn", () => {
    expect(staggeredProgress(0.2, 0.5)).toBe(0);
    expect(staggeredProgress(0.5, 0.5)).toBe(0);
  });

  it("covers the whole distance in what remains of the run", () => {
    expect(staggeredProgress(0.75, 0.5)).toBeCloseTo(0.5, 9);
    expect(staggeredProgress(1, 0.5)).toBe(1);
  });

  it("leaves an undelayed member on the raw progress", () => {
    expect(staggeredProgress(0.3, 0)).toBeCloseTo(0.3, 9);
  });

  it("lands every member on 1 at the end of the run, whatever its delay", () => {
    // Load-bearing: a row that does not finish leaves a seam in the frame it
    // was supposed to have handed back to the real canvas.
    for (let step = 0; step <= 10; step++) {
      expect(staggeredProgress(1, step / 10)).toBe(1);
    }
  });

  it("does not divide by a zero remainder when a member is delayed the whole run", () => {
    expect(staggeredProgress(0.9, 1)).toBe(0);
    expect(staggeredProgress(1, 1)).toBe(1);
  });
});
