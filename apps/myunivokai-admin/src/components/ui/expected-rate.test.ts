import { describe, expect, it } from "vitest";
import { expectedRate } from "./expected-rate";

describe("expectedRate", () => {
  it("refuses to draw a band it cannot support", () => {
    // 5% over 40 worlds expects two hits. Anything from zero to five is
    // ordinary, which is a range so wide that drawing it would suggest a
    // precision that is not there.
    const band = expectedRate(5, 40, 10);
    expect(band.kind).toBe("too-few");
    // 5 / 0.05 = 100 worlds before the rare side reaches five expected hits.
    expect(band).toMatchObject({ worldsNeeded: 100 });
  });

  it("counts the RARER side, so a common feature needs the misses", () => {
    // A 95% feature is not "safe at 20 worlds" because it expects 19 hits —
    // it is the single expected MISS that makes the approximation fail.
    expect(expectedRate(95, 20, 95).kind).toBe("too-few");
    expect(expectedRate(95, 200, 95).kind).toBe("range");
  });

  it("says nothing at all when there is nothing to measure", () => {
    expect(expectedRate(40, 0, 0)).toEqual({ kind: "no-worlds" });
  });

  it("brackets the configured rate, not the observed one", () => {
    // The band answers "where should this land if the lottery is correct",
    // so it must sit around 40 regardless of what was actually observed.
    const band = expectedRate(40, 200, 12);
    expect(band.kind).toBe("range");
    if (band.kind !== "range") {
      return;
    }
    expect(band.lowPercent).toBeLessThan(40);
    expect(band.highPercent).toBeGreaterThan(40);
    // 1.96 * sqrt(0.4*0.6/200) = 6.79 percentage points.
    expect(band.lowPercent).toBeCloseTo(33.21, 2);
    expect(band.highPercent).toBeCloseTo(46.79, 2);
    // 12% is nowhere near it — this is the case worth investigating.
    expect(band.withinExpectation).toBe(false);
  });

  it("treats a rate inside the band as ordinary", () => {
    const band = expectedRate(40, 200, 43);
    expect(band).toMatchObject({ withinExpectation: true });
  });

  it("keeps the band inside 0-100", () => {
    // A wide margin on a low rate would otherwise render a negative percentage,
    // which no bar can draw and no reader can interpret.
    const band = expectedRate(6, 200, 6);
    expect(band).toMatchObject({ kind: "range" });
    if (band.kind !== "range") {
      return;
    }
    expect(band.lowPercent).toBeGreaterThanOrEqual(0);
    expect(band.highPercent).toBeLessThanOrEqual(100);
  });
});
