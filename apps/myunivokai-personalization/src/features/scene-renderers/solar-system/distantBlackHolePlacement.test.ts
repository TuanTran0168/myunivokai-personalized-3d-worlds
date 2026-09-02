import { describe, expect, it } from "vitest";
import {
  blackHoleOffAxisDegrees,
  distantBlackHolePlacement,
  frameHalfExtentAtDepth
} from "./distantBlackHolePlacement";
import { BLACK_HOLE_TARGET_SIZE } from "./spacecraftCatalog";
import {
  CAMERA_HEIGHT_RATIO,
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_CAMERA_FIELD_OF_VIEW,
  universeCameraPosition
} from "@/features/scene-renderers/universeCameraFraming";

// universe-service rolls distance in [7, 12] with a fixed 50 degree lens
// (world_config_builder.go). Both ends of that range are covered, plus an absent
// camera (pre-1.2 worlds) and two lenses outside today's envelope so a future
// change to the roll cannot quietly reintroduce the bug.
const CAMERA_CONFIGURATIONS = [
  undefined,
  { distance: 7, fov: 50 },
  { distance: 8.95, fov: 50 },
  { distance: 12, fov: 50 },
  { distance: 6, fov: 35 },
  { distance: 20, fov: 70 }
];

// The outermost planet orbit is about 11 (orbitRadiusForPlanet); anything the
// black hole does has to happen beyond that or it stops reading as distant.
const OUTERMOST_PLANET_ORBIT_RADIUS = 11;

// COUPLED to SKYBOX_RADIUS in Skybox.tsx: the milky-way shell is a sphere of
// this radius centred on the origin, and anything placed outside it renders
// behind the sky. Kept as a literal because Skybox.tsx pulls in three.js and
// cannot be imported into a node test.
const SKYBOX_RADIUS = 60;

// Seeds that have been observed in the wild, including the one that reproduced
// the reported bug (WLD-DR3HMIJRZ2 used to land 157 degrees off axis, dead
// behind the viewer), plus a generated spread so the invariant is not a
// three-sample coincidence.
const OBSERVED_SEEDS = ["WLD-DR3HMIJRZ2", "VAR-1CE-2-WG5O", "WLD-EFFU6CC6IQ", "WLD-SNV7WMCHCB", "myunivokai"];
const GENERATED_SEED_COUNT = 200;
const SAMPLE_SEEDS = [
  ...OBSERVED_SEEDS,
  ...Array.from({ length: GENERATED_SEED_COUNT }, (_, index) => `WLD-SAMPLE-${index}`)
];

