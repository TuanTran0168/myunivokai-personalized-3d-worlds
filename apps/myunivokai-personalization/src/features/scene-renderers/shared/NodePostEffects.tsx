"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
// Type-only, so nothing from `three/webgpu` reaches the bundle: TypeScript
// erases these, and the runtime import below stays the dynamic one.
import type { Node, Renderer } from "three/webgpu";
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
  FOREST_AMBIENT_OCCLUSION_RADIUS,
  resolveSceneGrade,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET
} from "./postEffectsTuning";
import { shouldComputeAmbientOcclusionAtHalfResolution } from "./renderQuality";

/**
 * THE POST CHAIN WITHOUT `postprocessing`, WHICH IS §26 PHASE 5.
 *
 * `agent-system/research/webgpu-full-migration-feasibility-2026.md` §11.2 says
 * the library cannot come along: `postprocessing@6.39.4` holds 878 references to
 * WebGL-only classes and zero to WebGPU. Phase 4 then found the single line
 * where that stops being a statistic — `EffectComposer.setRenderer` reads
 * `renderer.getContext().getContextAttributes().alpha` (`build/index.js:994`),
 * and `WebGPURenderer.getContext()` returns a `GPUCanvasContext`, so the chain
 * cannot be CONSTRUCTED against the node renderer, let alone rendered with.
 *
 * **PHASE 5 AS WRITTEN IS IMPOSSIBLE, AND THIS FILE IS THE PROOF.** The plan
 * says to move to `RenderPipeline` + TSL "on the existing renderer", and §25's
 * recommended Architecture D is *defined* as "replacing the post chain on the
 * existing `WebGLRenderer`". It cannot be done. `RenderPipeline` is exported
 * only from `three/webgpu` — zero occurrences in `three.module.js` — and
 * `PassNode`, the base of every node effect and the thing that gets the scene
 * INTO the chain, calls `renderer.getMRT`, `setMRT`, `getOutputBufferType`,
 * `getOutputRenderTarget` and `contextNode`. All five have zero occurrences in
 * three's WebGL build. The node pipeline needs the node renderer.
 *
 * So this chain mounts only when the renderer IS a node renderer, which today
 * means only under the parity harness, and `PostEffects` keeps serving every
 * visitor. Two chains, one set of tuning values (`postEffectsTuning.ts`), and
 * the parity harness is what says when the new one is ready to become the only
 * one.
 *
 * WHAT THIS BUYS IMMEDIATELY, before any renderer swap: the composer families'
 * WebGPU parity legs stop being BLOCKED. Phase 4 could measure exactly one of
 * seven fixtures because the other six mount a chain that cannot be built.
 *
 * ORDER IS THE DESIGN, and it is the same order `PostEffects` documents at
 * length: ambient occlusion, then bloom, then the grade, then the tone curve,
 * then the lens effects. The tone curve is applied HERE, mid-chain, rather than
 * left to `RenderPipeline`'s own output handling — which would apply it last,
 * after the vignette and the grain, and put those two display-referred operators
 * on unbounded linear radiance. `renderer.toneMapping` is set to `NoToneMapping`
 * while this chain is mounted for exactly the reason `EffectComposer` does it,
 * with the difference that the pass is present.
 *
 * THE GRADE'S BRANCHES ARE RESOLVED ON THE CPU, which is a simplification rather
 * than a shortcut. pmndrs' shaders branch on the sign of `saturation` and
 * `contrast` because their uniforms change at runtime; here the grade comes from
 * stored scene data, is fixed for the life of the scene, and the whole chain is
 * rebuilt when it changes. So the branch is taken once, in JavaScript, and the
 * graph carries the resulting coefficients — identical arithmetic, no GPU
 * branch, fewer uniforms.
 */

/**
 * Any `useFrame` priority above zero turns off fiber's automatic render:
 * `if (!state.internal.priority && state.gl.render) state.gl.render(...)`
 * (@react-three/fiber 9.7.0). That is how this chain takes the frame over, and
 * it is also why the priority is ZERO until the pipeline exists — a positive
 * priority with nothing rendering yet would show a black canvas for as long as
 * the dynamic import takes.
 */
