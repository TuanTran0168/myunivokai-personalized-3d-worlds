import { describe, expect, it } from "vitest";
import { createWaterOutline } from "./forestMath";
import {
  applyGerstnerSurfaceDisplacement,
  createSurfaceDisplacement,
  maximumSurfaceWaveHeight,
  waterSurfaceLateralScale,
  waterSurfaceRestGrid,
  waterSurfaceRingCount,
  waterSurfaceRingFraction,
  waterSurfaceTriangleIndices,
  waterSurfaceWaveScale
} from "./forestWaterMath";

// US-FOREST-001 asks the surface to behave like water: "no triangle inverts".
// That sentence is the test. The parenthetical it shipped with — that the lateral
// shift never exceeds local vertex spacing — is a proxy, and a wrong one in both
// directions: it reads as a fold across open water where nothing is wrong, and it
// passed the landmark pond, which folded.

/** The landmark pond, ForestLandmarks POND_RADIUS. */
const POND_RADIUS = 1.7;
/** nature-service rolls clearingRadius in [8, 11]; the lake is 1.35x of it. */
const LAKE_RADII = [10.8, 12.15, 14.85];
const SURFACE_RADII = [POND_RADIUS, ...LAKE_RADII];

const SEED_COUNT = 12;
// Unrelated to any wave period, so the samples never land on the same phase.
const TIME_SAMPLES = [0, 0.37, 1.9, 7.3, 21.1, 63.7];
/** Angular segments per ring, WATER_SURFACE_SEGMENT_COUNT. */
const SEGMENT_COUNT = 96;
/** A triangle thinner than a tenth of its rest area shades as a crease. */
const MINIMUM_AREA_RATIO = 0.1;
/** Measured worst case on the smallest lake is 0.046% of vertices, at 0.85x. */
const MAXIMUM_LAKE_CLAMPED_FRACTION = 0.002;
const MINIMUM_LAKE_CLAMP_FACTOR = 0.8;

type DisplacedSurface = {
  x: Float64Array;
  y: Float64Array;
  height: Float64Array;
};

function displaceSurface(
  grid: ReturnType<typeof waterSurfaceRestGrid>,
  elapsedSeconds: number
): DisplacedSurface {
  const vertexCount = grid.ringFractions.length;
  const x = new Float64Array(vertexCount);
  const y = new Float64Array(vertexCount);
  const height = new Float64Array(vertexCount);
  const displacement = createSurfaceDisplacement();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const restX = grid.restPositions[vertexIndex * 2];
    const restY = grid.restPositions[vertexIndex * 2 + 1];
    applyGerstnerSurfaceDisplacement(
      displacement,
      restX,
      restY,
      elapsedSeconds,
      grid.waveScales[vertexIndex],
      grid.lateralScales[vertexIndex]
    );
    x[vertexIndex] = restX + displacement.shiftX;
    y[vertexIndex] = restY + displacement.shiftY;
    height[vertexIndex] = displacement.height;
  }

  return { x, y, height };
}

function signedArea(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  vertexA: number,
  vertexB: number,
  vertexC: number
): number {
  return (x[vertexB] - x[vertexA]) * (y[vertexC] - y[vertexA]) - (x[vertexC] - x[vertexA]) * (y[vertexB] - y[vertexA]);
}

function restXY(grid: ReturnType<typeof waterSurfaceRestGrid>): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let vertexIndex = 0; vertexIndex < grid.ringFractions.length; vertexIndex += 1) {
    x.push(grid.restPositions[vertexIndex * 2]);
    y.push(grid.restPositions[vertexIndex * 2 + 1]);
  }
  return { x, y };
}

