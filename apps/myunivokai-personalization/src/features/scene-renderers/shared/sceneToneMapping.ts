import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, type ToneMapping } from "three";
import { ToneMappingMode } from "postprocessing";

/**
 * WHICH TONE CURVE EACH FAMILY GETS, IN ONE PLACE, BECAUSE TWO PLACES IS HOW
 * THIS BROKE.
 *
 * A tone curve has to be declared twice in this app and the two declarations
 * are not interchangeable:
 *
 * - `UniverseCanvas`'s `gl` prop sets `renderer.toneMapping`, which three
 *   applies IN EACH MATERIAL'S SHADER and which every material can opt out of
 *   with `toneMapped={false}`.
 * - A composer chain sets its own, as a fullscreen pass, because
 *   `EffectComposer` assigns `gl.toneMapping = NoToneMapping` on mount
 *   (`@react-three/postprocessing/src/EffectComposer.tsx:175-182`, with the
 *   comment "threejs disallows tonemapping on render targets"). It is
 *   unconditional and it has no opinion about whether the chain contains a
 *   `<ToneMapping>` effect.
 *
 * FOR THREE OF THE FOUR FAMILIES THE SECOND DECLARATION WAS MISSING, so their
 * `gl` prop was dead. Forest, universe and the fallback renderer mount the
 * composer and had no `<ToneMapping>` in it, which means the AgX curve
 * `UniverseCanvas` asked for was never applied to any of them and every linear
 * value above 1 clipped flat to white. Measured before the fix: 10.1% of the
 * universe world's canvas band at 250+ in some channel.
 *
 * The ocean was hit by the identical bug and fixed the other way, by leaving
 * the chain entirely (`UniverseCanvas.tsx`, and `oceanRig.ts:313`), so its
 * per-depth `toneMappingExposure` could be read by the renderer's own ACES.
 * That fix was correct for the ocean and is not available to the others: they
 * need the bloom, AO and grade the chain provides.
 *
 * So the pair is declared here together, and `sceneToneMapping.test.ts` asserts
 * that the composer's mode is the same curve as the renderer's. The failure
 * this prevents is silent by construction — nothing throws when a tone curve is
 * missing, the image just clips — so a mismatch has to be caught by an
 * assertion rather than by looking.
 */

/**
 * The ocean's curve. NOT a preference: that family's whole grade was designed
 * and proven against three.js's own ACES at a per-depth `toneMappingExposure`,
 * where the adaptation curve IS the exposure.
 */
export const OCEAN_FAMILY_TONE_MAPPING: ToneMapping = ACESFilmicToneMapping;

/**
 * Everything else: universe, forest, and the fallback renderer.
 *
 * **THESE THREE FAMILIES RENDERED WITH NO TONE CURVE AT ALL UNTIL 2026-09-10**,
 * for the app's whole life, because of the bug described above. So there is no
 * long-standing design intent to preserve here — every world these families
 * have ever shown was authored by eye against a FLAT CLAMP, where every linear
 * value above 1 hit the display ceiling and stayed fully saturated.
 *
 * The curve first restored was AgX, chosen while fixing the clipping rather
 * than while looking at the result, and the owner reported the result as "a
 * sheet of frosted glass laid over the sun — it is not fiery red like it used
 * to be". That report is accurate, and AgX is doing exactly what AgX is for:
 * `demos/sun-tone-curve/` measures the sun's own colours through all four
 * curves and finds AgX keeps **0.63** of the saturation the flat clamp gave,
 * while lifting middle grey from 0.18 to 0.215. Less saturated and lighter in
 * the mids is the definition of a veil.
 *
 * Khronos PBR Neutral is the curve that answers the report. It keeps **1.06**
 * of that saturation — it is designed to leave in-gamut colour alone and
 * compress only what would clip — and it takes middle grey DOWN to 0.14 and a
 * deep shadow from 0.02 to 0.0025, so the black of space stays black. It is
 * still a real tone curve: nothing clips flat, which is what the original fix
 * was for.
 *
 * ONE CONSTANT, and `demos/sun-tone-curve/` renders all four side by side if
 * the owner wants a different one.
 */
export const DEFAULT_FAMILY_TONE_MAPPING: ToneMapping = NeutralToneMapping;

