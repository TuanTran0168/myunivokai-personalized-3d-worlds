"use client";

import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  Vignette
} from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import { BlendFunction } from "postprocessing";
import { Vector2 } from "three";
import type { ScenePostFXConfig, ScenePostFXGradeConfig } from "@/lib/types";
import { sceneGradeForTheme, type SceneGrade } from "@/lib/scene";
import {
  composerMultisamplingFor,
  shouldComputeAmbientOcclusionAtHalfResolution
} from "./renderQuality";

const DEFAULT_BLOOM_INTENSITY = 0.8;
// Selective bloom by luminance: with the composer's HDR (half-float) buffer,
// only deliberate emitters cross this line — the sun's >1 surface tint, the
// star shaders' hot cores, additive pile-ups — while lit planets stay below
// it and no longer leak muddy glow.
const BLOOM_LUMINANCE_THRESHOLD = 0.85;
const BLOOM_LUMINANCE_SMOOTHING = 0.2;
// Multisampling is no longer a constant: it comes from the device pixel ratio
// via composerMultisamplingFor, because an 8x-resolved RGBA16F target is the
// single largest per-pixel cost in the frame and its value falls away as the
// display's own density rises. See renderQuality.ts for the measurements.

// Ground-contact ambient occlusion for the forest family (universe scenes are
// emissive-lit and have no ground, so they skip it). Softly darkens the creases
// where trees/rocks/animals meet the floor — the single biggest cue that pulls
// the scene out of "flat cartoon" toward grounded realism. Radius is in world
// units (~2 = the base of a trunk); values tuned for the forest's 6-8u trees.
const FOREST_AO_RADIUS = 2;
const FOREST_AO_INTENSITY = 2.2;
const FOREST_AO_DISTANCE_FALLOFF = 1;

// Cinematic finish: gentle edge darkening, film grain blended soft-light, and
// a sub-pixel radial chromatic fringe. All of these merge into the composer's
// single fullscreen pass, so they are effectively free.
const VIGNETTE_OFFSET = 0.28;
const VIGNETTE_DARKNESS = 0.55;
const FILM_GRAIN_OPACITY = 0.06;
const CHROMATIC_ABERRATION_OFFSET = new Vector2(0.0005, 0.001);
const CHROMATIC_ABERRATION_MODULATION_OFFSET = 0.15;

// Grade channels arrive from stored data (schemaVersion 1.2); clamp magnitudes
// so a corrupt value can tint the frame, never destroy it.
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
function resolveSceneGrade(gradeConfig: ScenePostFXGradeConfig | undefined, theme: string | undefined): SceneGrade {
  const themeGrade = sceneGradeForTheme(theme);
  return {
    hueRadians: resolveGradeChannel(gradeConfig?.hueRadians, themeGrade.hueRadians, MAXIMUM_GRADE_HUE_MAGNITUDE_RADIANS),
    saturation: resolveGradeChannel(gradeConfig?.saturation, themeGrade.saturation, MAXIMUM_GRADE_SATURATION_MAGNITUDE),
    brightness: resolveGradeChannel(gradeConfig?.brightness, themeGrade.brightness, MAXIMUM_GRADE_BRIGHTNESS_MAGNITUDE),
    contrast: resolveGradeChannel(gradeConfig?.contrast, themeGrade.contrast, MAXIMUM_GRADE_CONTRAST_MAGNITUDE)
  };
}

type PostEffectsProps = {
  postFX?: ScenePostFXConfig;
  theme?: string;
  /** Forest family opts in to ground-contact ambient occlusion. */
  ambientOcclusion?: boolean;
};

export function PostEffects({ postFX, theme, ambientOcclusion = false }: PostEffectsProps) {
  const bloomIntensity = postFX?.bloomIntensity ?? DEFAULT_BLOOM_INTENSITY;
  const grade = resolveSceneGrade(postFX?.grade, theme);
  // The RENDERER's ratio, not the display's. Reading the display's was tried,
  // on the argument that a HiDPI panel makes the extra samples invisible even
  // when AdaptiveResolution has dropped the render ratio under it — and it
  // measured WORSE, 37 fps against 47 on the forest at 4K. The argument was
  // wrong: rendering at ratio 1 and letting the browser upscale to a dpr-2
  // panel produces a dpr-1 image with dpr-1 aliasing, and multisampling is
  // still what smooths it. Samples per RENDERED pixel is the thing that
  // matters, and the renderer is the only one that knows it.
  const pixelRatio = useThree((state) => state.gl.getPixelRatio());

  // Built as a filtered array so the AO effect can be conditionally present
  // (EffectComposer's children type rejects a literal null child). AO goes
  // first, so it darkens the lit color before bloom/grade read it.
  const effects = [
    ambientOcclusion ? (
      <N8AO
        key="n8ao"
        aoRadius={FOREST_AO_RADIUS}
        intensity={FOREST_AO_INTENSITY}
        distanceFalloff={FOREST_AO_DISTANCE_FALLOFF}
        halfRes={shouldComputeAmbientOcclusionAtHalfResolution(pixelRatio)}
      />
    ) : null,
    <Bloom
      key="bloom"
      intensity={bloomIntensity}
      luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
      luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
      mipmapBlur
    />,
    <HueSaturation key="hue-saturation" hue={grade.hueRadians} saturation={grade.saturation} />,
    <BrightnessContrast key="brightness-contrast" brightness={grade.brightness} contrast={grade.contrast} />,
    <ChromaticAberration
      key="chromatic-aberration"
      offset={CHROMATIC_ABERRATION_OFFSET}
      radialModulation
      modulationOffset={CHROMATIC_ABERRATION_MODULATION_OFFSET}
    />,
    <Vignette
      key="vignette"
      eskil={false}
      offset={VIGNETTE_OFFSET}
      darkness={VIGNETTE_DARKNESS}
    />,
    <Noise key="noise" premultiply opacity={FILM_GRAIN_OPACITY} blendFunction={BlendFunction.SOFT_LIGHT} />
    // React 19 removed the global JSX namespace; it lives under React now.
  ].filter((effect): effect is React.JSX.Element => effect !== null);

  return <EffectComposer multisampling={composerMultisamplingFor(pixelRatio)}>{effects}</EffectComposer>;
}
