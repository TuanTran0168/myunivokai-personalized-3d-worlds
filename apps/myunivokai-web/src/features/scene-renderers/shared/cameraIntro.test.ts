import { describe, expect, it } from "vitest";
import {
  CAMERA_INTRO_DURATION_SECONDS,
  CAMERA_INTRO_MAXIMUM_FRAME_SECONDS,
  CAMERA_INTRO_POSES,
  CAMERA_INTRO_START_POSE,
  CAMERA_SETTLE_DURATION_SECONDS,
  cameraIntroFrameSeconds,
  cameraIntroPoseForDuration,
  cameraIntroOffsetAt,
  cameraIntroProgress,
  cameraIntroStartOffset,
  minimumPolarAngleUnderCeiling,
  NO_POLAR_FLOOR,
  pickCameraIntroPose,
  type SphericalOffset,
  type SphericalOffsetLimits
} from "./cameraIntro";

const FOREST_LIKE_LIMITS: SphericalOffsetLimits = {
  minimumRadius: 3,
  maximumRadius: 70,
  maximumPolarRadians: Math.PI * 0.492,
  minimumPolarRadiansAtRadius: NO_POLAR_FLOOR
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
  it("keeps every shot a move, not a fly-through", () => {
    // These bounds were half this size, and the result read as "it zooms
    // slightly": at those magnitudes the radius did nearly all the work, and
    // the radius is the axis that reads LEAST as movement. The ceilings are now
    // about a step and a half, a 25-degree descent and a 45-degree turn.
    //
    // Still bounded, and the bound is not decoration: an entry the visitor did
    // not ask for has to be over before it becomes something they have to sit
    // through, and 2.2 s is all there is.
    for (const pose of CAMERA_INTRO_POSES) {
      expect(Math.abs(pose.radiusScale - 1)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(pose.polarOffsetRadians)).toBeLessThanOrEqual(0.45);
      expect(Math.abs(pose.azimuthOffsetRadians)).toBeLessThanOrEqual(0.8);
    }
  });

  it("makes the bearing the biggest axis, because it is the one that survives", () => {
    // Radius and polar can each be clamped flat by a family's envelope. If the
    // set grew mostly on those axes, the extra travel would be exactly the
    // travel most likely to be thrown away — a bigger pull-back is a bigger
    // request to be clamped back to the ceiling.
    const widestTurn = Math.max(...CAMERA_INTRO_POSES.map((pose) => Math.abs(pose.azimuthOffsetRadians)));
    const steepestDescent = Math.max(...CAMERA_INTRO_POSES.map((pose) => Math.abs(pose.polarOffsetRadians)));
    expect(widestTurn).toBeGreaterThan(steepestDescent);
  });

  it("opens some worlds from inside their own framing", () => {
    // A shot that only ever pulls back has one character however many entries
    // are in the table. Starting closer and drawing out reads as emerging
    // rather than arriving, and it is the only way to get that from a set of
    // spherical offsets.
    expect(CAMERA_INTRO_POSES.some((pose) => pose.radiusScale < 1)).toBe(true);
    expect(CAMERA_INTRO_POSES.some((pose) => pose.radiusScale > 1)).toBe(true);
  });

  it("lifts every close start clear of the framing it opens inside", () => {
    // A smaller radius at the same polar angle is a LOWER camera, so a close
    // start on its own is a start underneath the shot — straight into the
    // ocean's terrain clamp, which lifts the orbit target with the camera and
    // hands back a resting framing the family never composed.
    for (const pose of CAMERA_INTRO_POSES) {
      if (pose.radiusScale < 1) {
        expect(pose.polarOffsetRadians).toBeLessThan(-0.2);
      }
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

describe("cameraIntroPoseForDuration", () => {
  const pose = CAMERA_INTRO_POSES[0];

  it("hands the full cinematic entry the whole shot", () => {
    expect(cameraIntroPoseForDuration(pose, CAMERA_INTRO_DURATION_SECONDS)).toEqual(pose);
  });

  it("gives a longer entry than the cinematic one the whole shot too", () => {
    // Scaling UP has never been asked for and would take a pose past the bounds
    // the set is checked against.
    expect(cameraIntroPoseForDuration(pose, CAMERA_INTRO_DURATION_SECONDS * 3)).toEqual(pose);
  });

  it("shrinks the shot for the create page's settle instead of speeding it up", () => {
    // The settle is not an arrival — it plays every time an option is toggled —
    // so it takes a smaller version of the same move rather than the same
    // travel at two and a half times the speed.
    const settle = cameraIntroPoseForDuration(pose, CAMERA_SETTLE_DURATION_SECONDS);
    expect(Math.abs(settle.azimuthOffsetRadians)).toBeLessThan(Math.abs(pose.azimuthOffsetRadians));
    expect(Math.abs(settle.polarOffsetRadians)).toBeLessThan(Math.abs(pose.polarOffsetRadians));
    expect(settle.radiusScale).toBeLessThan(pose.radiusScale);
  });

  it("scales the radius about 1, not about 0", () => {
    // A radius scale of 1 means "no change", so half of a 1.32x pull-back is
    // 1.16x. Scaling the number itself would give 0.66x — a shot that starts
    // inside the world, which is a different move entirely.
    const settle = cameraIntroPoseForDuration(pose, CAMERA_SETTLE_DURATION_SECONDS);
    expect(settle.radiusScale).toBeGreaterThan(1);
  });

  it("never shrinks a shot away to nothing", () => {
    const almostInstant = cameraIntroPoseForDuration(pose, 0.01);
    expect(Math.abs(almostInstant.azimuthOffsetRadians)).toBeGreaterThan(0.03);
  });

  it("returns the pose untouched when there is no duration at all", () => {
    // Reduced motion and the gallery backdrops both pass 0, and neither plays
    // the move — so there is nothing to size.
    expect(cameraIntroPoseForDuration(pose, 0)).toEqual(pose);
  });
});

describe("minimumPolarAngleUnderCeiling", () => {
  // The ocean's numbers: a shallows world 12 m down, its resting aim 4.36 m
  // above the lens, and the widest the shared envelope opens to.
  const CEILING_HEIGHT = 8.5;
  const TARGET_HEIGHT = 4.364;

  it("does not restrict a camera that cannot reach the ceiling anyway", () => {
    // Zoomed right in, the whole orbit is shorter than the gap overhead.
    expect(minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, 2.5)).toBe(0);
  });

  it("tightens as the camera zooms out", () => {
    const closeIn = minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, 6);
    const restingRadius = minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, 20);
    const pulledBack = minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, 26);
    // The owner's own report, as an inequality: the same drag is safe zoomed in
    // and breaches the surface zoomed out.
    expect(closeIn).toBeLessThan(restingRadius);
    expect(restingRadius).toBeLessThan(pulledBack);
  });

  it("holds the camera under the ceiling at every radius the envelope allows", () => {
    for (let radius = 2.5; radius <= 26; radius += 0.5) {
      const polar = minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, radius);
      const highestCamera = TARGET_HEIGHT + radius * Math.cos(polar);
      expect(highestCamera).toBeLessThanOrEqual(CEILING_HEIGHT + 1e-9);
    }
  });

  it("pins the camera below its target when the ceiling is under the aim point", () => {
    // Looking steeply up from just under the surface. There is no orbit
    // position at or above the target's own height that is still in the water.
    const polar = minimumPolarAngleUnderCeiling(3, TARGET_HEIGHT, 20);
    expect(polar).toBeGreaterThan(Math.PI / 2);
  });

  it("returns no restriction for a degenerate radius", () => {
    expect(minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, 0)).toBe(0);
  });
});