const NODE_PIPELINE_RENDER_PRIORITY = 1;
const FIBER_AUTOMATIC_RENDER_PRIORITY = 0;

/** GTAO computed at half resolution, matching what N8AO's `halfRes` asks for. */
const AMBIENT_OCCLUSION_HALF_RESOLUTION_SCALE = 0.5;
const AMBIENT_OCCLUSION_FULL_RESOLUTION_SCALE = 1;

/**
 * The AO scale three.js's own release notes ask for.
 *
 * §11.3 quotes r185: *"computes more physically correct ambient occlusion;
 * consider lowering `radius` and `scale`"*. `N8AO`'s intensity of 2.2 is not this
 * parameter and does not transfer to it — the two effects are different
 * algorithms — so this is the one value in the chain that is a NEW number rather
 * than a ported one, and the forest's ambient occlusion is the deliberate look
 * change §26 Phase 5 marks CRITICAL and hands to the owner's eye.
 */
const AMBIENT_OCCLUSION_NODE_SCALE = 1;

/**
 * pmndrs' saturation curve, reproduced exactly.
 *
 * `hue-saturation.frag`: positive saturation scales the deviation from the
 * channel average by `1 - 1/(1.001 - saturation)`, negative saturation by
 * `-saturation`. The 1.001 is what keeps saturation = 1 from dividing by zero,
 * and it is theirs, not a choice made here.
 */
const GRADE_SATURATION_SINGULARITY_GUARD = 1.001;

/**
 * The classic screen-space hash, for the film grain.
 *
 * NOT pmndrs' `rand()` — that include is not in the shipped build to copy, and a
 * 6%-opacity soft-light grain cannot be "the same noise" across two
 * implementations anyway. This is a named divergence: the grain's STATISTICS
 * match, its per-pixel pattern does not, and a parity comparison between the two
 * chains sees it as a small difference spread over the whole frame.
 */
const FILM_GRAIN_HASH_VECTOR_X = 12.9898;
const FILM_GRAIN_HASH_VECTOR_Y = 78.233;
const FILM_GRAIN_HASH_SCALE = 43758.5453;

/** `vignette.frag`, VignetteTechnique.DEFAULT — which is what `eskil={false}` selects. */
const VIGNETTE_SMOOTHSTEP_OUTER_EDGE = 0.8;
const VIGNETTE_SMOOTHSTEP_INNER_FACTOR = 0.799;
const SCREEN_CENTRE_COORDINATE = 0.5;

/** `brightness-contrast.frag` pivots the contrast around mid grey. */
const BRIGHTNESS_CONTRAST_PIVOT = 0.5;

/** `soft-light.frag`, which is the W3C soft-light definition written out. */
const SOFT_LIGHT_SOURCE_THRESHOLD = 0.5;
const SOFT_LIGHT_DESTINATION_THRESHOLD = 0.25;
const SOFT_LIGHT_POLYNOMIAL_FIRST = 16;
const SOFT_LIGHT_POLYNOMIAL_SECOND = 12;
const SOFT_LIGHT_POLYNOMIAL_THIRD = 3;

/**
 * three.js's `BloomNode` defaults its radius to 0, which is not what
 * `mipmapBlur` means: pmndrs' mipmap bloom spreads across the mip chain, and 0
 * here collapses the spread onto the brightest mip alone. 0.85 is pmndrs' own
 * default radius for that mode.
 */
const BLOOM_MIPMAP_RADIUS = 0.85;

const CHANNEL_COUNT_FOR_AVERAGE = 3;

type NodePostEffectsProps = {
  postFX?: ScenePostFXConfig;
  theme?: string;
  /** Forest family opts in to ground-contact ambient occlusion. */
  ambientOcclusion?: boolean;
  /** Which passes this device's tier can afford. Absent means every pass. */
  postProcessingProfile?: PostProcessingProfile;
};

/** What `RenderPipeline` gives us, narrowed to what this component calls. */
type NodeRenderPipeline = {
  render: () => void;
  dispose?: () => void;
};