describe("the displaced water surface", () => {
  it("never inverts a triangle, on any surface size, seed or instant", () => {
    // The measurement that found a real fold. Before the triangle-room clamp the
    // worst ratio on the 1.7-unit pond was -0.24 — inside out — while every lake
    // radius stayed near 0.6. It is now 0.53 at worst on the pond and 0.74+ on the
    // lake.
    //
    // The worst ratio is accumulated and asserted once per radius rather than per
    // triangle: this walks about a million of them, and an assertion each would
    // spend the whole budget inside the matcher.
    for (const radius of SURFACE_RADII) {
      const ringCount = waterSurfaceRingCount(radius);
      const triangleIndices = waterSurfaceTriangleIndices(ringCount);
      let worstAreaRatio = Infinity;
      for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
        const grid = waterSurfaceRestGrid(radius, createWaterOutline(`fold-${seedIndex}`), ringCount);
        const rest = restXY(grid);
        for (const elapsedSeconds of TIME_SAMPLES) {
          const displaced = displaceSurface(grid, elapsedSeconds);
          for (let cursor = 0; cursor < triangleIndices.length; cursor += 3) {
            const vertexA = triangleIndices[cursor];
            const vertexB = triangleIndices[cursor + 1];
            const vertexC = triangleIndices[cursor + 2];
            const restArea = signedArea(rest.x, rest.y, vertexA, vertexB, vertexC);
            if (restArea === 0) {
              continue;
            }
            const displacedArea = signedArea(displaced.x, displaced.y, vertexA, vertexB, vertexC);
            worstAreaRatio = Math.min(worstAreaRatio, displacedArea / restArea);
          }
        }
      }
      // Ratio, not sign alone: a triangle squeezed to a hair is a shading artefact
      // even before it turns over.
      expect({ radius, worstAreaRatio: worstAreaRatio > MINIMUM_AREA_RATIO }).toEqual({
        radius,
        worstAreaRatio: true
      });
    }
  });

  it("barely touches the lake, whose crests the clamp is not there to fix", () => {
    // The fold clamp exists for the ponds. Measured over 200 seeds it reaches
    // 0.046% of vertices on the smallest lake and never below 0.85x, and no vertex
    // at all from 12.15 units up. Pinning that keeps a future fold fix from
    // quietly flattening the hero water.
    //
    // Ring fractions are recomputed at full precision rather than read back from
    // the grid: the grid stores them as Float32, and feeding a rounded input to the
    // fade gives a different answer than the build did.
    for (const radius of LAKE_RADII) {
      const ringCount = waterSurfaceRingCount(radius);
      let clampedVertices = 0;
      let totalVertices = 0;
      let smallestFactor = 1;
      for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
        const grid = waterSurfaceRestGrid(radius, createWaterOutline(`clamp-${seedIndex}`), ringCount);
        for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
          const unclamped = Math.fround(waterSurfaceLateralScale(waterSurfaceRingFraction(ringIndex, ringCount)));
          for (let segmentIndex = 0; segmentIndex <= SEGMENT_COUNT; segmentIndex += 1) {
            const vertexIndex = 1 + ringIndex * (SEGMENT_COUNT + 1) + segmentIndex;
            totalVertices += 1;
            if (unclamped > 0 && grid.lateralScales[vertexIndex] !== unclamped) {
              clampedVertices += 1;
              smallestFactor = Math.min(smallestFactor, grid.lateralScales[vertexIndex] / unclamped);
            }
          }
        }
      }
      expect({
        radius,
        rarely: clampedVertices / totalVertices < MAXIMUM_LAKE_CLAMPED_FRACTION,
        gently: smallestFactor > MINIMUM_LAKE_CLAMP_FACTOR
      }).toEqual({ radius, rarely: true, gently: true });
    }
  });

  it("holds the shoreline still, so the sheet stays welded to the bank", () => {
    for (const radius of SURFACE_RADII) {
      const ringCount = waterSurfaceRingCount(radius);
      const grid = waterSurfaceRestGrid(radius, createWaterOutline("shore"), ringCount);
      for (let vertexIndex = 0; vertexIndex < grid.ringFractions.length; vertexIndex += 1) {
        if (grid.ringFractions[vertexIndex] === 1) {
          expect(grid.waveScales[vertexIndex]).toBe(0);
        }
      }
      for (const elapsedSeconds of TIME_SAMPLES) {
        const displaced = displaceSurface(grid, elapsedSeconds);
        for (let vertexIndex = 0; vertexIndex < grid.ringFractions.length; vertexIndex += 1) {
          if (grid.ringFractions[vertexIndex] === 1) {
            expect(displaced.height[vertexIndex]).toBe(0);
            expect(displaced.x[vertexIndex]).toBe(grid.restPositions[vertexIndex * 2]);
          }
        }
      }
    }
  });

  it("keeps the sideways crowding out of the centre, where the segments converge", () => {
    expect(waterSurfaceLateralScale(0)).toBe(0);
    // ...while leaving the height alone there, or the middle of the lake goes flat.
    expect(waterSurfaceWaveScale(0)).toBe(1);
  });

  it("stays inside the wave table's own amplitude", () => {
    const ceiling = maximumSurfaceWaveHeight();
    for (const radius of SURFACE_RADII) {
      const grid = waterSurfaceRestGrid(radius, createWaterOutline("amplitude"), waterSurfaceRingCount(radius));
      for (const elapsedSeconds of TIME_SAMPLES) {
        const displaced = displaceSurface(grid, elapsedSeconds);
        for (const height of displaced.height) {
          expect(Math.abs(height)).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it("reports a normal that matches the gradient of its own height field", () => {
    // The normals are analytic rather than recomputed from faces, so nothing else
    // would notice if a slope term lost its direction — the lighting would just be
    // subtly wrong.
    const displacement = createSurfaceDisplacement();
    const step = 1e-5;
    for (const [sampleX, sampleY] of [
      [0, 0],
      [1.3, -2.1],
      [-4.7, 3.2],
      [8.9, 6.4]
    ]) {
      for (const elapsedSeconds of TIME_SAMPLES) {
        applyGerstnerSurfaceDisplacement(displacement, sampleX, sampleY, elapsedSeconds, 1, 1);
        const analyticSlopeX = displacement.slopeX;
        const analyticSlopeY = displacement.slopeY;

        applyGerstnerSurfaceDisplacement(displacement, sampleX + step, sampleY, elapsedSeconds, 1, 1);
        const heightAhead = displacement.height;
        applyGerstnerSurfaceDisplacement(displacement, sampleX - step, sampleY, elapsedSeconds, 1, 1);
        expect((heightAhead - displacement.height) / (2 * step)).toBeCloseTo(analyticSlopeX, 5);

        applyGerstnerSurfaceDisplacement(displacement, sampleX, sampleY + step, elapsedSeconds, 1, 1);
        const heightAcross = displacement.height;
        applyGerstnerSurfaceDisplacement(displacement, sampleX, sampleY - step, elapsedSeconds, 1, 1);
        expect((heightAcross - displacement.height) / (2 * step)).toBeCloseTo(analyticSlopeY, 5);
      }
    }
  });

  it("builds the same surface twice for the same seed", () => {
    const first = waterSurfaceRestGrid(POND_RADIUS, createWaterOutline("repeat"), waterSurfaceRingCount(POND_RADIUS));
    const second = waterSurfaceRestGrid(POND_RADIUS, createWaterOutline("repeat"), waterSurfaceRingCount(POND_RADIUS));
    expect(Array.from(first.lateralScales)).toEqual(Array.from(second.lateralScales));
    expect(Array.from(first.restPositions)).toEqual(Array.from(second.restPositions));
  });

  it("gives a small pond fewer rings than a lake, but never too few to ripple", () => {
    expect(waterSurfaceRingCount(POND_RADIUS)).toBeLessThan(waterSurfaceRingCount(LAKE_RADII[0]));
    expect(waterSurfaceRingCount(0.1)).toBeGreaterThanOrEqual(6);
    // Rings bunch toward the rim, where the depth gradient and the wave fade both
    // change fastest.
    const ringCount = waterSurfaceRingCount(LAKE_RADII[0]);
    expect(waterSurfaceRingFraction(ringCount - 1, ringCount)).toBe(1);
    expect(waterSurfaceRingFraction(1, ringCount) - waterSurfaceRingFraction(0, ringCount)).toBeGreaterThan(
      waterSurfaceRingFraction(ringCount - 1, ringCount) - waterSurfaceRingFraction(ringCount - 2, ringCount)
    );
  });
});
