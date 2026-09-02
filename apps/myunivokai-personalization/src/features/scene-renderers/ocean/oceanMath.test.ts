import { describe, expect, it } from "vitest";
import { buildPreviewOceanSceneConfig } from "@/lib/oceanScene";
import type { PreviewSceneInput } from "@/lib/scene";
import { maximumPolarAngleOverFloor, minimumPolarAngleUnderCeiling } from "../shared/cameraIntro";
import {
  HIGH_SUN_ELEVATION_THRESHOLD_RADIANS,
  lowestSeafloorUnderFootprint,
  hydrothermalFlickerIntensity,
  oceanCameraCeilingMetres,
  oceanCameraFloorMetres,
  oceanCameraFraming,
  oceanSurfaceClearanceMetres
} from "./oceanMath";
import { BLUE_SEA_YAW_OFFSET_RADIANS } from "./oceanSky";
import { LANDMARK_HEIGHT_METRES, LANDMARK_KINDS } from "./oceanLandmarkGeometry";

/**
 * The camera envelope, checked against worlds the generator can actually make.
 *
 * The bug these exist for: `createOceanRig` decides above-or-below ONCE, when
 * it builds the rig, and the orbit camera then moves freely. A camera that
 * leaves the water leaves a rig that still believes it is submerged, and the
 * from-below surface shader answers by painting zenith sky across a 900 m
 * opaque sheet with every animal in the world behind it. It showed on zoom-out
 * and not on zoom-in, which is the whole tell: the lift a tilt buys is the
 * ORBIT RADIUS times the cosine of the polar angle.
 */

// Mirrors ORBIT_CONTROLS_MAXIMUM_DISTANCE and ORBIT_CONTROLS_MINIMUM_DISTANCE in
// CameraRig.tsx. Copied rather than imported: that module pulls drei and three
// in behind it, and this is arithmetic.
const ORBIT_MAXIMUM_DISTANCE = 26;
const ORBIT_MINIMUM_DISTANCE = 2.5;
// Mirrors MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES, same file.
const MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES = 1.5;
// Mirrors OCEAN_FALLBACK_WIND_SPEED_METRES_PER_SECOND in UniverseCanvas.tsx and
// the top of windSpeedFromSeed's band in OceanRenderer.tsx.
const WINDIEST_METRES_PER_SECOND = 13;
const CALMEST_METRES_PER_SECOND = 5;

const MOODS = ["focused", "dreamy", "energetic", "reflective"];

function previewInput(overrides: Partial<PreviewSceneInput> = {}): PreviewSceneInput {
  return {
    nickname: "Mai",
    interests: ["Diving", "Music", "Science"],
    traits: ["curious", "calm", "explorer"],
    mood: "reflective",
    preferredWorldStyle: "aurora",
    favoriteColors: ["#8B5CF6", "#06B6D4"],
    ...overrides
  };
}

function previewsAcrossMoodsAndNicknames(count: number) {
  const scenes = [];
  for (let index = 0; index < count; index += 1) {
    for (const mood of MOODS) {
      scenes.push(buildPreviewOceanSceneConfig(previewInput({ mood, nickname: `Mai-${index}` })));
    }
  }
  return scenes;
}

describe("oceanSurfaceClearanceMetres", () => {
  it("keeps the lens clear of the near plane even on a glassy sea", () => {
    // The renderer pushes the near plane out to 0.5 m, so the clearance can
    // never fall to zero however calm the water is.
    expect(oceanSurfaceClearanceMetres(0)).toBeGreaterThan(0.5);
  });

  it("grows with the sea it has to clear", () => {
    expect(oceanSurfaceClearanceMetres(CALMEST_METRES_PER_SECOND)).toBeLessThan(
      oceanSurfaceClearanceMetres(WINDIEST_METRES_PER_SECOND)
    );
  });

  it("clears the troughs of the windiest sea the family rolls", () => {
    // Pierson-Moskowitz at 13 m/s gives Hs = 3.62 m; a trough hangs about
    // 0.93 Hs below the mean plane. A clearance under that is a camera that is
    // out of the water every time a big one passes.
    const significantWaveHeight = 0.0214 * WINDIEST_METRES_PER_SECOND * WINDIEST_METRES_PER_SECOND;
    expect(oceanSurfaceClearanceMetres(WINDIEST_METRES_PER_SECOND)).toBeGreaterThan(
      significantWaveHeight * 0.9
    );
  });

  it("treats a nonsense wind as a calm one rather than a negative sea", () => {
    expect(oceanSurfaceClearanceMetres(-4)).toBe(oceanSurfaceClearanceMetres(0));
  });
});

