import { describe, expect, it } from "vitest";
import type { GenieRectangle } from "./genieWarp";
import {
  WORLD_CHANGE_ARRIVE_MILLISECONDS,
  WORLD_CHANGE_DEPART_MILLISECONDS,
  WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS,
  WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS,
  isHoldFinished,
  worldChangeSlot
} from "./worldChangeStages";

const FRAME: GenieRectangle = { left: 0, top: 0, width: 1000, height: 600 };

describe("worldChangeSlot", () => {
  it("puts the slot off the leading edge when moving forward", () => {
    const slot = worldChangeSlot(FRAME, -1);
    // Its right edge is still inside the frame, its left edge is not: the
    // collapse reads as the world being drawn OFF the screen rather than being
    // sucked into a point somewhere in the middle of it.
    expect(slot.left).toBeLessThan(FRAME.left);
    expect(slot.left + slot.width).toBeGreaterThan(FRAME.left);
  });

  it("mirrors to the trailing edge when moving back", () => {
    const forward = worldChangeSlot(FRAME, -1);
    const backward = worldChangeSlot(FRAME, 1);
    expect(backward.left).toBeGreaterThan(forward.left);
    expect(backward.left + backward.width).toBeGreaterThan(FRAME.left + FRAME.width);
    // Same slot, other end. A gesture that changed shape as well as side would
    // read as two different effects rather than one with a direction.
    expect(backward.width).toBeCloseTo(forward.width);
    expect(backward.height).toBeCloseTo(forward.height);
    expect(backward.top).toBeCloseTo(forward.top);
  });

  it("centres the slot vertically", () => {
    const slot = worldChangeSlot(FRAME, -1);
    expect(slot.top + slot.height / 2).toBeCloseTo(FRAME.top + FRAME.height / 2);
  });

  it("scales with the container rather than sitting at a fixed pixel size", () => {
    // The same gesture on a phone and on a 4K panel. A slot in pixels would be
    // a third of a phone's width and a rounding error on a monitor.
    const small = worldChangeSlot({ left: 0, top: 0, width: 400, height: 300 }, -1);
    const large = worldChangeSlot({ left: 0, top: 0, width: 3840, height: 2160 }, -1);
    expect(small.width / 400).toBeCloseTo(large.width / 3840);
    expect(small.height / 300).toBeCloseTo(large.height / 2160);
  });

  it("respects the container's own origin", () => {
    // The overlay draws in its own coordinates on a world change and in
    // viewport coordinates nowhere — but the helper must not assume either.
    const offset = worldChangeSlot({ left: 120, top: 80, width: 1000, height: 600 }, 1);
    const atOrigin = worldChangeSlot(FRAME, 1);
    expect(offset.left - atOrigin.left).toBeCloseTo(120);
    expect(offset.top - atOrigin.top).toBeCloseTo(80);
  });

  it("keeps the slot small enough to read as a collapse", () => {
    const slot = worldChangeSlot(FRAME, -1);
    // Past about a quarter of the frame the "collapse" is just a shrink, and
    // the neck that sells the suction has nothing to pinch against.
    expect(slot.width).toBeLessThan(FRAME.width * 0.25);
    expect(slot.height).toBeLessThan(FRAME.height * 0.25);
    expect(slot.width).toBeGreaterThan(0);
    expect(slot.height).toBeGreaterThan(0);
  });
});

describe("isHoldFinished", () => {
  it("keeps holding while the destination is still mounting", () => {
    expect(isHoldFinished(0, false)).toBe(false);
    expect(isHoldFinished(2500, false)).toBe(false);
  });

  it("still holds its floor even when the destination was ready at once", () => {
    // A warm switch resolves in about 200 ms. Without the floor the loader
    // would appear and vanish inside a handful of frames, which reads as a
    // flicker — worse than no loader, because the eye registers that something
    // happened and never finds out what.
    expect(isHoldFinished(0, true)).toBe(false);
    expect(isHoldFinished(WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS - 1, true)).toBe(false);
    expect(isHoldFinished(WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS, true)).toBe(true);
  });

  it("gives up on a destination that never reports ready", () => {
    // A renderer that threw, a chunk that failed to load, a context that never
    // came back. The overlay covers the whole scene, and it is the last thing
    // that should still be there when something has gone wrong underneath it.
    expect(isHoldFinished(WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS, false)).toBe(true);
  });

  it("leaves room for the worst cold compile ever measured here", () => {
    // ~2.8 s, profiled on this project's own hardware. A ceiling below that
    // would cut a slow-but-perfectly-fine machine short every single time.
    expect(WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS).toBeGreaterThan(3000);
    expect(WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS).toBeLessThan(
      WORLD_CHANGE_MAXIMUM_HOLD_MILLISECONDS
    );
  });
});

describe("the transition's proportions", () => {
  it("leaves and arrives at the same speed", () => {
    // Asymmetry here would read as one of the two worlds mattering more.
    expect(WORLD_CHANGE_DEPART_MILLISECONDS).toBe(WORLD_CHANGE_ARRIVE_MILLISECONDS);
  });

  it("keeps the whole warm-path transition under two seconds", () => {
    // Depart + floor + arrive is what a visitor pays on a family they have
    // already opened once. Past about two seconds a transition stops being a
    // transition and becomes a loading screen.
    const warmPath =
      WORLD_CHANGE_DEPART_MILLISECONDS +
      WORLD_CHANGE_MINIMUM_HOLD_MILLISECONDS +
      WORLD_CHANGE_ARRIVE_MILLISECONDS;
    expect(warmPath).toBeLessThan(2000);
  });
});