/**
 * Every stage of the chain returns a different node CLASS — a texture node, a
 * bloom node, a chromatic aberration node, a join — and in the graph they are
 * all vec4 colour. Naming that keeps the casts down to the boundaries where the
 * addon classes do not unify.
 */
type ColourNode = Node<"vec4">;

/**
 * The hue rotation pmndrs builds on the CPU and dots the colour against three
 * rotations of: a Rodrigues rotation about the grey axis, written out.
 */
function hueRotationVector(hueRadians: number): [number, number, number] {
  const sineOfHue = Math.sin(hueRadians);
  const cosineOfHue = Math.cos(hueRadians);
  return [
    (2 * cosineOfHue + 1) / 3,
    (-Math.sqrt(3) * sineOfHue - cosineOfHue + 1) / 3,
    (Math.sqrt(3) * sineOfHue - cosineOfHue + 1) / 3
  ];
}

/** `hue-saturation.frag`'s branch on the sign of saturation, taken once. */
function saturationDeviationGain(saturation: number): number {
  if (saturation > 0) {
    return 1 - 1 / (GRADE_SATURATION_SINGULARITY_GUARD - saturation);
  }
  return -saturation;
}

/** `brightness-contrast.frag`'s branch on the sign of contrast, taken once. */
function contrastFactor(contrast: number): number {
  if (contrast > 0) {
    return 1 / (1 - contrast);
  }
  return 1 + contrast;
}