describe("oceanCameraCeilingMetres", () => {
  it("has no ceiling for a world seen from above the waterline", () => {
    // Those worlds have no sheet over the lens to come out of. They have the
    // mirror problem, which is a different bound.
    expect(oceanCameraCeilingMetres(-2, WINDIEST_METRES_PER_SECOND)).toBeNull();
  });

  it("sits below the waterline by the whole clearance", () => {
    const ceiling = oceanCameraCeilingMetres(20, 9);
    expect(ceiling).not.toBeNull();
    expect(ceiling as number).toBeCloseTo(20 - oceanSurfaceClearanceMetres(9), 10);
  });
});

describe("the ocean camera envelope, across worlds the generator can make", () => {
  it("leaves the resting camera in the water in every underwater world", () => {
    // The lens rests at the viewer's own depth plane, which is height zero. A
    // ceiling at or below zero would mean the world is shallower than its own
    // wave troughs — the shot would open outside the sea it is a shot of.
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) continue;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      );
      expect(ceiling).not.toBeNull();
      expect(ceiling as number).toBeGreaterThan(0);
    }
  });

  it("holds the lens under the surface at every zoom, in every underwater world", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) continue;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      for (let radius = ORBIT_MINIMUM_DISTANCE; radius <= ORBIT_MAXIMUM_DISTANCE; radius += 0.5) {
        const polar = minimumPolarAngleUnderCeiling(ceiling, framing.target.y, radius);
        const highestCamera = framing.target.y + radius * Math.cos(polar);
        expect(highestCamera).toBeLessThanOrEqual(ceiling + 1e-9);
      }
    }
  });

  it("does not disturb a single shot the family composed", () => {
    // The clamp is only allowed to take away angles the visitor DRAGS to. Every
    // resting framing has to sit inside it untouched, or the fix would silently
    // re-pose the opening shot of every shallow world — which is the failure
    // mode the forest's own polar clamp shipped with and had to be widened for.
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) continue;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      // The framing puts the lens at height zero and the target above or below
      // it, so the resting offset is the vector between them.
      const restingRadius = Math.hypot(
        framing.x - framing.target.x,
        framing.y - framing.target.y,
        framing.z - framing.target.z
      );
      const restingPolar = Math.acos((framing.y - framing.target.y) / restingRadius);
      expect(restingPolar).toBeGreaterThan(
        minimumPolarAngleUnderCeiling(ceiling, framing.target.y, restingRadius)
      );
    }
  });

  it("leaves the close end of the zoom completely free", () => {
    // The other half of the owner's report: zoomed in there was never a bug,
    // and there must never be a restriction either. A clamp that bit at 2.5 m
    // would be trading one wrong camera for another.
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) continue;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      expect(
        minimumPolarAngleUnderCeiling(ceiling, framing.target.y, ORBIT_MINIMUM_DISTANCE)
      ).toBe(0);
    }
  });

  it("is doing work — unclamped, the wide end of the zoom leaves the water", () => {
    // Kept as an assertion so the clamp cannot be removed and the suite stay
    // green. Straight up at the widest zoom is where the owner found it.
    const breached = previewsAcrossMoodsAndNicknames(30).filter((scene) => {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) return false;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      return framing.target.y + ORBIT_MAXIMUM_DISTANCE > ceiling;
    });
    expect(breached.length).toBeGreaterThan(0);
  });

  it("leaves a corridor the camera can actually fly in", () => {
    // A ceiling is only useful if there is room under it. The floor is the
    // terrain clamp's, and where the two meet the ceiling wins — so a world
    // whose corridor closed would pin the lens in the sand.
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const depthMetres = scene.depth?.metres ?? 0;
      if (depthMetres < 0) continue;
      const seafloorMetres = scene.depth?.seafloorMetres ?? depthMetres + 10;
      const ceiling = oceanCameraCeilingMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const floor = -(seafloorMetres - depthMetres) + MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES;
      expect(ceiling - floor).toBeGreaterThan(MINIMUM_HEIGHT_ABOVE_TERRAIN_METRES);
    }
  });
});

