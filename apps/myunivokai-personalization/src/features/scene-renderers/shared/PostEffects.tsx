"use client";

import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  ToneMapping,
  Vignette
} from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import { BlendFunction } from "postprocessing";
import { Vector2 } from "three";
import type { ScenePostFXConfig } from "@/lib/types";
import type { PostProcessingProfile } from "./deviceQualityTier";
import {
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  CHROMATIC_ABERRATION_MODULATION_OFFSET,
  CHROMATIC_ABERRATION_OFFSET_X,
  CHROMATIC_ABERRATION_OFFSET_Y,
  DEFAULT_BLOOM_INTENSITY,
  EVERY_POST_PROCESSING_PASS,
  FILM_GRAIN_OPACITY,
  FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF,
  FOREST_AMBIENT_OCCLUSION_INTENSITY,
  FOREST_AMBIENT_OCCLUSION_RADIUS,
  resolveSceneGrade,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET
} from "./postEffectsTuning";
import {
  composerMultisamplingFor,
  shouldComputeAmbientOcclusionAtHalfResolution
} from "./renderQuality";
import { composerToneMappingModeFor, DEFAULT_FAMILY_TONE_MAPPING } from "./sceneToneMapping";

// EVERY TUNING VALUE THIS CHAIN USES NOW LIVES IN postEffectsTuning.ts, and it
// moved there rather than staying here because §26 Phase 5 adds a SECOND chain
// (NodePostEffects, three.js's own RenderPipeline) that has to be tuned
// identically. A value declared in two places is the bug sceneToneMapping.ts was
// written to close, and it closed it for one value only.
//
// Multisampling is not among them: it comes from the device pixel ratio via
// composerMultisamplingFor, because an 8x-resolved RGBA16F target is the single
// largest per-pixel cost in the frame and its value falls away as the display's
// own density rises. See renderQuality.ts for the measurements.
const CHROMATIC_ABERRATION_OFFSET = new Vector2(
  CHROMATIC_ABERRATION_OFFSET_X,
  CHROMATIC_ABERRATION_OFFSET_Y
);

// The tone curve, restored. `EffectComposer` sets gl.toneMapping =
// NoToneMapping on mount, so for every family that mounts this chain the AgX
// curve the canvas asked for was never applied and anything past 1.0 in linear
// space clipped flat to white — 10.1% of the universe world's canvas band at
// 250+ before this. The mode is derived from the renderer's own curve rather
// than named again here; see sceneToneMapping.ts.
const COMPOSER_TONE_MAPPING_MODE = composerToneMappingModeFor(DEFAULT_FAMILY_TONE_MAPPING);

type PostEffectsProps = {
  postFX?: ScenePostFXConfig;
  theme?: string;
  /** Forest family opts in to ground-contact ambient occlusion. */
  ambientOcclusion?: boolean;
  /**
   * Which passes this device's tier can afford. Absent means the top tier,
   * which is every pass — the same default the canvas had before tiering
   * existed, so a caller that does not know about tiers is unaffected.
   */
  postProcessingProfile?: PostProcessingProfile;
};

export function PostEffects({
  postFX,
  theme,
  ambientOcclusion = false,
  postProcessingProfile = EVERY_POST_PROCESSING_PASS
}: PostEffectsProps) {
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
    ambientOcclusion && postProcessingProfile.ambientOcclusion ? (
      <N8AO
        key="n8ao"
        aoRadius={FOREST_AMBIENT_OCCLUSION_RADIUS}
        intensity={FOREST_AMBIENT_OCCLUSION_INTENSITY}
        distanceFalloff={FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF}
        halfRes={shouldComputeAmbientOcclusionAtHalfResolution(pixelRatio)}
      />
    ) : null,
    postProcessingProfile.bloom ? (
      <Bloom
        key="bloom"
        intensity={bloomIntensity}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
      />
    ) : null,
    <HueSaturation key="hue-saturation" hue={grade.hueRadians} saturation={grade.saturation} />,
    <BrightnessContrast key="brightness-contrast" brightness={grade.brightness} contrast={grade.contrast} />,
    // AFTER the grade and BEFORE the lens effects, and the position is the
    // whole design decision.
    //
    // After the grade, so HueSaturation and BrightnessContrast keep operating
    // on the linear HDR values they always operated on — the stored grade
    // channels were authored against that behaviour, and moving the curve above
    // them would re-grade every world that has ever been saved.
    //
    // Before the lens effects, because vignette darkening and soft-light grain
    // are display-referred operators: they are meant to sit on a finished
    // image, and applying them to unbounded linear radiance is why the grain
    // reads differently over a bright frame than a dark one.
    //
    // Bloom stays above it and therefore still selects on raw HDR luminance,
    // which is what makes BLOOM_LUMINANCE_THRESHOLD mean "deliberate emitter"
    // rather than "bright pixel".
    <ToneMapping key="tone-mapping" mode={COMPOSER_TONE_MAPPING_MODE} />,
    postProcessingProfile.lensAndGrain ? (
      <ChromaticAberration
        key="chromatic-aberration"
        offset={CHROMATIC_ABERRATION_OFFSET}
        radialModulation
        modulationOffset={CHROMATIC_ABERRATION_MODULATION_OFFSET}
      />
    ) : null,
    postProcessingProfile.vignette ? (
      <Vignette
        key="vignette"
        eskil={false}
        offset={VIGNETTE_OFFSET}
        darkness={VIGNETTE_DARKNESS}
      />
    ) : null,
    postProcessingProfile.lensAndGrain ? (
      <Noise key="noise" premultiply opacity={FILM_GRAIN_OPACITY} blendFunction={BlendFunction.SOFT_LIGHT} />
    ) : null
    // React 19 removed the global JSX namespace; it lives under React now.
  ].filter((effect): effect is React.JSX.Element => effect !== null);

  return <EffectComposer multisampling={composerMultisamplingFor(pixelRatio)}>{effects}</EffectComposer>;
}
