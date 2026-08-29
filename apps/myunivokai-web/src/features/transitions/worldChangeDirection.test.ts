import { describe, expect, it } from "vitest";
import { isWorldChangeWorthPlaying, worldChangeDirectionBetween } from "./worldChangeDirection";

describe("worldChangeDirectionBetween", () => {
  it("reads moving down the list as forward", () => {
    // Universe (0) -> Ocean (2): forward, which sends the world being left off
    // the leading edge, the way a finger dragging right-to-left would.
    expect(worldChangeDirectionBetween(0, 2)).toBe(-1);
    expect(worldChangeDirectionBetween(1, 2)).toBe(-1);
  });

  it("reverses when moving back up the list", () => {
    expect(worldChangeDirectionBetween(2, 0)).toBe(1);
    expect(worldChangeDirectionBetween(1, 0)).toBe(1);
  });

  it("still picks a direction for a world with no position to compare", () => {
    // A freshly regenerated variant is not in the list the change is measured
    // against, so findIndex hands back -1 for it. Going nowhere is not an
    // option — the world has to leave in SOME direction.
    expect([-1, 1]).toContain(worldChangeDirectionBetween(-1, -1));
    expect([-1, 1]).toContain(worldChangeDirectionBetween(3, -1));
    expect([-1, 1]).toContain(worldChangeDirectionBetween(-1, 0));
  });

  it("reads a brand new variant as forward", () => {
    // `world.variants` has not been re-fetched into the closure yet when a
    // regenerate fires, so both positions come back -1 and this is the case
    // that decides what a newly made world does. Forward: it is the next one.
    expect(worldChangeDirectionBetween(-1, -1)).toBe(-1);
  });
});

describe("isWorldChangeWorthPlaying", () => {
  it("plays when the world actually changed", () => {
    expect(isWorldChangeWorthPlaying("universe", "ocean")).toBe(true);
    expect(isWorldChangeWorthPlaying("variant-a", "variant-b")).toBe(true);
  });

  it("declines when the visitor re-picked what was already selected", () => {
    // Taking a world away to bring the identical world back reads as a glitch.
    expect(isWorldChangeWorthPlaying("ocean", "ocean")).toBe(false);
  });

  it("declines rather than transitioning out of or into nothing", () => {
    // The world page has no active variant until its first fetch lands.
    expect(isWorldChangeWorthPlaying("", "variant-a")).toBe(false);
    expect(isWorldChangeWorthPlaying("variant-a", "")).toBe(false);
  });
});
