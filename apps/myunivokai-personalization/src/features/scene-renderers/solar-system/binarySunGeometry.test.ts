import { describe, expect, it } from "vitest";
import { buildCreateFormPreviewScene } from "@/features/world-form/previewScene";
import { CREATE_FORM_INITIAL_VALUES } from "@/features/world-form/worldFormOptions";
import { resolveCompanionPlacement } from "./BinarySun";

/**
 * THE TWO STARS OF A BINARY WORLD MUST NOT RENDER AS ONE BLOB.
 *
 * The companion's orbit radius used to be the world-unit constant 2.4, chosen
 * against the default sun and never re-checked against the sun the generator
 * actually draws. `core.scale` is seeded over 1.05–1.50 — the same range in
 * `services/universe-service/internal/services/world_config_builder.go` and in
 * the preview builder — so the primary's radius runs 1.52–2.18 world units
 * while that 2.4 stood still. Above core scale ~1.24 the companion's body
 * intersected the primary's, which is **59% of the seeded range**, and the
 * owner hit it in a create-form preview at core scale 1.41.
 *
 * Nothing in this suite could see it. `rareFeatures.test.ts` checks that the
 * lottery fires at the right rate, not that what it fires renders correctly,
 * and no visual spec pins a fixture that has this 3% feature on. So the gate is
 * arithmetic: sweep the whole seeded range and hold the two photospheres apart.
 */

/**
 * `world_config_builder.go:62` — `Scale: round(1.05 + rng.Float64()*0.45)` —
 * and the preview builder's MINIMUM_CORE_SCALE / CORE_SCALE_RANGE, which carry
 * the same two numbers. Declared here rather than imported because neither
 * source exports them, and asserted against real preview scenes below so a
 * generator that widens its range fails this file instead of silently escaping
 * it.
 */
const SEEDED_MINIMUM_CORE_SCALE = 1.05;
const SEEDED_MAXIMUM_CORE_SCALE = 1.5;
const CORE_SCALE_SWEEP_STEP = 0.005;

/**
 * How far apart the photospheres must stay, in world units, at the closest core
 * scale. Above zero rather than at it: a clearance of 0.001 is a weld as far as
 * a viewer is concerned, and the floor is what stops a future retune from
 * walking the separation back down to nothing one commit at a time.
 */
const MINIMUM_SURFACE_CLEARANCE = 0.2;

const PREVIEW_SCENE_SAMPLE_COUNT = 400;

/** The core scale of the create-form preview the owner reported. */
const REPORTED_CORE_SCALE = 1.41;
/** The world-unit orbit radius this file carried before the fix. */
const RETIRED_COMPANION_ORBIT_RADIUS = 2.4;

function sweptCoreScales(): number[] {
  const coreScales: number[] = [];
  for (
    let coreScale = SEEDED_MINIMUM_CORE_SCALE;
    coreScale <= SEEDED_MAXIMUM_CORE_SCALE + Number.EPSILON;
    coreScale += CORE_SCALE_SWEEP_STEP
  ) {
    coreScales.push(Number(coreScale.toFixed(3)));
  }
  return coreScales;
}

describe("binary sun geometry", () => {
  it("keeps the companion's photosphere clear of the primary's at every seeded core scale", () => {
    for (const coreScale of sweptCoreScales()) {
      const placement = resolveCompanionPlacement(coreScale);
      expect(
        placement.surfaceClearance,
        `At core scale ${coreScale} the primary's radius is ${placement.primarySurfaceRadius.toFixed(3)} and the ` +
          `companion's is ${placement.companionSurfaceRadius.toFixed(3)} at orbit ` +
          `${placement.companionOrbitRadius.toFixed(3)}, leaving ${placement.surfaceClearance.toFixed(3)} between ` +
          "the two photospheres. At or below zero the two stars render as one welded blob, which is what a binary " +
          "world looked like before the orbit was expressed in primary radii."
      ).toBeGreaterThanOrEqual(MINIMUM_SURFACE_CLEARANCE);
    }
  });

  it("clears the core scale the owner reported, which the retired constant did not", () => {
    const placement = resolveCompanionPlacement(REPORTED_CORE_SCALE);
    expect(placement.surfaceClearance).toBeGreaterThanOrEqual(MINIMUM_SURFACE_CLEARANCE);

    const clearanceUnderRetiredConstant =
      RETIRED_COMPANION_ORBIT_RADIUS - placement.companionSurfaceRadius - placement.primarySurfaceRadius;
    expect(
      clearanceUnderRetiredConstant,
      "The reported case is only a regression test while it would still fail the old code. If this stops being " +
        "negative, the core scale or the sun's scale multiplier moved and this anchor has stopped anchoring."
    ).toBeLessThan(0);
  });

  it("sweeps no narrower than the core scales the preview builder actually produces", () => {
    let observedMinimumCoreScale = Number.POSITIVE_INFINITY;
    let observedMaximumCoreScale = Number.NEGATIVE_INFINITY;

    for (let sampleIndex = 0; sampleIndex < PREVIEW_SCENE_SAMPLE_COUNT; sampleIndex += 1) {
      const scene = buildCreateFormPreviewScene({
        ...CREATE_FORM_INITIAL_VALUES,
        nickname: `core-scale-sample-${sampleIndex}`
      });
      const coreScale = scene.core?.scale;
      expect(coreScale, `Preview scene ${sampleIndex} carries no core scale.`).toBeTypeOf("number");
      const placement = resolveCompanionPlacement(coreScale);
      expect(
        placement.surfaceClearance,
        `A real preview scene at core scale ${coreScale} leaves ` +
          `${placement.surfaceClearance.toFixed(3)} between the two photospheres.`
      ).toBeGreaterThanOrEqual(MINIMUM_SURFACE_CLEARANCE);
      observedMinimumCoreScale = Math.min(observedMinimumCoreScale, coreScale as number);
      observedMaximumCoreScale = Math.max(observedMaximumCoreScale, coreScale as number);
    }

    const rangeExplanation =
      `The preview builder produced core scales from ${observedMinimumCoreScale} to ${observedMaximumCoreScale}, ` +
      `outside the ${SEEDED_MINIMUM_CORE_SCALE}–${SEEDED_MAXIMUM_CORE_SCALE} range this file sweeps. The sweep is ` +
      "only a proof for the range it covers, so widen the constants above — and check the Go generator, which " +
      "carries the same two numbers.";
    expect(observedMinimumCoreScale, rangeExplanation).toBeGreaterThanOrEqual(SEEDED_MINIMUM_CORE_SCALE);
    expect(observedMaximumCoreScale, rangeExplanation).toBeLessThanOrEqual(SEEDED_MAXIMUM_CORE_SCALE);
  });
});
