import { describe, expect, it } from "vitest";
import {
  CAMERA_INTRO_DURATION_SECONDS,
  CAMERA_INTRO_MAXIMUM_FRAME_SECONDS,
  CAMERA_INTRO_POSES,
  CAMERA_INTRO_START_POSE,
  cameraIntroFrameSeconds,
  cameraIntroOffsetAt,
  cameraIntroProgress,
  cameraIntroStartOffset,
  pickCameraIntroPose,
  type SphericalOffset,
  type SphericalOffsetLimits
} from "./cameraIntro";

const FOREST_LIKE_LIMITS: SphericalOffsetLimits = {
  minimumRadius: 3,
  maximumRadius: 70,
  maximumPolarRadians: Math.PI * 0.492
};

describe("cameraIntroProgress", () => {
  it("is complete immediately when the move is disabled", () => {
    // Reduced motion and the ambient gallery backdrops both pass 0.
    expect(cameraIntroProgress(0, 0)).toBe(1);
  });

  it("clamps a long frame to the end of the move", () => {
    expect(cameraIntroProgress(9, 2.2)).toBe(1);
  });

  it("reports the fraction elapsed mid-move", () => {
    expect(cameraIntroProgress(1.1, 2.2)).toBeCloseTo(0.5, 6);
  });
});

describe("cameraIntroFrameSeconds", () => {
  it("passes an ordinary frame through untouched", () => {
    expect(cameraIntroFrameSeconds(1 / 60)).toBeCloseTo(1 / 60, 9);
    expect(cameraIntroFrameSeconds(1 / 30)).toBeCloseTo(1 / 30, 9);
  });

  it("does not let a stalled frame fast-forward the move", () => {
    // The measured regression: the first frame after the entry armed took 4.2
    // seconds while shaders compiled, and an unclamped delta spent the entire
    // 2.2 s move on it — the camera cut back to the resting framing in one
    // 2.48-unit jump and the entrance never appeared.
    expect(cameraIntroFrameSeconds(4.2)).toBe(CAMERA_INTRO_MAXIMUM_FRAME_SECONDS);
    expect(cameraIntroFrameSeconds(4.2)).toBeLessThan(CAMERA_INTRO_DURATION_SECONDS);
  });

  it("treats a zero or nonsense delta as no time at all", () => {
    expect(cameraIntroFrameSeconds(0)).toBe(0);
    expect(cameraIntroFrameSeconds(-1)).toBe(0);
    expect(cameraIntroFrameSeconds(Number.NaN)).toBe(0);
  });
});

describe("CAMERA_INTRO_POSES", () => {
  it("keeps every shot gentle — a step and a shoulder turn, not a fly-through", () => {
    for (const pose of CAMERA_INTRO_POSES) {
      expect(Math.abs(pose.radiusScale - 1)).toBeLessThanOrEqual(0.35);
      expect(Math.abs(pose.polarOffsetRadians)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(pose.azimuthOffsetRadians)).toBeLessThanOrEqual(0.25);
    }
  });

  it("gives every shot a sideways component, the one axis no envelope can clamp", () => {
    // Radius and polar angle can both be flattened to nothing by a family's
    // limits — a forest shot already at its 70-unit ceiling and grazing its
    // ground plane has nowhere to go on either. A bearing wraps instead of
    // stopping, so this is what stops a clamped pose becoming no move at all.
    for (const pose of CAMERA_INTRO_POSES) {
      expect(Math.abs(pose.azimuthOffsetRadians)).toBeGreaterThan(0.03);
    }
  });

  it("never starts a shot BELOW the framing it is settling onto", () => {
    // The ocean's camera sits at the viewer's own depth plane and a scene
    // composed a couple of metres off the seabed has no room underneath it. A
    // pose that dipped there would trip CameraRig's terrain clamp, which lifts
    // the orbit TARGET with the camera — and the entrance would hand back a
    // resting framing a few metres higher than the family composed.
    for (const pose of CAMERA_INTRO_POSES) {
      expect(pose.polarOffsetRadians).toBeLessThanOrEqual(0);
    }
  });

  it("holds shots that are actually distinguishable from each other", () => {
    // Two poses a few thousandths apart are one pose with extra bookkeeping.
    for (let index = 0; index < CAMERA_INTRO_POSES.length; index++) {
      for (let other = index + 1; other < CAMERA_INTRO_POSES.length; other++) {
        const a = CAMERA_INTRO_POSES[index];
        const b = CAMERA_INTRO_POSES[other];
        const separation =
          Math.abs(a.radiusScale - b.radiusScale) +
          Math.abs(a.polarOffsetRadians - b.polarOffsetRadians) +
          Math.abs(a.azimuthOffsetRadians - b.azimuthOffsetRadians);
        expect(separation).toBeGreaterThan(0.05);
      }
    }
  });

  it("leads with the pull-back the whole feature was first built and tuned on", () => {
    expect(CAMERA_INTRO_START_POSE).toBe(CAMERA_INTRO_POSES[0]);
  });
});