describe("oceanCameraFloorMetres", () => {
  it("has no floor for a world seen from under the waterline", () => {
    // A submerged world's problem is the sheet overhead, not the one below.
    expect(oceanCameraFloorMetres(18, WINDIEST_METRES_PER_SECOND)).toBeNull();
    expect(oceanCameraFloorMetres(0, WINDIEST_METRES_PER_SECOND)).toBeNull();
  });

  it("sits above the waterline by the whole clearance", () => {
    // The surface of an above-water world is drawn at the signed depth itself
    // (`seaTop.mesh.position.y = viewerDepthMetres`), so the floor is that
    // plane lifted clear of its own crests.
    const floor = oceanCameraFloorMetres(-6, 9);
    expect(floor).not.toBeNull();
    expect(floor as number).toBeCloseTo(-6 + oceanSurfaceClearanceMetres(9), 10);
  });

  it("is the ceiling's mirror about the waterline", () => {
    // One clearance, one waterline, two signs. Stated as an equality so a
    // change to either function has to be made to both.
    const submergedHeadroom = 12 - (oceanCameraCeilingMetres(12, 8) as number);
    const airborneHeadroom = (oceanCameraFloorMetres(-12, 8) as number) - -12;
    expect(airborneHeadroom).toBeCloseTo(submergedHeadroom, 12);
  });
});

describe("the above-water camera envelope, across worlds the generator can make", () => {
  // Measured 2026-09-02: 24 of the 120 worlds this sweep builds come out above
  // the waterline, all of them the `focused` mood, 4.05 m to 23.61 m over their
  // own sea. Asserted below so a generator change that stops making them turns
  // this suite red rather than quietly reducing it to nothing.
  function aboveWaterPreviews() {
    return previewsAcrossMoodsAndNicknames(30).filter((scene) => (scene.depth?.metres ?? 0) < 0);
  }

  it("is exercising worlds that actually exist", () => {
    expect(aboveWaterPreviews().length).toBeGreaterThan(0);
  });

  it("opens every above-water shot clear of its own sea", () => {
    // The lens rests at height zero. A floor at or above zero would mean the
    // world is lower over its water than that water's own crests are tall —
    // the shot would open inside the sea it is a shot of.
    for (const scene of aboveWaterPreviews()) {
      const floor = oceanCameraFloorMetres(
        scene.depth?.metres ?? 0,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      );
      expect(floor).not.toBeNull();
      expect(floor as number).toBeLessThan(0);
    }
  });

  it("holds the lens above the surface at every zoom, in every above-water world", () => {
    for (const scene of aboveWaterPreviews()) {
      const depthMetres = scene.depth?.metres ?? 0;
      const floor = oceanCameraFloorMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      for (let radius = ORBIT_MINIMUM_DISTANCE; radius <= ORBIT_MAXIMUM_DISTANCE; radius += 0.5) {
        const polar = maximumPolarAngleOverFloor(floor, framing.target.y, radius);
        const lowestCamera = framing.target.y + radius * Math.cos(polar);
        expect(lowestCamera).toBeGreaterThanOrEqual(floor - 1e-9);
      }
    }
  });

  it("does not disturb a single above-water shot the family composed", () => {
    for (const scene of aboveWaterPreviews()) {
      const depthMetres = scene.depth?.metres ?? 0;
      const floor = oceanCameraFloorMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      const restingRadius = Math.hypot(
        framing.x - framing.target.x,
        framing.y - framing.target.y,
        framing.z - framing.target.z
      );
      const restingPolar = Math.acos((framing.y - framing.target.y) / restingRadius);
      expect(restingPolar).toBeLessThan(
        maximumPolarAngleOverFloor(floor, framing.target.y, restingRadius)
      );
    }
  });

  it("is doing work — unclamped, the wide end of the zoom dives under the sea", () => {
    // The mirror of the ceiling suite's own "is doing work" case, and the
    // reason this bound is not decoration: at the widest orbit, straight down
    // from the aim point is metres under the water in these worlds.
    const submerged = aboveWaterPreviews().filter((scene) => {
      const depthMetres = scene.depth?.metres ?? 0;
      const floor = oceanCameraFloorMetres(
        depthMetres,
        scene.water?.windSpeedMetresPerSecond ?? WINDIEST_METRES_PER_SECOND
      ) as number;
      const framing = oceanCameraFraming(
        scene.camera?.distance ?? 20,
        depthMetres,
        scene.water?.visibilityMetres ?? 30,
        scene.lighting?.surfaceAzimuthRadians,
        scene.depth?.seafloorMetres
      );
      return framing.target.y - ORBIT_MAXIMUM_DISTANCE < floor;
    });
    expect(submerged.length).toBeGreaterThan(0);
  });
});

