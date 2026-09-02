import { describe, expect, it } from "vitest";
import { createWaterOutline, lakeShapeSeedFromTerrain, type WaterOutline } from "./forestMath";
import {
  shorelineDevelopmentIndex,
  shorelineKinkMetric,
  waterOutlineArea,
  waterOutlinePerimeter
} from "./forestFidelityMetrics";

// US-FOREST-002: a fidelity change has to name the property it improves and how
// that property is measured, and the measurement has to land in a test rather
// than in a note. These are the shoreline half of that — the numbers the lake
// rounds argued over, now asserted instead of remembered.

/** US-FOREST-001: "the shoreline development index exceeds 1.15". */
const MINIMUM_DEVELOPMENT_INDEX = 1.15;
/** US-FOREST-001: "peak second derivative of the radius function under 50". */
const MAXIMUM_KINK = 50;

const SEED_COUNT = 600;

function lakeOutlines(): WaterOutline[] {
  const outlines: WaterOutline[] = [];
  for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
    outlines.push(
      createWaterOutline(
        lakeShapeSeedFromTerrain({
          placementSeed: `fidelity-seed-${seedIndex}`,
          clearingRadius: 9.5,
          treelineRadius: 39.9,
          hillAmplitude: 1.5,
          hillFrequency: 0.05
        })
      )
    );
  }
  return outlines;
}

function outlineOfHarmonics(harmonics: { frequency: number; amplitude: number; phase: number }[]): WaterOutline {
  return {
    segments: 192,
    radiusFactorAt: (angleRadians: number) =>
      harmonics.reduce(
        (radiusFactor, harmonic) =>
          radiusFactor + harmonic.amplitude * Math.sin(harmonic.frequency * angleRadians + harmonic.phase),
        1
      )
  };
}

describe("the metrics themselves", () => {
  // Anchored on shapes whose answer is known before trusting either number on a
  // lake: a metric that has never been checked against a circle is an opinion
  // with a decimal point.
  const circle: WaterOutline = { segments: 192, radiusFactorAt: () => 1 };

  it("scores a perfect circle at exactly one, with no curvature", () => {
    expect(shorelineDevelopmentIndex(circle)).toBeCloseTo(1, 6);
    expect(shorelineKinkMetric(circle)).toBe(0);
  });

  it("measures a circle's perimeter and area against their closed forms", () => {
    expect(waterOutlinePerimeter(circle)).toBeCloseTo(Math.PI * 2, 4);
    expect(waterOutlineArea(circle)).toBeCloseTo(Math.PI, 4);
  });

  it("reads a smooth elongation as convoluted but not sharp", () => {
    const ellipse = outlineOfHarmonics([{ frequency: 2, amplitude: 0.24, phase: 0 }]);
    expect(shorelineDevelopmentIndex(ellipse)).toBeGreaterThan(1);
    expect(shorelineKinkMetric(ellipse)).toBeLessThan(MAXIMUM_KINK);
  });

  it("is unchanged by the size of the lake it describes", () => {
    // Justifies measuring the radius FACTOR rather than a lake of a given size:
    // perimeter scales linearly and area quadratically, so the ratio cancels.
    const outline = lakeOutlines()[0];
    const tenTimesLarger: WaterOutline = {
      segments: outline.segments,
      radiusFactorAt: (angleRadians: number) => 10 * outline.radiusFactorAt(angleRadians)
    };
    expect(shorelineDevelopmentIndex(tenTimesLarger)).toBeCloseTo(shorelineDevelopmentIndex(outline), 9);
  });

  it("catches the shape that gaming the index once produced", () => {
    // The lake rounds pushed the development index to 1.58 with high harmonics and
    // the result read as a jagged splat. This is that failure in miniature: it
    // scores FAR better than the shipped outline on the index alone, which is
    // exactly why the index alone must never decide anything.
    const jagged = outlineOfHarmonics([
      { frequency: 2, amplitude: 0.24, phase: 0 },
      { frequency: 17, amplitude: 0.1, phase: 0 },
      { frequency: 23, amplitude: 0.1, phase: 1 }
    ]);
    const shipped = lakeOutlines()[0];

    expect(shorelineDevelopmentIndex(jagged)).toBeGreaterThan(shorelineDevelopmentIndex(shipped));
    expect(shorelineKinkMetric(jagged)).toBeGreaterThan(MAXIMUM_KINK);
  });

  it("returns the same numbers for the same seed", () => {
    const seed = "fidelity-determinism";
    expect(shorelineDevelopmentIndex(createWaterOutline(seed))).toBe(
      shorelineDevelopmentIndex(createWaterOutline(seed))
    );
    expect(shorelineKinkMetric(createWaterOutline(seed))).toBe(shorelineKinkMetric(createWaterOutline(seed)));
  });
});

describe("the shipped lake outline", () => {
  it("is more convoluted than a circle on every seed", () => {
    // Measured range over 4000 seeds: 1.1553 to 1.1972. The floor clears the
    // threshold by about 0.005, so this is a live constraint and not slack —
    // anything that rounds the shoreline off will trip it.
    for (const outline of lakeOutlines()) {
      expect(shorelineDevelopmentIndex(outline)).toBeGreaterThan(MINIMUM_DEVELOPMENT_INDEX);
    }
  });

  it("buys that convolution with bays rather than notches, on every seed", () => {
    // Measured range over 4000 seeds: 7.91 to 17.82, against a limit of 50.
    for (const outline of lakeOutlines()) {
      expect(shorelineKinkMetric(outline)).toBeLessThan(MAXIMUM_KINK);
    }
  });
});
