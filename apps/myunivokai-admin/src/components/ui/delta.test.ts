import { describe, expect, it } from "vitest";
import { describeDelta } from "./delta";

const baseline = { current: 30, previous: 20, changePercent: 50, hasBaseline: true };

describe("describeDelta", () => {
  it("reports no baseline rather than a fabricated trend", () => {
    // The case this whole flag exists for: a service that was asleep, or a
    // platform deployed an hour ago. "+100%" against nothing is a movement
    // that never happened.
    expect(describeDelta({ ...baseline, previous: 0, hasBaseline: false }, true)).toEqual({
      kind: "no-baseline"
    });
    expect(describeDelta(undefined, true)).toEqual({ kind: "no-baseline" });
  });

  it("colours a rise by whether rising is the good direction", () => {
    // More requests is growth.
    expect(describeDelta(baseline, true)).toMatchObject({ kind: "good", label: "+50%" });
    // More errors, or a higher p95, is the same arithmetic and the opposite
    // conclusion. Getting this backwards makes every slowdown look like good
    // news, which is the failure mode this test exists to prevent.
    expect(describeDelta(baseline, false)).toMatchObject({ kind: "bad", label: "+50%" });
  });

  it("colours a fall by the same rule, inverted", () => {
    const falling = { current: 20, previous: 30, changePercent: -33.33, hasBaseline: true };
    expect(describeDelta(falling, true)).toMatchObject({ kind: "bad", label: "-33.33%" });
    expect(describeDelta(falling, false)).toMatchObject({ kind: "good", label: "-33.33%" });
  });

  it("treats no change as neither good nor bad", () => {
    const flat = { current: 20, previous: 20, changePercent: 0, hasBaseline: true };
    expect(describeDelta(flat, true)).toEqual({ kind: "flat", label: "0%" });
    expect(describeDelta(flat, false)).toEqual({ kind: "flat", label: "0%" });
  });

  it("keeps the sign in the label so the arrow is never the only cue", () => {
    // Colour and direction are both unavailable to a screen reader and to
    // anyone with a red/green deficiency. The text carries the sign.
    expect(describeDelta(baseline, true)).toMatchObject({ label: "+50%" });
    expect(
      describeDelta({ current: 1, previous: 4, changePercent: -75, hasBaseline: true }, true)
    ).toMatchObject({ label: "-75%" });
  });
});