describe("distantBlackHolePlacement", () => {
  it("frames the seed that reported the bug", () => {
    // WLD-DR3HMIJRZ2 is a real published world (share slug neo-64x3rcsu3a).
    // Its rare-feature roll gives it a black hole, and the badge said so, but
    // the old ring placement put the model 157 degrees off the view axis — i.e.
    // behind the viewer — so the world looked like it had lost the feature.
    const camera = { distance: 8.95, fov: 50 };
    const placement = distantBlackHolePlacement("WLD-DR3HMIJRZ2", camera);
    expect(blackHoleOffAxisDegrees(placement, camera)).toBeLessThan(camera.fov / 2);
  });

  it("keeps every seed inside the opening frame on a square viewport", () => {
    // The tightest real constraint: on a square canvas the horizontal room
    // equals the vertical room, so an object that clears this clears every
    // wider window too. Measured as an angle against the half field of view,
    // which is what the frustum actually clips on.
    for (const camera of CAMERA_CONFIGURATIONS) {
      const halfFieldOfViewDegrees = (camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW) / 2;
      for (const seed of SAMPLE_SEEDS) {
        const placement = distantBlackHolePlacement(seed, camera);
        expect(blackHoleOffAxisDegrees(placement, camera)).toBeLessThan(halfFieldOfViewDegrees);
      }
    }
  });

  it("leaves the whole model inside the frame, not just its centre", () => {
    for (const camera of CAMERA_CONFIGURATIONS) {
      for (const seed of SAMPLE_SEEDS) {
        const { position } = distantBlackHolePlacement(seed, camera);
        const cameraPosition = universeCameraPosition(camera);
        const forwardLength = Math.hypot(...cameraPosition);
        const forward = cameraPosition.map((component) => -component / forwardLength);
        const toBlackHole = position.map((component, axis) => component - cameraPosition[axis]);
        const depthAlongAxis = forward.reduce((sum, component, axis) => sum + component * toBlackHole[axis], 0);
        const lateralOffset = Math.hypot(
          ...toBlackHole.map((component, axis) => component - forward[axis] * depthAlongAxis)
        );
        // The bound is radial, measured against the frame's half HEIGHT: on a
        // square viewport that circle is inscribed in the frame, so clearing it
        // clears both axes on any window at least as wide as it is tall.
        expect(lateralOffset + BLACK_HOLE_TARGET_SIZE / 2).toBeLessThan(
          frameHalfExtentAtDepth(depthAlongAxis, camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW)
        );
      }
    }
  });

  it("stays beyond the outermost planet orbit, in the upper half of the frame", () => {
    // "Upper half" is a SCREEN-space claim, not a world-space one: the camera
    // looks down at the origin, so a point above the view axis far out along it
    // can still sit below y=0. What matters is that it reads above the orbital
    // ellipse on screen, clear of the planets and the asteroid belt.
    for (const camera of CAMERA_CONFIGURATIONS) {
      for (const seed of SAMPLE_SEEDS) {
        const { position } = distantBlackHolePlacement(seed, camera);
        expect(Math.hypot(...position)).toBeGreaterThan(OUTERMOST_PLANET_ORBIT_RADIUS);
        expect(Math.hypot(...position) + BLACK_HOLE_TARGET_SIZE / 2).toBeLessThan(SKYBOX_RADIUS);

        const cameraPosition = universeCameraPosition(camera);
        const forwardLength = Math.hypot(...cameraPosition);
        const forward = cameraPosition.map((component) => -component / forwardLength);
        const screenRight = [-forward[2], 0, forward[0]];
        const screenRightLength = Math.hypot(...screenRight);
        const right = screenRight.map((component) => component / screenRightLength);
        const screenUp = [
          right[1] * forward[2] - right[2] * forward[1],
          right[2] * forward[0] - right[0] * forward[2],
          right[0] * forward[1] - right[1] * forward[0]
        ];
        const toBlackHole = position.map((component, axis) => component - cameraPosition[axis]);
        const verticalOffset = screenUp.reduce((sum, component, axis) => sum + component * toBlackHole[axis], 0);
        expect(verticalOffset).toBeGreaterThan(0);
      }
    }
  });

  it("never parks the disk on the view axis, where the sun would eclipse it", () => {
    // Zero offset would put the black hole directly behind the sun. Every seed
    // must sit measurably off centre.
    const MINIMUM_OFF_AXIS_DEGREES = 3;
    for (const seed of SAMPLE_SEEDS) {
      const placement = distantBlackHolePlacement(seed, { distance: 8.95, fov: 50 });
      expect(blackHoleOffAxisDegrees(placement, { distance: 8.95, fov: 50 })).toBeGreaterThan(
        MINIMUM_OFF_AXIS_DEGREES
      );
    }
  });

  it("varies placement across seeds", () => {
    const distinctPositions = new Set(
      SAMPLE_SEEDS.map((seed) => distantBlackHolePlacement(seed).position.map((value) => value.toFixed(3)).join(","))
    );
    expect(distinctPositions.size).toBeGreaterThan(SAMPLE_SEEDS.length / 2);
  });

  it("is deterministic for a given seed and camera", () => {
    const first = distantBlackHolePlacement("WLD-DR3HMIJRZ2", { distance: 8.95, fov: 50 });
    const second = distantBlackHolePlacement("WLD-DR3HMIJRZ2", { distance: 8.95, fov: 50 });
    expect(second).toEqual(first);
  });

  it("resolves the same placement whether the camera is absent or spelled out", () => {
    // The share page and the world dashboard both hand the renderer the same
    // scene, but a pre-1.2 world can carry no camera section at all. Absent and
    // explicit-default must agree, or the two pages could frame it differently.
    expect(distantBlackHolePlacement("WLD-DR3HMIJRZ2", undefined)).toEqual(
      distantBlackHolePlacement("WLD-DR3HMIJRZ2", {
        distance: DEFAULT_CAMERA_DISTANCE,
        fov: DEFAULT_CAMERA_FIELD_OF_VIEW
      })
    );
  });
});

describe("universeCameraPosition", () => {
  it("lifts the camera off the orbital plane by the house ratio", () => {
    expect(universeCameraPosition({ distance: 10, fov: 50 })).toEqual([0, 10 * CAMERA_HEIGHT_RATIO, 10]);
  });

  it("falls back to the default distance when a world carries no camera section", () => {
    expect(universeCameraPosition()).toEqual([
      0,
      DEFAULT_CAMERA_DISTANCE * CAMERA_HEIGHT_RATIO,
      DEFAULT_CAMERA_DISTANCE
    ]);
  });
});
