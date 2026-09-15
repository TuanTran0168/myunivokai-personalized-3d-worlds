import type { ScenePostFXGradeConfig } from "@/lib/types";
import { sceneGradeForTheme, type SceneGrade } from "@/lib/scene";
import type { PostProcessingProfile } from "./deviceQualityTier";

/**
 * EVERY NUMBER THE POST CHAIN IS TUNED WITH, IN ONE PLACE, BECAUSE THERE ARE
 * NOW TWO CHAINS.
 *
 * §26 Phase 5 of agent-system/research/webgpu-full-migration-feasibility-2026.md
 * replaces `postprocessing@6.39.4` with three.js's own `RenderPipeline` and TSL.
 * That replacement cannot be done in place: `RenderPipeline` and `PassNode` are
 * exported only from `three/webgpu`, and `PassNode` calls `renderer.getMRT`,
 * `setMRT`, `getOutputBufferType`, `getOutputRenderTarget` and `contextNode` —
 * five methods with ZERO occurrences in three's WebGL build. So the node chain
 * needs the node renderer, and for as long as `WebGLRenderer` is what ships,
 * both chains exist.
 *
 * Two chains means two opportunities to tune one of them. `sceneToneMapping.ts`
 * exists because a tone curve declared in two places drifted in exactly that
 * way, silently, for the app's whole life — nothing throws when a post value is
 * wrong, the image simply stops being the image that was designed. So the values
 * are declared once here, both chains import them, and
 * `postEffectsTuning.test.ts` asserts that neither chain declares its own.
 *
 * The numbers themselves are unchanged from the composer chain they came from;
 * this module was an extraction, not a retune.
 */

/** Used when a world stores no bloom intensity of its own. */
export const DEFAULT_BLOOM_INTENSITY = 0.8;

/**
 * Selective bloom by luminance: with an HDR (half-float) buffer, only
 * deliberate emitters cross this line — the sun's >1 surface tint, the star
 * shaders' hot cores, additive pile-ups — while lit planets stay below it and do
 * not leak muddy glow.
 */
export const BLOOM_LUMINANCE_THRESHOLD = 0.85;
export const BLOOM_LUMINANCE_SMOOTHING = 0.2;

/**
 * Ground-contact ambient occlusion for the forest family (universe scenes are
 * emissive-lit and have no ground, so they skip it). Softly darkens the creases
 * where trees, rocks and animals meet the floor — the single biggest cue that
 * pulls the scene out of "flat cartoon" toward grounded realism.
 *
 * The radius is in world units (~2 = the base of a trunk), tuned for the
 * forest's 6-8 unit trees.
 *
 * THESE THREE DO NOT TRANSFER NUMERICALLY BETWEEN THE TWO CHAINS, and that is
 * recorded here rather than discovered later: the composer chain computes them
 * with `N8AO`, the node chain with three.js's `GTAONode`, and §11.3 of the
 * feasibility report has three.js's own release notes saying r185 "computes more
 * physically correct ambient occlusion; consider lowering `radius` and `scale`".
 * The node chain therefore declares its own AO scale below, and the forest's AO
 * is the one look change §26 Phase 5 calls CRITICAL and hands to the owner's eye.
 */
export const FOREST_AMBIENT_OCCLUSION_RADIUS = 2;
export const FOREST_AMBIENT_OCCLUSION_INTENSITY = 2.2;
export const FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF = 1;

/**
 * Cinematic finish: gentle edge darkening, film grain blended soft-light, and a
 * sub-pixel radial chromatic fringe. All of these merge into a single fullscreen
 * pass, so they are effectively free.
 */
export const VIGNETTE_OFFSET = 0.28;
export const VIGNETTE_DARKNESS = 0.55;
export const FILM_GRAIN_OPACITY = 0.06;

/**
 * Held as two numbers rather than as a `Vector2`, deliberately.
 *
 * `three` and `three/webgpu` are two separate copies of the library in this
 * bundle — the second is imported dynamically precisely so it stays out of every
 * visitor's download — so a `Vector2` constructed from one copy is not an
 * instance of the other copy's class. Each chain builds its own vector from
 * these components.
 */
export const CHROMATIC_ABERRATION_OFFSET_X = 0.0005;
export const CHROMATIC_ABERRATION_OFFSET_Y = 0.001;
export const CHROMATIC_ABERRATION_MODULATION_OFFSET = 0.15;

/**
 * Grade channels arrive from stored data (schemaVersion 1.2); clamp magnitudes
 * so a corrupt value can tint the frame, never destroy it.
 */
const MAXIMUM_GRADE_HUE_MAGNITUDE_RADIANS = Math.PI;
const MAXIMUM_GRADE_SATURATION_MAGNITUDE = 1;
const MAXIMUM_GRADE_BRIGHTNESS_MAGNITUDE = 0.5;
const MAXIMUM_GRADE_CONTRAST_MAGNITUDE = 1;

function resolveGradeChannel(value: number | undefined, fallback: number, maximumMagnitude: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximumMagnitude, Math.max(-maximumMagnitude, value));
}

/**
 * Clamp + fallback resolution of the stored postFX grade (promoted into scene
 * data in schemaVersion 1.2). Worlds stored before 1.2 have no grade key and
 * resolve to the per-theme grade table in lib/scene.ts — the same values the
 * grade used to be hardcoded with, so old worlds keep grading identically.
 */
export function resolveSceneGrade(
  gradeConfig: ScenePostFXGradeConfig | undefined,
  theme: string | undefined
): SceneGrade {
  const themeGrade = sceneGradeForTheme(theme);
  return {
    hueRadians: resolveGradeChannel(gradeConfig?.hueRadians, themeGrade.hueRadians, MAXIMUM_GRADE_HUE_MAGNITUDE_RADIANS),
    saturation: resolveGradeChannel(gradeConfig?.saturation, themeGrade.saturation, MAXIMUM_GRADE_SATURATION_MAGNITUDE),
    brightness: resolveGradeChannel(gradeConfig?.brightness, themeGrade.brightness, MAXIMUM_GRADE_BRIGHTNESS_MAGNITUDE),
    contrast: resolveGradeChannel(gradeConfig?.contrast, themeGrade.contrast, MAXIMUM_GRADE_CONTRAST_MAGNITUDE)
  };
}

/** The top tier's answer: every pass. The default when a caller knows no tier. */
export const EVERY_POST_PROCESSING_PASS: PostProcessingProfile = {
  ambientOcclusion: true,
  bloom: true,
  lensAndGrain: true,
  vignette: true
};