describe("cameraIntroStartOffset under a ceiling", () => {
  const CEILING_HEIGHT = 8.5;
  const TARGET_HEIGHT = 4.364;
  // The ocean's resting pose: the lens sits at the viewer's own depth plane and
  // looks UP at a target 4.36 m above it, so the offset points downward and the
  // polar angle is past 90 degrees.
  const OCEAN_LIKE_RESTING: SphericalOffset = {
    radius: 20,
    polarRadians: Math.acos(-TARGET_HEIGHT / 20),
    azimuthRadians: 0.4
  };
  const OCEAN_LIKE_LIMITS: SphericalOffsetLimits = {
    minimumRadius: 2.5,
    maximumRadius: 26,
    maximumPolarRadians: Math.PI,
    minimumPolarRadiansAtRadius: (radius: number) =>
      minimumPolarAngleUnderCeiling(CEILING_HEIGHT, TARGET_HEIGHT, radius)
  };

  it("keeps every opening shot in the water", () => {
    // Every pose in the set both lifts the camera and pulls it back, and the
    // two compound: the lift is the radius times the cosine. Before the floor
    // existed, the crane-down pose opened a 12 m world with the lens above its
    // own surface, which is a white frame with the entire scene behind it.
    for (const pose of CAMERA_INTRO_POSES) {
      const started = cameraIntroStartOffset(OCEAN_LIKE_RESTING, OCEAN_LIKE_LIMITS, pose);
      const cameraHeight = TARGET_HEIGHT + started.radius * Math.cos(started.polarRadians);
      expect(cameraHeight).toBeLessThanOrEqual(CEILING_HEIGHT + 1e-9);
    }
  });

  it("is doing work — without the floor those same shots leave the water", () => {
    // The bug this closed, kept as an assertion so the floor cannot be quietly
    // removed and the suite stay green. Three of the ten poses put the lens
    // above a 12 m world's own surface before the visitor has touched anything.
    const breaching = CAMERA_INTRO_POSES.filter((pose) => {
      const started = cameraIntroStartOffset(
        OCEAN_LIKE_RESTING,
        { ...OCEAN_LIKE_LIMITS, minimumPolarRadiansAtRadius: NO_POLAR_FLOOR },
        pose
      );
      return TARGET_HEIGHT + started.radius * Math.cos(started.polarRadians) > CEILING_HEIGHT;
    });
    expect(breaching.length).toBeGreaterThan(0);
  });

  it("still turns when the lift is clamped away", () => {
    // The azimuth invariant, which is what stops a fully clamped pose from
    // degenerating into no move at all.
    for (const pose of CAMERA_INTRO_POSES) {
      const started = cameraIntroStartOffset(OCEAN_LIKE_RESTING, OCEAN_LIKE_LIMITS, pose);
      expect(started.azimuthRadians).not.toBe(OCEAN_LIKE_RESTING.azimuthRadians);
    }
  });

  it("leaves a family with no ceiling exactly as it was", () => {
    const withoutCeiling = cameraIntroStartOffset(OCEAN_LIKE_RESTING, {
      ...OCEAN_LIKE_LIMITS,
      minimumPolarRadiansAtRadius: NO_POLAR_FLOOR
    });
    expect(withoutCeiling.polarRadians).toBeCloseTo(
      OCEAN_LIKE_RESTING.polarRadians + CAMERA_INTRO_START_POSE.polarOffsetRadians,
      10
    );
  });
});
