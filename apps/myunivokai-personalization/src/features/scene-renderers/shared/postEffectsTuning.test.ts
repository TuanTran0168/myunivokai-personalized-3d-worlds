import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  CHROMATIC_ABERRATION_MODULATION_OFFSET,
  CHROMATIC_ABERRATION_OFFSET_X,
  CHROMATIC_ABERRATION_OFFSET_Y,
  DEFAULT_BLOOM_INTENSITY,
  FILM_GRAIN_OPACITY,
  FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF,
  FOREST_AMBIENT_OCCLUSION_INTENSITY,
  FOREST_AMBIENT_OCCLUSION_RADIUS,
  resolveSceneGrade,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET
} from "./postEffectsTuning";

/**
 * TWO POST CHAINS, ONE SET OF NUMBERS.
 *
 * §26 Phase 5 could not replace `postprocessing` in place — three.js's
 * `RenderPipeline` needs the node renderer — so the app now carries two chains
 * and will until the renderer swap. The failure mode that creates is the one
 * `sceneToneMapping.ts` was written to close for a single value: a number tuned
 * in one chain and forgotten in the other, with nothing throwing, because a post
 * value that is wrong does not error — the image just stops being the image that
 * was designed.
 *
 * These are source-level assertions for the same reason `sceneToneMapping.test.ts`
 * is: a jsdom test cannot mount a canvas, and the property worth protecting is
 * structural. Where the tuning comes from, and in what ORDER the passes are
 * applied, are both readable from the source and both invisible in a unit test
 * that renders nothing.
 */

const COMPOSER_CHAIN_SOURCE = readFileSync(fileURLToPath(new URL("./PostEffects.tsx", import.meta.url)), "utf8");
const NODE_CHAIN_SOURCE = readFileSync(fileURLToPath(new URL("./NodePostEffects.tsx", import.meta.url)), "utf8");

/** Every value both chains must read from one place rather than declare twice. */
const SHARED_TUNING_NAMES = [
  "DEFAULT_BLOOM_INTENSITY",
  "BLOOM_LUMINANCE_THRESHOLD",
  "BLOOM_LUMINANCE_SMOOTHING",
  "FOREST_AMBIENT_OCCLUSION_RADIUS",
  "FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF",
  "VIGNETTE_OFFSET",
  "VIGNETTE_DARKNESS",
  "FILM_GRAIN_OPACITY",
  "CHROMATIC_ABERRATION_OFFSET_X",
  "CHROMATIC_ABERRATION_OFFSET_Y",
  "CHROMATIC_ABERRATION_MODULATION_OFFSET"
] as const;

function positionOf(source: string, marker: string, sourceName: string): number {
  const index = source.indexOf(marker);
  expect(index, `${marker} not found in ${sourceName}`).toBeGreaterThan(-1);
  return index;
}

