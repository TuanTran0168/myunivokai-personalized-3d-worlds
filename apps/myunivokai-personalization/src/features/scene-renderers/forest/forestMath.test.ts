import { describe, expect, it } from "vitest";
import type { ForestTerrainConfig } from "@/lib/types";
import {
  createLakeEdgeDistanceSampler,
  createTerrainHeightSampler,
  forestShoreCameraFraming,
  lakeShoreRadiusAcrossOpeningAxis,
  lakeShoreRadiusOnOpeningAxis,
  LAKE_SHORE_PLANTING_BUFFER
} from "./forestMath";

// The opening camera is the one piece of forest geometry with no visual test:
// it decides what the owner sees first, and every constraint on it is a
// relationship between numbers the renderer computes elsewhere (the lake
// outline, the terrain carve, the tree exclusion). Those relationships are what
// is pinned here — a camera standing in the water, behind a trunk, or aimed at
// the sky is a silent regression otherwise.

const FIELD_OF_VIEW = 50;
const HALF_FRAME_RADIANS = (FIELD_OF_VIEW / 2) * (Math.PI / 180);
const RADIANS_TO_DEGREES = 180 / Math.PI;

// nature-service rolls clearingRadius in [8, 11] and hillAmplitude in [0.8, 2.2]
// (forest_scene_profile.go), with treelineRadius fixed at 4.2x the clearing.
function terrainCases(): ForestTerrainConfig[] {
  const cases: ForestTerrainConfig[] = [];
  for (const clearingRadius of [8, 9.5, 11]) {
    for (const hillAmplitude of [0.8, 1.5, 2.2]) {
      for (let seedIndex = 0; seedIndex < 20; seedIndex += 1) {
        cases.push({
          placementSeed: `framing-seed-${seedIndex}`,
          clearingRadius,
          treelineRadius: clearingRadius * 4.2,
          hillAmplitude,
          hillFrequency: 0.05
        });
      }
    }
  }
  return cases;
}

describe("forestShoreCameraFraming", () => {
  it("returns the same framing for the same terrain", () => {
    const terrain = terrainCases()[0];
    expect(forestShoreCameraFraming(terrain, FIELD_OF_VIEW)).toEqual(
      forestShoreCameraFraming(terrain, FIELD_OF_VIEW)
    );
  });

  it("stands the camera on dry land, never in the lake", () => {
    for (const terrain of terrainCases()) {
      const { distance } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      // Distance to the water measured at the camera's own azimuth: the outline
      // swings from 0.3x to 1.48x of the mean radius, so the mean says nothing
      // about whether this particular spot is wet.
      expect(createLakeEdgeDistanceSampler(terrain)(0, distance)).toBeGreaterThan(0);
      expect(distance).toBeGreaterThan(lakeShoreRadiusOnOpeningAxis(terrain));
    }
  });

  it("keeps the camera inside the tree-free bank, so no trunk blocks the water", () => {
    for (const terrain of terrainCases()) {
      const { distance } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      // ForestRenderer plants trees only where lakeEdgeDistance exceeds the
      // buffer. Everything between the camera and the waterline is closer to the
      // water than the camera is, so this one comparison clears the whole
      // segment.
      expect(createLakeEdgeDistanceSampler(terrain)(0, distance)).toBeLessThan(LAKE_SHORE_PLANTING_BUFFER);
    }
  });

  it("keeps the eye above the ground it stands on and above the water plane", () => {
    for (const terrain of terrainCases()) {
      const { distance, height } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      const groundHeight = createTerrainHeightSampler(terrain)(0, distance);
      expect(height).toBeGreaterThan(groundHeight);
      expect(height).toBeGreaterThan(0);
    }
  });

  it("looks across the water rather than down onto it", () => {
    // Extremes over the whole sweep, not the first case to trip: a loop of
    // per-case expects stops at the first violation and hides the real worst.
    let shallowestDegrees = Infinity;
    let steepestDegrees = -Infinity;
    for (const terrain of terrainCases()) {
      const { distance, height } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      const lookDownDegrees = Math.atan(height / distance) * RADIANS_TO_DEGREES;
      shallowestDegrees = Math.min(shallowestDegrees, lookDownDegrees);
      steepestDegrees = Math.max(steepestDegrees, lookDownDegrees);
    }
    // The framing this replaced sat at 22.8 degrees, which is what made the lake
    // read as a puddle seen from above. Below ~3 degrees the water would collapse
    // to a line instead. Measured over these 180 cases: 4.31 to 15.51 degrees,
    // the steep end being seeds whose bank stands highest above the water.
    expect(shallowestDegrees).toBeGreaterThan(3);
    expect(steepestDegrees).toBeLessThan(18);
  });

  it("fills at least a third of the frame with water", () => {
    let smallestWaterFraction = Infinity;
    for (const terrain of terrainCases()) {
      const { distance, height } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      const bottomEdgeRadians = Math.atan(height / distance) + HALF_FRAME_RADIANS;
      const nearWaterRadians = Math.atan(height / (distance - lakeShoreRadiusOnOpeningAxis(terrain)));
      const farShoreRadians = Math.atan(height / (distance + lakeShoreRadiusAcrossOpeningAxis(terrain)));
      const waterFraction =
        (Math.min(bottomEdgeRadians, nearWaterRadians) - farShoreRadians) / (2 * HALF_FRAME_RADIANS);
      smallestWaterFraction = Math.min(smallestWaterFraction, waterFraction);
    }
    // Water is the subject of the opening shot, so it has to hold the frame on
    // every seed, not on average. Measured worst case: 0.416.
    expect(smallestWaterFraction).toBeGreaterThan(0.33);
  });

  it("keeps the near bank in frame for all but a handful of seeds", () => {
    const cases = terrainCases();
    let bankOutOfFrame = 0;
    for (const terrain of cases) {
      const { distance, height } = forestShoreCameraFraming(terrain, FIELD_OF_VIEW);
      const bottomEdgeRadians = Math.atan(height / distance) + HALF_FRAME_RADIANS;
      const nearestVisibleRadius = distance - height / Math.tan(bottomEdgeRadians);
      // A strip of bank at the bottom of the frame is the foreground that gives
      // the water its scale. It is lost where the standoff hits its clamp — the
      // camera cannot step further back without leaving the tree-free bank.
      // Measured at 18 of 180 seeds; widening the buffer to 5.2 clears most of
      // them but costs a steeper view and another unit of tree-free ring, which
      // is the wrong trade — the grazing angle is what does the work here.
      if (nearestVisibleRadius < lakeShoreRadiusOnOpeningAxis(terrain)) {
        bankOutOfFrame += 1;
      }
    }
    expect(bankOutOfFrame / cases.length).toBeLessThan(0.15);
  });
});
