import type { WaterOutline } from "./forestMath";

/**
 * Geometric measures of the seeded shoreline, so a fidelity change can state a
 * number instead of a screenshot (US-FOREST-002).
 *
 * These ran once by hand during the lake rounds and the numbers went into a note,
 * where they promptly went stale. Here they are functions, so a test can hold
 * them.
 *
 * Everything measures the outline's RADIUS FACTOR, not a lake of a given size.
 * Perimeter scales linearly with the mean radius and area quadratically, so the
 * development index is scale-invariant: one measurement covers every clearing
 * radius nature-service can roll. The kink metric is likewise a property of the
 * factor curve alone.
 */

const FULL_CIRCLE_RADIANS = Math.PI * 2;

/**
 * Samples around the circle.
 *
 * High enough that both the polyline perimeter and the finite-difference second
 * derivative have converged for a curve whose highest harmonic is 11. The
 * curvature term is the demanding one — its numerator is a difference of nearby
 * values around 1, about 1e-4 at this step size, which still leaves eleven
 * significant digits in double precision.
 */
const OUTLINE_SAMPLE_COUNT = 2048;

function outlineRadiusFactors(outline: WaterOutline, sampleCount: number): number[] {
  const radiusFactors = new Array<number>(sampleCount);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    radiusFactors[sampleIndex] = outline.radiusFactorAt((sampleIndex / sampleCount) * FULL_CIRCLE_RADIANS);
  }
  return radiusFactors;
}

/**
 * Perimeter of the closed polyline through the sampled shoreline, in units of the
 * mean radius.
 */
export function waterOutlinePerimeter(outline: WaterOutline, sampleCount = OUTLINE_SAMPLE_COUNT): number {
  const radiusFactors = outlineRadiusFactors(outline, sampleCount);
  let perimeter = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const nextIndex = (sampleIndex + 1) % sampleCount;
    const angle = (sampleIndex / sampleCount) * FULL_CIRCLE_RADIANS;
    const nextAngle = (nextIndex / sampleCount) * FULL_CIRCLE_RADIANS;
    perimeter += Math.hypot(
      radiusFactors[nextIndex] * Math.cos(nextAngle) - radiusFactors[sampleIndex] * Math.cos(angle),
      radiusFactors[nextIndex] * Math.sin(nextAngle) - radiusFactors[sampleIndex] * Math.sin(angle)
    );
  }
  return perimeter;
}

/**
 * Area enclosed by that same polyline, by the shoelace formula.
 *
 * Deliberately the same polygon the perimeter is taken from, rather than the
 * smooth integral: mixing a discrete perimeter with an exact area biases the
 * ratio, and a perfect circle would score just under 1.
 */
export function waterOutlineArea(outline: WaterOutline, sampleCount = OUTLINE_SAMPLE_COUNT): number {
  const radiusFactors = outlineRadiusFactors(outline, sampleCount);
  let twiceSignedArea = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const nextIndex = (sampleIndex + 1) % sampleCount;
    const angle = (sampleIndex / sampleCount) * FULL_CIRCLE_RADIANS;
    const nextAngle = (nextIndex / sampleCount) * FULL_CIRCLE_RADIANS;
    twiceSignedArea +=
      radiusFactors[sampleIndex] * Math.cos(angle) * (radiusFactors[nextIndex] * Math.sin(nextAngle)) -
      radiusFactors[nextIndex] * Math.cos(nextAngle) * (radiusFactors[sampleIndex] * Math.sin(angle));
  }
  return Math.abs(twiceSignedArea) / 2;
}

/**
 * Shoreline development index: perimeter over the perimeter of a circle of equal
 * area. The standard limnological measure — 1.00 is a perfect circle, real lakes
 * run 1.5-3.0. It says how convoluted the shore is, and nothing about whether the
 * convolution is bays or crenellation.
 *
 * Never read it alone. It was once pushed to 1.58 with high harmonics and the
 * result was a jagged splat: perimeter cannot tell one sweeping bay from a row of
 * notches. Pair it with shorelineKinkMetric, which is what that failure trips.
 */
export function shorelineDevelopmentIndex(outline: WaterOutline, sampleCount = OUTLINE_SAMPLE_COUNT): number {
  const area = waterOutlineArea(outline, sampleCount);
  return waterOutlinePerimeter(outline, sampleCount) / (2 * Math.sqrt(Math.PI * area));
}

/**
 * Peak magnitude of the second derivative of the radius factor with respect to
 * angle — how sharply the shore turns at its worst point.
 *
 * The counterweight to the development index. A shape made convoluted by large
 * smooth bays keeps this low; one made convoluted by notches does not. The
 * outline is C1 but not C2 (the bay-depth floor joins with a step in curvature),
 * so this is the supremum of a bounded discontinuous function, not of a smooth
 * one — it converges to a finite value rather than diverging as the step shrinks.
 */
export function shorelineKinkMetric(outline: WaterOutline, sampleCount = OUTLINE_SAMPLE_COUNT): number {
  const radiusFactors = outlineRadiusFactors(outline, sampleCount);
  const angleStep = FULL_CIRCLE_RADIANS / sampleCount;
  let peakCurvature = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const previous = radiusFactors[(sampleIndex - 1 + sampleCount) % sampleCount];
    const next = radiusFactors[(sampleIndex + 1) % sampleCount];
    const secondDerivative = (next - 2 * radiusFactors[sampleIndex] + previous) / (angleStep * angleStep);
    peakCurvature = Math.max(peakCurvature, Math.abs(secondDerivative));
  }
  return peakCurvature;
}
