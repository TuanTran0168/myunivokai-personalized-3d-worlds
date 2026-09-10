import { ACESFilmicToneMapping, AgXToneMapping, type ToneMapping } from "three";
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
 * Everything else. AgX rolls hot highlights off more gracefully than ACES — no
 * neon clipping on lit planets — which is what the sun, the binary suns, the
 * star cores and the additive nebula layers need.
 */
export const DEFAULT_FAMILY_TONE_MAPPING: ToneMapping = AgXToneMapping;

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
  [AgXToneMapping, ToneMappingMode.AGX]
]);

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