export function NodePostEffects({
  postFX,
  theme,
  ambientOcclusion = false,
  postProcessingProfile = EVERY_POST_PROCESSING_PASS
}: NodePostEffectsProps) {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const pixelRatio = useThree((state) => state.gl.getPixelRatio());
  const [pipeline, setPipeline] = useState<NodeRenderPipeline | null>(null);

  const bloomIntensity = postFX?.bloomIntensity ?? DEFAULT_BLOOM_INTENSITY;
  const grade = resolveSceneGrade(postFX?.grade, theme);
  const wantsAmbientOcclusion = ambientOcclusion && postProcessingProfile.ambientOcclusion;
  const wantsBloom = postProcessingProfile.bloom;
  const wantsLensAndGrain = postProcessingProfile.lensAndGrain;
  const wantsVignette = postProcessingProfile.vignette;
  const computesAmbientOcclusionAtHalfResolution = shouldComputeAmbientOcclusionAtHalfResolution(pixelRatio);

  useEffect(() => {
    let cancelled = false;
    let builtPipeline: NodeRenderPipeline | null = null;
    const rendererToneMappingBeforeMount = renderer.toneMapping;

    const build = async () => {
      // Dynamic, and every one of these pulls `three/webgpu`: a static import
      // would put a second full copy of three (~1 MB) in the main bundle of every
      // visitor, to serve a chain only the harness mounts. UniverseCanvas's
      // renderer switch imports it the same way for the same reason.
      const [threeWebgpu, tsl, bloomModule, ambientOcclusionModule, chromaticAberrationModule] = await Promise.all([
        import("three/webgpu"),
        import("three/tsl"),
        import("three/addons/tsl/display/BloomNode.js"),
        import("three/addons/tsl/display/GTAONode.js"),
        import("three/addons/tsl/display/ChromaticAberrationNode.js")
      ]);
      if (cancelled) return;

      const { RenderPipeline, NoToneMapping } = threeWebgpu;
      const {
        agxToneMapping,
        dot,
        float,
        mix,
        mrt,
        output,
        pass,
        screenUV,
        smoothstep,
        sRGBTransferEOTF,
        sRGBTransferOETF,
        step,
        time,
        toneMappingExposure,
        normalView,
        vec2,
        vec3,
        vec4
      } = tsl;

      // The scene, with normals alongside colour. GTAO needs depth AND normals,
      // and a multiple-render-target pass is the only way to get the normals
      // without drawing the scene twice — three.js's own GTAONode example is
      // built exactly this way.
      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output, normal: normalView }));
      // MULTISAMPLING IS NOT SET HERE, AND THAT IS A DIVERGENCE RATHER THAN AN
      // OVERSIGHT. `PassNode` sizes its target from `renderer.samples`, which on
      // the node renderer is a getter over a value fixed in the CONSTRUCTOR
      // (`three.webgpu.js:61642`) — there is no setter to call from a component.
      // The composer chain drives that number from the pixel ratio through
      // `composerMultisamplingFor`, which renderQuality.ts measured as the
      // largest per-pixel cost in the frame; the node chain currently gets
      // whatever `antialias: true` gave the renderer at creation. Wiring it means
      // passing the ratio into the `gl` factory, which is where §26 Phase 9
      // creates the renderer for real, so it belongs to that phase.

      let chain: ColourNode = scenePass.getTextureNode("output");

      if (wantsAmbientOcclusion) {
        const ambientOcclusionPass = ambientOcclusionModule.ao(
          scenePass.getTextureNode("depth"),
          scenePass.getTextureNode("normal"),
          camera
        );
        ambientOcclusionPass.radius.value = FOREST_AMBIENT_OCCLUSION_RADIUS;
        ambientOcclusionPass.distanceExponent.value = FOREST_AMBIENT_OCCLUSION_DISTANCE_FALLOFF;
        ambientOcclusionPass.scale.value = AMBIENT_OCCLUSION_NODE_SCALE;
        ambientOcclusionPass.resolutionScale = computesAmbientOcclusionAtHalfResolution
          ? AMBIENT_OCCLUSION_HALF_RESOLUTION_SCALE
          : AMBIENT_OCCLUSION_FULL_RESOLUTION_SCALE;
        // THE `r` CHANNEL, NOT THE WHOLE VECTOR, and getting that wrong renders a
        // BLACK FRAME with nothing reported. §11.3 quotes three's own r181 note —
        // "AO now only accessible in `r` channel" — so `getTextureNode()` returns
        // a vec4 whose green and blue are zero. Multiplying the scene colour by
        // that vector zeroes two of its channels before bloom or the grade ever
        // read it, and the result is a canvas that draws nothing while the
        // renderer, the graph build and the harness all report success.
        //
        // AO goes FIRST so bloom and the grade read an already-occluded image —
        // the order `PostEffects` states.
        chain = chain.mul(ambientOcclusionPass.getTextureNode().r) as unknown as ColourNode;
      }

      if (wantsBloom) {
        const bloomPass = bloomModule.bloom(chain, bloomIntensity, BLOOM_MIPMAP_RADIUS, BLOOM_LUMINANCE_THRESHOLD);
        bloomPass.smoothWidth.value = BLOOM_LUMINANCE_SMOOTHING;
        // Additive, on raw HDR, which is what makes BLOOM_LUMINANCE_THRESHOLD
        // mean "deliberate emitter" rather than "bright pixel".
        chain = chain.add(bloomPass as unknown as ColourNode);
      }

      // THE GRADE, ported from `hue-saturation.frag` and
      // `brightness-contrast.frag` rather than from three's own
      // `hue()`/`saturation()` helpers. Those exist and are close, but "close" is
      // what makes two chains diverge: three's `saturation` is a straight mix
      // toward luminance, pmndrs' scales the deviation from the channel AVERAGE
      // through a hyperbola, and the stored grade channels of every world ever
      // saved were authored against the second one.
      const [rotationX, rotationY, rotationZ] = hueRotationVector(grade.hueRadians);
      const hueRotation = vec3(rotationX, rotationY, rotationZ);
      const rotated = vec3(
        dot(chain.rgb, hueRotation.xyz),
        dot(chain.rgb, hueRotation.zxy),
        dot(chain.rgb, hueRotation.yzx)
      );
      const channelAverage = rotated.r.add(rotated.g).add(rotated.b).div(float(CHANNEL_COUNT_FOR_AVERAGE));
      const saturated = rotated.add(
        channelAverage.sub(rotated).mul(float(saturationDeviationGain(grade.saturation)))
      );

      // `min(color, 1.0)`, AND IT IS LOAD-BEARING RATHER THAN TIDY-UP.
      // pmndrs' shader ends with it, so the grade CLAMPS the frame to 1.0 in
      // linear space — before the tone curve, which therefore has almost nothing
      // above 1 left to roll off. That contradicts the comment in
      // `PostEffects.tsx` claiming the grade "keeps operating on the linear HDR
      // values", and it is reproduced here rather than fixed, because parity
      // comes first: it is one line to delete the day the owner decides the
      // highlights should survive the grade instead.
      const clamped = saturated.min(vec3(1));

      // brightness-contrast is the ONE effect in the composer chain that declares
      // `inputColorSpace = SRGBColorSpace`, so the composer converts linear to
      // sRGB before it and back after. The round trip is part of the look and is
      // reproduced, not skipped.
      // `sRGBTransferOETF`/`EOTF` are declared as returning a bare `Node`, so the
      // vec3-ness is restated here rather than inferred; the runtime value is a
      // vec3 either way.
      const displayReferred = sRGBTransferOETF(clamped) as Node<"vec3">;
      const graded = sRGBTransferEOTF(
        displayReferred
          .add(float(grade.brightness - BRIGHTNESS_CONTRAST_PIVOT))
          .mul(float(contrastFactor(grade.contrast)))
          .add(float(BRIGHTNESS_CONTRAST_PIVOT))
      ) as Node<"vec3">;

      // THE TONE CURVE, here and not at the end. See the file comment.
      // `toneMappingExposure` rather than a literal 1: it tracks
      // `renderer.toneMappingExposure`, which is the ocean family's per-depth
      // adaptation curve and must keep being readable if this chain ever serves
      // that family.
      chain = vec4(agxToneMapping(graded, toneMappingExposure) as Node<"vec3">, chain.a);

      if (wantsLensAndGrain) {
        // `chromaticAberration(node, strength, center, scale)` is not pmndrs'
        // parameterisation — pmndrs takes an offset in UV units plus a radial
        // modulation — so the offset's magnitude becomes the strength. A named
        // conversion rather than a matching number, and the second divergence in
        // this chain.
        const aberrationStrength = Math.hypot(CHROMATIC_ABERRATION_OFFSET_X, CHROMATIC_ABERRATION_OFFSET_Y);
        // THE CENTRE IS PASSED EXPLICITLY, AND PASSING `null` IS WHAT BROKE THIS
        // CHAIN ONCE. `ChromaticAberrationNode`'s JSDoc says "If null, uses
        // screen center (0.5, 0.5)" and the node does not implement that: it
        // uses `this.centerNode` directly in `uv.sub(center)`
        // (`ChromaticAberrationNode.js:83`), so a null centre makes the whole
        // graph fail to build with `THREE.TSL: TypeError: Cannot read
        // properties of null (reading 'build')` — logged, not thrown, and the
        // pipeline then renders an EMPTY frame while everything reports success.
        chain = chromaticAberrationModule.chromaticAberration(
          chain,
          float(aberrationStrength),
          vec2(SCREEN_CENTRE_COORDINATE, SCREEN_CENTRE_COORDINATE),
          float(1 + CHROMATIC_ABERRATION_MODULATION_OFFSET)
        ) as unknown as ColourNode;
      }

      if (wantsVignette) {
        // `vignette.frag`, technique DEFAULT.
        const distanceFromCentre = screenUV.sub(vec2(SCREEN_CENTRE_COORDINATE)).length();
        const vignetteFalloff = smoothstep(
          float(VIGNETTE_SMOOTHSTEP_OUTER_EDGE),
          float(VIGNETTE_OFFSET * VIGNETTE_SMOOTHSTEP_INNER_FACTOR),
          distanceFromCentre.mul(float(VIGNETTE_DARKNESS + VIGNETTE_OFFSET))
        );
        chain = vec4(chain.rgb.mul(vignetteFalloff), chain.a);
      }

      if (wantsLensAndGrain) {
        // `noise.frag` with PREMULTIPLY, blended through `soft-light.frag` at
        // FILM_GRAIN_OPACITY. Ported line by line, and this branch STAYS on the
        // GPU unlike the grade's, because it depends on the pixel rather than on
        // a uniform.
        const animatedUv = screenUV.mul(float(1).add(time));
        const grainHash = dot(animatedUv, vec2(FILM_GRAIN_HASH_VECTOR_X, FILM_GRAIN_HASH_VECTOR_Y));
        const grain = grainHash.sin().mul(float(FILM_GRAIN_HASH_SCALE)).fract();

        const destination = chain.rgb;
        const source = destination.mul(grain).min(vec3(1));
        const doubledSource = source.mul(float(2));
        const shifted = destination.add(doubledSource.sub(float(1)));
        const sourceIsUpperHalf = step(vec3(SOFT_LIGHT_SOURCE_THRESHOLD), source);
        const darkened = destination.sub(
          float(1).sub(doubledSource).mul(destination).mul(float(1).sub(destination))
        );
        // `mix(a, b, t)` is written out as `a*(1-t) + b*t` for both of these,
        // because the interpolant is PER CHANNEL — a `step()` result, exactly as
        // in `soft-light.frag` — and TSL's declared `mix` takes a scalar
        // interpolant only. Writing the arithmetic keeps the types honest instead
        // of casting a vec3 to a float.
        const usesPolynomialBranch = sourceIsUpperHalf.mul(
          float(1).sub(step(vec3(SOFT_LIGHT_DESTINATION_THRESHOLD), destination))
        );
        const squareRootForm = shifted.mul(destination.sqrt().sub(destination));
        const polynomialForm = shifted.mul(destination).mul(
          destination
            .mul(float(SOFT_LIGHT_POLYNOMIAL_FIRST))
            .sub(float(SOFT_LIGHT_POLYNOMIAL_SECOND))
            .mul(destination)
            .add(float(SOFT_LIGHT_POLYNOMIAL_THIRD))
        );
        const lightened = squareRootForm
          .mul(float(1).sub(usesPolynomialBranch))
          .add(polynomialForm.mul(usesPolynomialBranch));
        const blended = darkened
          .mul(float(1).sub(sourceIsUpperHalf))
          .add(lightened.mul(sourceIsUpperHalf));
        chain = vec4(mix(destination, blended, float(FILM_GRAIN_OPACITY)), chain.a);
      }

      // NoToneMapping on the renderer, because the curve is already in the chain.
      // `RenderPipeline` reads `renderer.toneMapping` and would otherwise apply it
      // a SECOND time, at the very end — after the vignette and the grain, which
      // is both a doubled curve and the wrong order.
      renderer.toneMapping = NoToneMapping;

      // R3F types `gl` as a WebGLRenderer; under the parity harness's second and
      // third renderers it is a `WebGPURenderer`, which is what this whole chain
      // requires and what the mount condition in UniverseCanvas guarantees.
      builtPipeline = new RenderPipeline(renderer as unknown as Renderer, chain);
      if (cancelled) {
        builtPipeline.dispose?.();
        return;
      }
      setPipeline(builtPipeline);
    };

    void build();

    return () => {
      cancelled = true;
      builtPipeline?.dispose?.();
      setPipeline(null);
      // Hand the renderer back the curve it had. `EffectComposer` does the same on
      // unmount, and the reason to copy it is that this component can be
      // unmounted by a tier change while the canvas lives on.
      renderer.toneMapping = rendererToneMappingBeforeMount;
    };
  }, [
    bloomIntensity,
    camera,
    computesAmbientOcclusionAtHalfResolution,
    grade.brightness,
    grade.contrast,
    grade.hueRadians,
    grade.saturation,
    renderer,
    scene,
    wantsAmbientOcclusion,
    wantsBloom,
    wantsLensAndGrain,
    wantsVignette
  ]);

  useFrame(() => {
    pipeline?.render();
  }, pipeline ? NODE_PIPELINE_RENDER_PRIORITY : FIBER_AUTOMATIC_RENDER_PRIORITY);

  return null;
}
