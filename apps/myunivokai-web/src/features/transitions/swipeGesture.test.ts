import { describe, expect, it } from "vitest";
import {
  SCENE_SWIPE_DURATION_MILLISECONDS,
  SCENE_SWIPE_OUTGOING_OPACITY,
  SCENE_SWIPE_OUTGOING_SCALE,
  SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT,
  isSceneSwipeWorthPlaying,
  sceneSwipeCustomProperties,
  swipeDirectionBetween
} from "./swipeGesture";

describe("swipeDirectionBetween", () => {
  it("sends the old world left when moving forward through the list", () => {
    // Universe (0) -> Ocean (2): the finger drags right-to-left, so the world
    // being left goes off to the left and the new one arrives from the right.
    expect(swipeDirectionBetween(0, 2)).toBe(-1);
    expect(swipeDirectionBetween(1, 2)).toBe(-1);
  });

  it("reverses when moving back up the list", () => {
    expect(swipeDirectionBetween(2, 0)).toBe(1);
    expect(swipeDirectionBetween(1, 0)).toBe(1);
  });

  it("still picks a direction for a world with no position to compare", () => {
    // A freshly regenerated variant is not in the list the switch is measured
    // against, so findIndex hands back -1 for it. Going nowhere is not an
    // option — the scene container has to end up back at zero either way.
    expect([-1, 1]).toContain(swipeDirectionBetween(-1, -1));
    expect([-1, 1]).toContain(swipeDirectionBetween(3, -1));
    expect([-1, 1]).toContain(swipeDirectionBetween(-1, 0));
  });

  it("reads a brand new variant as forward", () => {
    // `world.variants` has not been re-fetched into the closure yet when a
    // regenerate fires, so both positions come back -1 and this is the case
    // that decides what a newly made world does. Forward: it is the next one.
    expect(swipeDirectionBetween(-1, -1)).toBe(-1);
  });
});

describe("isSceneSwipeWorthPlaying", () => {
  it("plays when the world actually changed", () => {
    expect(isSceneSwipeWorthPlaying("universe", "ocean")).toBe(true);
    expect(isSceneSwipeWorthPlaying("variant-a", "variant-b")).toBe(true);
  });

  it("declines when the visitor re-picked what was already selected", () => {
    // Sliding a world off to bring the identical world back reads as a glitch.
    expect(isSceneSwipeWorthPlaying("ocean", "ocean")).toBe(false);
  });

  it("declines rather than swiping out of or into nothing", () => {
    // The world page has no active variant until its first fetch lands.
    expect(isSceneSwipeWorthPlaying("", "variant-a")).toBe(false);
    expect(isSceneSwipeWorthPlaying("variant-a", "")).toBe(false);
  });
});

describe("sceneSwipeCustomProperties", () => {
  it("carries the direction as the sign the keyframes multiply by", () => {
    // One keyframe pair serves both directions. If this stopped being +1/-1
    // the `calc(var(--scene-swipe-direction) * -100%)` in globals.css would
    // silently produce a panel that starts somewhere other than off screen.
    expect(sceneSwipeCustomProperties(-1)["--scene-swipe-direction"]).toBe("-1");
    expect(sceneSwipeCustomProperties(1)["--scene-swipe-direction"]).toBe("1");
  });

  it("hands the stylesheet every number it needs, in CSS units", () => {
    const properties = sceneSwipeCustomProperties(-1);
    expect(properties["--scene-swipe-duration"]).toBe(`${SCENE_SWIPE_DURATION_MILLISECONDS}ms`);
    expect(properties["--scene-swipe-travel"]).toBe(`${SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT}%`);
    expect(properties["--scene-swipe-opacity"]).toBe(String(SCENE_SWIPE_OUTGOING_OPACITY));
    expect(properties["--scene-swipe-scale"]).toBe(String(SCENE_SWIPE_OUTGOING_SCALE));
    expect(properties["--scene-swipe-easing"]).toMatch(/^cubic-bezier\(/);
  });

  it("names every property the keyframes read, and nothing else", () => {
    // The stylesheet reads exactly these. An unset custom property inside a
    // keyframe makes the whole declaration invalid at computed-value time, so
    // the animation silently does nothing rather than failing loudly.
    expect(Object.keys(sceneSwipeCustomProperties(1)).sort()).toEqual([
      "--scene-swipe-direction",
      "--scene-swipe-duration",
      "--scene-swipe-easing",
      "--scene-swipe-opacity",
      "--scene-swipe-scale",
      "--scene-swipe-travel"
    ]);
  });
});

describe("the gesture's proportions", () => {
  it("keeps the leaving panel slower than the arriving one", () => {
    // The parallax IS the effect. At 100 the two panels travel together and the
    // whole thing reads as a slideshow on a rail rather than as one screen
    // sliding over another.
    expect(SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT).toBeGreaterThan(0);
    expect(SCENE_SWIPE_OUTGOING_TRAVEL_PERCENT).toBeLessThan(50);
  });

  it("never fully hides or collapses the panel being left", () => {
    // It has to still be a world going away, not a rectangle being deleted.
    expect(SCENE_SWIPE_OUTGOING_OPACITY).toBeGreaterThan(0.2);
    expect(SCENE_SWIPE_OUTGOING_OPACITY).toBeLessThan(1);
    expect(SCENE_SWIPE_OUTGOING_SCALE).toBeGreaterThan(0.85);
    expect(SCENE_SWIPE_OUTGOING_SCALE).toBeLessThanOrEqual(1);
  });

  it("stays short enough to read as a response rather than a wait", () => {
    // Between a click and the thing that was clicked for. iOS pushes a view in
    // about 350 ms; anything past half a second stops feeling like a reaction.
    expect(SCENE_SWIPE_DURATION_MILLISECONDS).toBeGreaterThanOrEqual(250);
    expect(SCENE_SWIPE_DURATION_MILLISECONDS).toBeLessThanOrEqual(500);
  });
});