/**
 * Where a landmark's foot ends up.
 *
 * The reported frame: a whale fall's rib cage and its bacterial mat hanging in
 * clear water with daylight underneath. Two independent causes, both of which
 * put the same "it is floating" on screen, and both pinned here:
 *
 *   - the service lifted every landmark 0 to 6 m off the floor on a roll that
 *     never asked what kind it was, while all six kinds are bottom features
 *     whose geometry has its foot normalised to y = 0 on purpose;
 *   - the renderer placed that foot against ONE sample of the seabed, taken at
 *     the centre, so a shape several metres across on a dune slope had its
 *     downhill edge in the water however correct its y was.
 */
describe("oceanCameraFraming's above-water sun bearing", () => {
  function yawOf(framing: ReturnType<typeof oceanCameraFraming>): number {
    return Math.atan2(framing.target.z - framing.z, framing.target.x - framing.x);
  }
  function normalizeAngle(angle: number): number {
    return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  it("looks straight at the sun above water under a low, golden-hour sun", () => {
    const sunAzimuth = 1.1;
    const framing = oceanCameraFraming(20, -10, 30, sunAzimuth, 40, HIGH_SUN_ELEVATION_THRESHOLD_RADIANS);
    expect(normalizeAngle(yawOf(framing))).toBeCloseTo(normalizeAngle(sunAzimuth), 5);
  });

  it("turns BLUE_SEA_YAW_OFFSET_RADIANS away from the sun above water under a high sun", () => {
    const sunAzimuth = 1.1;
    const framing = oceanCameraFraming(
      20,
      -10,
      30,
      sunAzimuth,
      40,
      HIGH_SUN_ELEVATION_THRESHOLD_RADIANS + 0.1
    );
    expect(normalizeAngle(yawOf(framing))).toBeCloseTo(normalizeAngle(sunAzimuth + BLUE_SEA_YAW_OFFSET_RADIANS), 5);
  });

  it("never applies the offset underwater, where the sun's own bearing is the subject", () => {
    // Snell's window and the god rays need the sun's bearing to have anything
    // to show; turning away from it there would compose toward empty water.
    const sunAzimuth = 1.1;
    const framing = oceanCameraFraming(
      20,
      5,
      30,
      sunAzimuth,
      40,
      HIGH_SUN_ELEVATION_THRESHOLD_RADIANS + 0.1
    );
    expect(normalizeAngle(yawOf(framing))).toBeCloseTo(normalizeAngle(sunAzimuth), 5);
  });

  it("defaults to no offset for a caller with no sun elevation to pass", () => {
    const sunAzimuth = 1.1;
    const framing = oceanCameraFraming(20, -10, 30, sunAzimuth, 40);
    expect(normalizeAngle(yawOf(framing))).toBeCloseTo(normalizeAngle(sunAzimuth), 5);
  });
});

describe("lowestSeafloorUnderFootprint", () => {
  // A slope with nothing else on it: height falls away with x.
  const SLOPE_FALL_PER_METRE = 0.4;
  const slopingFloor = (x: number) => -x * SLOPE_FALL_PER_METRE;
  // The analytic path — no mesh yet, which is the first frames of every world.
  const NO_MESH = 0;

  it("never sits higher than the centre sample it replaced", () => {
    for (const footprintRadius of [0, 0.5, 1, 2.5, 4]) {
      for (const centreX of [-12, -3, 0, 7, 19]) {
        expect(
          lowestSeafloorUnderFootprint(slopingFloor, centreX, 0, footprintRadius, NO_MESH)
        ).toBeLessThanOrEqual(slopingFloor(centreX));
      }
    }
  });

  it("finds the downhill edge, which is the corner that used to hover", () => {
    const FOOTPRINT_RADIUS_METRES = 3;
    const found = lowestSeafloorUnderFootprint(slopingFloor, 0, 0, FOOTPRINT_RADIUS_METRES, NO_MESH);
    // The rim ring includes the point directly downhill, so the answer is the
    // full fall across the footprint's radius rather than some fraction of it.
    expect(found).toBeCloseTo(-FOOTPRINT_RADIUS_METRES * SLOPE_FALL_PER_METRE, 6);
  });

  it("is the centre sample when the shape has no width", () => {
    const flatAt = () => -4.25;
    expect(lowestSeafloorUnderFootprint(flatAt, 3, 9, 0, NO_MESH)).toBe(-4.25);
  });

  // The mesh path. What the eye sees is the height function sampled on a grid
  // and joined with flat triangles, and those triangles hang BELOW the function
  // everywhere between vertices — 0.2 m at desktop's spacing, 0.6 m at
  // mobile's. Placing a landmark on the function leaves it that far above the
  // sand, worse on the weaker device.
  describe("when the floor is a mesh", () => {
    const MESH_CELL_SIZE_METRES = 2;
    const VERTEX_DEPTH = -9;
    // Low only AT the vertices, flat everywhere else. A sampler that can tell
    // whether the vertices were actually the points asked for.
    const lowOnlyAtVertices = (x: number, z: number) =>
      x % MESH_CELL_SIZE_METRES === 0 && z % MESH_CELL_SIZE_METRES === 0 ? VERTEX_DEPTH : 0;

    it("reads the mesh's own vertices, not the function between them", () => {
      expect(lowestSeafloorUnderFootprint(lowOnlyAtVertices, 1, 1, 0.5, MESH_CELL_SIZE_METRES)).toBe(
        VERTEX_DEPTH
      );
    });

    it("covers every cell the footprint touches, including the corners outside it", () => {
      // A pit at one vertex of a cell the footprint overlaps but does not
      // reach. The triangles of that cell still pass under the shape, so their
      // low corner is the floor the shape has to clear.
      const PIT_X = 4;
      const pitAtOneVertex = (x: number, z: number) => (x === PIT_X && z === 0 ? VERTEX_DEPTH : 0);
      const FOOTPRINT_RADIUS_METRES = 1.5;
      expect(Math.hypot(PIT_X, 0)).toBeGreaterThan(FOOTPRINT_RADIUS_METRES);
      expect(
        lowestSeafloorUnderFootprint(pitAtOneVertex, 3, 0, FOOTPRINT_RADIUS_METRES, MESH_CELL_SIZE_METRES)
      ).toBe(VERTEX_DEPTH);
    });

    it("ignores a dip that no cell under the shape reaches", () => {
      const farAwayPit = (x: number) => (x === 40 ? VERTEX_DEPTH : -1);
      expect(lowestSeafloorUnderFootprint(farAwayPit, 0, 0, 2, MESH_CELL_SIZE_METRES)).toBe(-1);
    });
  });
});

describe("where the service puts a landmark, across worlds the generator can make", () => {
  it("never places one above the seabed, because every kind it draws stands on it", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      for (const landmark of scene.landmarks ?? []) {
        expect(landmark.heightAboveFloor ?? 0).toBeLessThanOrEqual(0);
      }
    }
  });

  // The other end of the same range. A bed depth is a SETTLING, and past some
  // fraction of the shape's own height it is a way of hiding the shape.
  //
  // The fraction is 0.4 rather than something tighter because the whale fall is
  // DEFINED as half in the sediment — that is what the kind is — and its stated
  // height is its girth, 1.8 m, because it is lying down. A third of it under
  // the sand is the look; the bar is where the rib arcs stop reading as a rib
  // cage. The kinds that stand up are all far under it: the kelp cathedral beds
  // 0.2 m of 6.4.
  //
  // This bar lives on this side rather than in ocean_config_builder_test.go
  // because the standing heights live here, in oceanLandmarkGeometry.ts. The Go
  // test holds the absolute cap; this one holds it against each kind.
  it("beds a landmark in rather than burying it", () => {
    const MAXIMUM_BURIED_FRACTION_OF_OWN_HEIGHT = 0.4;
    const checkedKinds = new Set<string>();
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      for (const landmark of scene.landmarks ?? []) {
        const kind = landmark.kind ?? "";
        const standingHeight = LANDMARK_HEIGHT_METRES[kind];
        expect(standingHeight, `landmark kind ${kind} has no standing height`).toBeGreaterThan(0);
        expect(-(landmark.heightAboveFloor ?? 0)).toBeLessThanOrEqual(
          standingHeight * MAXIMUM_BURIED_FRACTION_OF_OWN_HEIGHT
        );
        checkedKinds.add(kind);
      }
    }
    // Non-vacuity: a bar that only ever saw the hero kind would prove nothing
    // about the five that are chosen by a roll.
    expect(checkedKinds.size).toBe(LANDMARK_KINDS.length);
  });

  // The reason no kind beds in at zero. The renderer closes the gap between the
  // height function and the drawn mesh exactly, but it closes it to a SEAM: the
  // shape's lowest point then touches the sand at one place and clears it
  // everywhere else, which still reads as resting on rather than settled into.
  it("beds every kind in by something", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(10)) {
      for (const landmark of scene.landmarks ?? []) {
        expect(-(landmark.heightAboveFloor ?? 0)).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The black smoker's flicker. Measured behaviour rather than a look: a vent
 * flashes blue-white at its precipitation front a couple of times every few
 * seconds, each flash about a tenth of a second, and two vents in the same
 * field do not flash together.
 */
describe("hydrothermalFlickerIntensity", () => {
  const SAMPLE_SECONDS = 120;
  const SAMPLE_STEP_SECONDS = 1 / 90;

  function samples(phaseSeed: number): number[] {
    const values: number[] = [];
    for (let time = 0; time < SAMPLE_SECONDS; time += SAMPLE_STEP_SECONDS) {
      values.push(hydrothermalFlickerIntensity(time, phaseSeed));
    }
    return values;
  }

  it("stays inside 0..1, so it can drive an opacity directly", () => {
    for (const value of samples(3)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is dark most of the time — a vent that glows continuously is a lamp", () => {
    const lit = samples(3).filter((value) => value > 0).length;
    expect(lit / samples(3).length).toBeLessThan(0.15);
  });

  it("actually flashes, several times a minute", () => {
    // Counted as rising edges rather than lit frames, so a long dim stretch
    // cannot pass for a burst.
    const values = samples(3);
    let flashes = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > 0 && values[index - 1] === 0) {
        flashes += 1;
      }
    }
    expect(flashes).toBeGreaterThan(SAMPLE_SECONDS / 4);
  });

  it("reaches full brightness, so a flash reads as a flash", () => {
    expect(Math.max(...samples(3))).toBeGreaterThan(0.9);
  });

  it("gives two vents in one field their own clock", () => {
    const first = samples(3);
    const second = samples(11);
    const together = first.filter((value, index) => value > 0 && second[index] > 0).length;
    const eitherLit = first.filter((value, index) => value > 0 || second[index] > 0).length;
    expect(together / eitherLit).toBeLessThan(0.2);
  });

  it("is deterministic — the same vent at the same second looks the same", () => {
    expect(hydrothermalFlickerIntensity(41.37, 7)).toBe(hydrothermalFlickerIntensity(41.37, 7));
  });

  it("is dark for a clock that has not started, or has gone backwards", () => {
    expect(hydrothermalFlickerIntensity(Number.NaN, 3)).toBe(0);
    expect(hydrothermalFlickerIntensity(-2, 3)).toBe(0);
  });
});