describe("post effects tuning", () => {
  it("is imported by both chains rather than declared in either", () => {
    for (const [sourceName, source] of [
      ["PostEffects.tsx", COMPOSER_CHAIN_SOURCE],
      ["NodePostEffects.tsx", NODE_CHAIN_SOURCE]
    ] as const) {
      expect(source, `${sourceName} does not import from postEffectsTuning`).toContain('from "./postEffectsTuning"');
      for (const tuningName of SHARED_TUNING_NAMES) {
        expect(
          source.includes(`const ${tuningName} =`),
          `${sourceName} declares its own ${tuningName}. It belongs in postEffectsTuning.ts, where the ` +
            "other chain can read the same number — see the header of that file."
        ).toBe(false);
      }
    }
  });

  /**
   * The order is the design, and `PostEffects.tsx` explains at length why: above
   * the grade the tone curve would re-grade every world ever saved, below the
   * lens effects vignette and grain would sit on unbounded linear radiance, and
   * bloom has to stay above the curve so its luminance threshold keeps selecting
   * on raw HDR. A second chain with the same passes in a different order is a
   * different look, and nothing about it would throw.
   */
  it("applies the node chain's passes in the composer chain's order", () => {
    const ambientOcclusion = positionOf(NODE_CHAIN_SOURCE, "ambientOcclusionModule.ao(", "NodePostEffects.tsx");
    const bloom = positionOf(NODE_CHAIN_SOURCE, "bloomModule.bloom(", "NodePostEffects.tsx");
    const hueSaturation = positionOf(NODE_CHAIN_SOURCE, "hueRotationVector(grade.hueRadians)", "NodePostEffects.tsx");
    const brightnessContrast = positionOf(NODE_CHAIN_SOURCE, "contrastFactor(grade.contrast)", "NodePostEffects.tsx");
    const toneMapping = positionOf(NODE_CHAIN_SOURCE, "agxToneMapping(graded", "NodePostEffects.tsx");
    const chromaticAberration = positionOf(
      NODE_CHAIN_SOURCE,
      "chromaticAberrationModule.chromaticAberration(",
      "NodePostEffects.tsx"
    );
    const vignette = positionOf(NODE_CHAIN_SOURCE, "vignetteFalloff", "NodePostEffects.tsx");
    const filmGrain = positionOf(NODE_CHAIN_SOURCE, "const grainHash", "NodePostEffects.tsx");

    expect(ambientOcclusion).toBeLessThan(bloom);
    expect(bloom).toBeLessThan(hueSaturation);
    expect(hueSaturation).toBeLessThan(brightnessContrast);
    expect(brightnessContrast).toBeLessThan(toneMapping);
    expect(toneMapping).toBeLessThan(chromaticAberration);
    expect(toneMapping).toBeLessThan(vignette);
    expect(toneMapping).toBeLessThan(filmGrain);
  });

  /**
   * The node chain cannot leave the tone curve to `RenderPipeline`, which applies
   * it LAST — after the vignette and the grain. Asserted on the source because
   * the consequence is a doubled curve in the wrong place, which looks like a
   * grading mistake rather than a wiring one.
   */
  it("hands the node renderer NoToneMapping, because the curve is in the chain", () => {
    expect(NODE_CHAIN_SOURCE).toContain("renderer.toneMapping = NoToneMapping");
    expect(NODE_CHAIN_SOURCE).toContain("renderer.toneMapping = rendererToneMappingBeforeMount");
  });

  it("resolves a missing grade to the theme table and clamps a corrupt one", () => {
    const nebulaGrade = resolveSceneGrade(undefined, "nebula");
    expect(nebulaGrade.saturation).toBeCloseTo(0.12);

    const corrupt = resolveSceneGrade(
      { hueRadians: Number.NaN, saturation: 99, brightness: -99, contrast: 99 },
      "nebula"
    );
    // NaN falls back to the theme's own channel rather than to zero.
    expect(corrupt.hueRadians).toBeCloseTo(nebulaGrade.hueRadians);
    expect(corrupt.saturation).toBe(1);
    expect(corrupt.brightness).toBe(-0.5);
    expect(corrupt.contrast).toBe(1);
  });

  it("keeps the values the composer chain was tuned with", () => {
    // Pinned so the extraction cannot quietly become a retune. Every one of
    // these came out of PostEffects.tsx unchanged.
    expect(DEFAULT_BLOOM_INTENSITY).toBe(0.8);
    expect(BLOOM_LUMINANCE_THRESHOLD).toBe(0.85);
    expect(BLOOM_LUMINANCE_SMOOTHING).toBe(0.2);
    expect(FOREST_AMBIENT_OCCLUSION_RADIUS).toBe(2);
    expect(FOREST_AMBIENT_OCCLUSION_INTENSITY).toBe(2.2);
    expect(FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF).toBe(1);
    expect(VIGNETTE_OFFSET).toBe(0.28);
    expect(VIGNETTE_DARKNESS).toBe(0.55);
    expect(FILM_GRAIN_OPACITY).toBe(0.06);
    expect(CHROMATIC_ABERRATION_OFFSET_X).toBe(0.0005);
    expect(CHROMATIC_ABERRATION_OFFSET_Y).toBe(0.001);
    expect(CHROMATIC_ABERRATION_MODULATION_OFFSET).toBe(0.15);
  });
});