/**
 * The same curves as the composer knows them.
 *
 * `postprocessing`'s `ToneMappingEffect` compiles these modes down to three.js's
 * own shader functions — `ToneMappingMode.AGX` becomes `AgXToneMapping(texel)`
 * and `ACES_FILMIC` becomes `ACESFilmicToneMapping(texel)` — so a composer pass
 * in the matching mode is the same curve as the renderer's, not an
 * approximation of it.
 */
const COMPOSER_MODE_BY_RENDERER_TONE_MAPPING = new Map<ToneMapping, ToneMappingMode>([
  [ACESFilmicToneMapping, ToneMappingMode.ACES_FILMIC],
  [AgXToneMapping, ToneMappingMode.AGX],
  [NeutralToneMapping, ToneMappingMode.NEUTRAL]
]);

/**
 * THE THIRD DECLARATION OF THE SAME CURVE, AND IT WAS A HARDCODED ONE.
 *
 * This module's whole reason to exist is that a tone curve declared twice
 * drifts. It was already declared three times: `NodePostEffects.tsx` called
 * `agxToneMapping` from `three/tsl` as a literal, agreeing with the composer by
 * coincidence rather than by construction. Changing the default curve in one
 * place would have left the node chain on AgX and the composer on Neutral — two
 * renderers of the same scene, grading differently, with nothing throwing.
 *
 * The node chain cannot import these functions from here: they live in
 * `three/tsl`, which drags a second full copy of three into the bundle, and that
 * module is deliberately reached through a dynamic `import()` inside the
 * chain's effect. So this map names the EXPORT rather than holding it, and the
 * chain looks the name up on the module it already imported.
 */
export type ToneMappingNodeFunctionName =
  | "acesFilmicToneMapping"
  | "agxToneMapping"
  | "neutralToneMapping";

const NODE_FUNCTION_BY_RENDERER_TONE_MAPPING = new Map<ToneMapping, ToneMappingNodeFunctionName>([
  [ACESFilmicToneMapping, "acesFilmicToneMapping"],
  [AgXToneMapping, "agxToneMapping"],
  [NeutralToneMapping, "neutralToneMapping"]
]);

/**
 * The `three/tsl` export that reproduces a renderer tone curve.
 *
 * Throws on an unmapped curve for the same reason `composerToneMappingModeFor`
 * does: a fallback would render a frame with a curve nobody chose.
 */
export function toneMappingNodeFunctionNameFor(rendererToneMapping: ToneMapping): ToneMappingNodeFunctionName {
  const functionName = NODE_FUNCTION_BY_RENDERER_TONE_MAPPING.get(rendererToneMapping);
  if (functionName === undefined) {
    throw new Error(
      `sceneToneMapping: no three/tsl function is declared for renderer tone mapping ${rendererToneMapping}. ` +
        "Add it to NODE_FUNCTION_BY_RENDERER_TONE_MAPPING; a silently wrong curve is how this broke before."
    );
  }
  return functionName;
}

/**
 * The composer mode that reproduces a renderer tone curve.
 *
 * Throws on an unmapped curve rather than falling back to a default. A default
 * here would reintroduce exactly the class of bug this module exists to close:
 * the frame would still render, with a curve nobody chose, and no one would
 * find out from the image.
 */
export function composerToneMappingModeFor(rendererToneMapping: ToneMapping): ToneMappingMode {
  const mode = COMPOSER_MODE_BY_RENDERER_TONE_MAPPING.get(rendererToneMapping);
  if (mode === undefined) {
    throw new Error(
      `sceneToneMapping: no composer mode is declared for renderer tone mapping ${rendererToneMapping}. ` +
        "Add it to COMPOSER_MODE_BY_RENDERER_TONE_MAPPING; a silently wrong curve is how this broke before."
    );
  }
  return mode;
}

/** The curve a family renders with, before any composer is considered. */
export function rendererToneMappingForFamily({ isOceanFamilyScene }: { isOceanFamilyScene: boolean }): ToneMapping {
  return isOceanFamilyScene ? OCEAN_FAMILY_TONE_MAPPING : DEFAULT_FAMILY_TONE_MAPPING;
}
