import { describe, expect, it } from "vitest";
import { buildPreviewOceanSceneConfig } from "@/lib/oceanScene";
import type { PreviewSceneInput } from "@/lib/scene";
import { minimumPolarAngleUnderCeiling } from "../shared/cameraIntro";
import {
  oceanCameraCeilingMetres,
  oceanCameraFraming,
  oceanSurfaceClearanceMetres
} from "./oceanMath";

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