describe("pickCameraIntroPose", () => {
  it("gives one world the same shot every single visit", () => {
    // The point of seeding rather than rolling: a shot that changes on each
    // viewing reads as the app being unable to decide.
    const first = pickCameraIntroPose("world-9f21c4");
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(pickCameraIntroPose("world-9f21c4")).toBe(first);
    }
  });

  it("does not hand every world the same shot", () => {
    const chosen = new Set<number>();
    for (let index = 0; index < 200; index++) {
      chosen.add(CAMERA_INTRO_POSES.indexOf(pickCameraIntroPose(`world-${index}`)));
    }
    // Not "all of them" — a hash is allowed to be lumpy over 200 samples — but
    // one fixed shot for every world is exactly what this replaced.
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("reaches every shot in the set over enough worlds", () => {
    const chosen = new Set<number>();
    for (let index = 0; index < 4000; index++) {
      chosen.add(CAMERA_INTRO_POSES.indexOf(pickCameraIntroPose(`seed-${index}`)));
    }
    expect(chosen.size).toBe(CAMERA_INTRO_POSES.length);
  });

  it("always returns a real pose, whatever it is handed", () => {
    for (const seed of ["", " ", "0", "🜲", "a".repeat(500)]) {
      expect(CAMERA_INTRO_POSES).toContain(pickCameraIntroPose(seed));
    }
  });
});

describe("cameraIntroStartOffset", () => {
  it("pulls back, lifts and swings around the resting framing", () => {
    const resting = { radius: 20, polarRadians: 1.2, azimuthRadians: 0.4 };
    const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS);
    expect(started.radius).toBeGreaterThan(resting.radius);
    expect(started.polarRadians).toBeLessThan(resting.polarRadians);
    expect(started.azimuthRadians).not.toBe(resting.azimuthRadians);
  });

  it("never asks for a radius the orbit envelope would clamp back", () => {
    // A forest opening shot already near its 70-unit ceiling: unclamped, 1.22x
    // would ask for 73.2 and OrbitControls would hand back 70 on its next
    // update, with nothing here the wiser.
    const resting = { radius: 60, polarRadians: 1.2, azimuthRadians: 0 };
    expect(cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS).radius).toBe(70);
  });

  it("never asks for a polar angle past the family's ground-plane clamp", () => {
    const resting = { radius: 20, polarRadians: 0.02, azimuthRadians: 0 };
    const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS, {
      radiusScale: 1,
      polarOffsetRadians: -0.5,
      azimuthOffsetRadians: 0
    });
    expect(started.polarRadians).toBeGreaterThan(0);
    expect(started.polarRadians).toBeLessThanOrEqual(FOREST_LIKE_LIMITS.maximumPolarRadians);
  });

  it("keeps the camera off the +Y pole, where azimuth stops existing", () => {
    const resting = { radius: 20, polarRadians: 0.0001, azimuthRadians: 1.1 };
    const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS, {
      radiusScale: 1,
      polarOffsetRadians: -1,
      azimuthOffsetRadians: 0
    });
    expect(started.polarRadians).toBeGreaterThan(0);
  });

  it("respects a family's minimum distance when the shot opens very close", () => {
    const resting = { radius: 3, polarRadians: 1.2, azimuthRadians: 0 };
    const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS, {
      radiusScale: 0.4,
      polarOffsetRadians: 0,
      azimuthOffsetRadians: 0
    });
    expect(started.radius).toBe(3);
  });

  it("carries the azimuth drift through unclamped — a bearing wraps, it does not stop", () => {
    const resting = { radius: 20, polarRadians: 1.2, azimuthRadians: Math.PI };
    const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS);
    expect(started.azimuthRadians).toBeCloseTo(Math.PI + CAMERA_INTRO_START_POSE.azimuthOffsetRadians, 9);
  });
});

describe("cameraIntroOffsetAt", () => {
  const resting: SphericalOffset = { radius: 24, polarRadians: 1.2, azimuthRadians: 0.4 };
  const started = cameraIntroStartOffset(resting, FOREST_LIKE_LIMITS);

  it("begins on the start offset", () => {
    expect(cameraIntroOffsetAt(started, resting, 0)).toEqual(started);
  });

  it("lands EXACTLY on the resting offset, not near it", () => {
    expect(cameraIntroOffsetAt(started, resting, 1)).toEqual(resting);
  });

  it("closes in on the framing monotonically", () => {
    let previousRadius = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 40; step++) {
      const offset = cameraIntroOffsetAt(started, resting, step / 40);
      expect(offset.radius).toBeLessThanOrEqual(previousRadius + 1e-9);
      previousRadius = offset.radius;
    }
    expect(previousRadius).toBe(resting.radius);
  });

  it("keeps moving from the very first frames when the start offset was clamped", () => {
    // The regression this guards: clamping every frame instead of resolving the
    // start once made a shot near the distance ceiling sit perfectly still
    // through the opening stretch of its own entrance. Interpolating from the
    // already-clamped start means every frame after the first moves.
    const nearCeiling: SphericalOffset = { radius: 68, polarRadians: 1.2, azimuthRadians: 0 };
    const clampedStart = cameraIntroStartOffset(nearCeiling, FOREST_LIKE_LIMITS);
    expect(clampedStart.radius).toBe(FOREST_LIKE_LIMITS.maximumRadius);

    const firstTenth = cameraIntroOffsetAt(clampedStart, nearCeiling, 0.1);
    expect(firstTenth.radius).toBeLessThan(clampedStart.radius);
  });

  it("is a no-op when the start offset is the resting offset", () => {
    // What an envelope with no headroom at all produces: no move is better than
    // a jitter, and no frame may land off the family's framing.
    for (let step = 0; step <= 10; step++) {
      expect(cameraIntroOffsetAt(resting, resting, step / 10)).toEqual(resting);
    }
  });
});
