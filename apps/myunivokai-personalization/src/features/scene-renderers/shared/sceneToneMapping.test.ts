import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACESFilmicToneMapping, LinearToneMapping, NeutralToneMapping, NoToneMapping } from "three";
import { ToneMappingMode } from "postprocessing";
import { describe, expect, it } from "vitest";
import {
  composerToneMappingModeFor,
  DEFAULT_FAMILY_TONE_MAPPING,
  OCEAN_FAMILY_TONE_MAPPING,
  rendererToneMappingForFamily,
  toneMappingNodeFunctionNameFor
} from "./sceneToneMapping";

/**
 * THE TWO DECLARATIONS OF A TONE CURVE MUST AGREE, AND NOTHING IN A RENDERED
 * FRAME WILL TELL YOU WHEN THEY DO NOT.
 *
 * This is the assertion the bug needed and did not have. `EffectComposer`
 * overwrites `gl.toneMapping` with `NoToneMapping` on mount, so a family that
 * mounts the chain gets its curve from a `<ToneMapping>` pass or from nowhere.
 * For forest, universe and the fallback renderer it was nowhere — for their
 * whole lives — and the only symptom was highlights clipping flat to white,
 * which looks like a lighting choice.
 *
 * No exception, no failed assertion, no type error. So the invariant is written
 * down here instead.
 */
describe("scene tone mapping", () => {
  it("maps each family's renderer curve to the matching composer mode", () => {
    expect(composerToneMappingModeFor(DEFAULT_FAMILY_TONE_MAPPING)).toBe(ToneMappingMode.NEUTRAL);
    expect(composerToneMappingModeFor(OCEAN_FAMILY_TONE_MAPPING)).toBe(ToneMappingMode.ACES_FILMIC);
  });

  it("gives the ocean ACES and everything else Khronos PBR Neutral", () => {
    expect(rendererToneMappingForFamily({ isOceanFamilyScene: true })).toBe(ACESFilmicToneMapping);
    expect(rendererToneMappingForFamily({ isOceanFamilyScene: false })).toBe(NeutralToneMapping);
  });

  /**
   * THE CURVE IS DECLARED IN THREE PLACES, NOT TWO, and the third was a literal.
   *
   * `NodePostEffects.tsx` called `agxToneMapping` from `three/tsl` directly. It
   * agreed with the composer by coincidence, and a change to the default curve
   * would have split the two chains silently — the exact failure this module was
   * written to close, reappearing one renderer over.
   *
   * These assert the mapping exists and that both chains resolve the SAME curve
   * for the same family, which is the invariant; the literal names are checked
   * against `three/tsl`'s real exports by the test below.
   */
  it("maps each family's renderer curve to the matching three/tsl function", () => {
    expect(toneMappingNodeFunctionNameFor(DEFAULT_FAMILY_TONE_MAPPING)).toBe("neutralToneMapping");
    expect(toneMappingNodeFunctionNameFor(OCEAN_FAMILY_TONE_MAPPING)).toBe("acesFilmicToneMapping");
  });

  it("throws rather than guessing when a curve has no declared three/tsl function", () => {
    expect(() => toneMappingNodeFunctionNameFor(LinearToneMapping)).toThrow(/no three\/tsl function is declared/);
    expect(() => toneMappingNodeFunctionNameFor(NoToneMapping)).toThrow(/no three\/tsl function is declared/);
  });

  /**
   * A name is only a name until something checks it resolves. This one is looked
   * up on a module reached through a dynamic `import()` inside an effect, so a
   * typo would not be a type error and would not be a build error — it would be
   * `applyToneCurve is not a function`, thrown inside a promise, on the frame the
   * chain mounts.
   *
   * `three/tsl` is imported statically HERE and nowhere in the app, which is the
   * point of the indirection: the test pays the second copy of three, the bundle
   * does not.
   */
  it("names three/tsl exports that actually exist", async () => {
    const tsl = (await import("three/tsl")) as unknown as Record<string, unknown>;
    for (const rendererToneMapping of [DEFAULT_FAMILY_TONE_MAPPING, OCEAN_FAMILY_TONE_MAPPING]) {
      const functionName = toneMappingNodeFunctionNameFor(rendererToneMapping);
      expect(typeof tsl[functionName], `three/tsl has no export named ${functionName}`).toBe("function");
    }
  });

  /**
   * Refusing loudly is the whole design. A default here would put the frame back
   * in the failure this module closes: it would still render, with a curve
   * nobody chose, and the image would not say so.
   */
  it("throws rather than guessing when a curve has no declared composer mode", () => {
    expect(() => composerToneMappingModeFor(LinearToneMapping)).toThrow(/no composer mode is declared/);
    expect(() => composerToneMappingModeFor(NoToneMapping)).toThrow(/no composer mode is declared/);
  });

  /**
   * Read from the source rather than from a rendered frame, because a unit test
   * cannot mount a canvas and the thing worth protecting is structural: the
   * chain must contain the pass at all.
   *
   * It also pins the ORDER, which is a real decision and not a formatting one.
   * Above the grade, the curve would re-grade every world ever saved, because
   * the stored HueSaturation and BrightnessContrast channels were authored
   * against linear HDR input. Below the lens effects, vignette and soft-light
   * grain get a finished image, which is what those operators are for. And
   * bloom must stay ABOVE it so its luminance threshold keeps selecting on raw
   * HDR — that threshold is what makes it "deliberate emitter" rather than
   * "bright pixel".
   */
  it("puts the tone mapping pass after the grade and before the lens effects", () => {
    const source = readFileSync(fileURLToPath(new URL("./PostEffects.tsx", import.meta.url)), "utf8");
    const positionOf = (marker: string) => {
      const index = source.indexOf(marker);
      expect(index, `${marker} not found in PostEffects.tsx`).toBeGreaterThan(-1);
      return index;
    };
    const bloom = positionOf('key="bloom"');
    const brightnessContrast = positionOf('key="brightness-contrast"');
    const toneMapping = positionOf('key="tone-mapping"');
    const chromaticAberration = positionOf('key="chromatic-aberration"');
    const vignette = positionOf('key="vignette"');
    const noise = positionOf('key="noise"');

    expect(bloom).toBeLessThan(toneMapping);
    expect(brightnessContrast).toBeLessThan(toneMapping);
    expect(toneMapping).toBeLessThan(chromaticAberration);
    expect(toneMapping).toBeLessThan(vignette);
    expect(toneMapping).toBeLessThan(noise);
  });
});
