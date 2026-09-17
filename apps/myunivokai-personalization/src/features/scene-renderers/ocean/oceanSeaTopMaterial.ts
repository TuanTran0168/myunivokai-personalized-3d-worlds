import { Color, DoubleSide, ShaderMaterial, type Material, type Texture } from "three";
import type { Node } from "three/webgpu";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import {
  oceanSurfaceNode,
  preethamSkyNode,
  GERSTNER_SURFACE_GLSL,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  WAVE_UNIFORMS_GLSL,
  type SkyUniformNodes,
  type WaveUniformNodes
} from "./oceanSky";

/**
 * THE SEA SEEN FROM ABOVE, IN BOTH SHADER LANGUAGES.
 *
 * §26 Phase 8, and the last raw `ShaderMaterial` in this family that can be
 * ported. The one after it — the god rays — is blocked on a look decision the
 * owner holds, and that is recorded in the research document rather than left
 * as an unexplained gap in the count.
 *
 * **WHY THIS ONE IS NOT BLOCKED AND THE GOD RAYS ARE.** This shader ends with
 * `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`: it
 * encodes ITSELF on the classic path. The node path encodes once for the whole
 * frame instead, and for a material that was already asking to be encoded those
 * are the same picture — one encode either way. The god rays end with a raw
 * linear write into an already-encoded framebuffer ON PURPOSE, and there is no
 * per-material opt-out from a frame-wide pass. Additive is the whole difference.
 *
 * **THE GLSL IS LEFT EXACTLY AS IT SHIPPED.** This is the surface every visitor
 * above water is looking at, and its numbers are a tuned reference
 * implementation — Water.js's four-scale normal lookup with its mutually prime
 * divisors, its `sunLight()` constants, and three departures from it that each
 * have a measured frame behind them. So, as with the caustics, the node graph
 * is built from declared constants and `oceanSeaTopMaterial.test.ts` asserts
 * every one of them is still in the shipped string. The classic path cannot
 * have moved, because nothing in it was retyped.
 */

/** The sky's own colours, used where a constant is honest. */
export const SKY_HAZE = "#9BBBD2";
export const FOAM_WHITE = "#EAF6FF";

/**
 * 103 m is Water.js's own largest lookup period; dividing the world by this
 * brings the whole cascade down to a scale a viewer six metres up can actually
 * resolve. At 1.0 the sea is smooth streaks.
 */
const RIPPLE_WORLD_SCALE = 5.0;

/**
 * The capillary ripple's weight against the Gerstner normal.
 *
 * Measured: at 0.55 the sea's local contrast fell 40% against a
 * normal-map-only surface, because a physically correct Beaufort 4 sea is
 * genuinely smooth and all of the sparkle lives in the scale below the
 * vertices.
 */
const RIPPLE_NORMAL_WEIGHT = 1.25;
const RIPPLE_HORIZONTAL_GAIN = 1.5;
const RIPPLE_VERTICAL_GAIN = 1.0;

const FOAM_WEIGHT = 1.0;
const SURFACE_EXPOSURE = 1.0;

/** Water.js's four lookup periods and four scroll rates, kept verbatim. */
const NOISE_PERIOD_FIRST = 103.0;
const NOISE_PERIOD_SECOND = 107.0;
const NOISE_PERIOD_THIRD_X = 8907.0;
const NOISE_PERIOD_THIRD_Y = 9803.0;
const NOISE_PERIOD_FOURTH_X = 1091.0;
const NOISE_PERIOD_FOURTH_Y = 1027.0;
const NOISE_SCROLL_FIRST_X = 17.0;
const NOISE_SCROLL_FIRST_Y = 29.0;
const NOISE_SCROLL_SECOND_X = -19.0;
const NOISE_SCROLL_SECOND_Y = 31.0;
const NOISE_SCROLL_THIRD_X = 101.0;
const NOISE_SCROLL_THIRD_Y = 97.0;
const NOISE_SCROLL_FOURTH_X = 109.0;
const NOISE_SCROLL_FOURTH_Y = -113.0;
/** Four samples of a 0..1 map, rescaled to a signed normal. */
const NOISE_SUM_SCALE = 0.5;
const NOISE_SUM_BIAS = 1.0;

/** Water.js's own `sunLight()`: shiny 100, spec 2, diffuse 0.5. */
const SPECULAR_SHININESS = 100.0;
const SPECULAR_GAIN = 2.0;
const DIFFUSE_GAIN = 0.5;
const DIFFUSE_INTO_WATER_BODY = 0.55;

/**
 * Physical normal-incidence reflectance for water is 0.02. Water.js uses 0.3 to
 * compensate for a dim mirror texture; this sky is analytic and correctly
 * bright, so the honest number works and the grazing horizon stays a mirror.
 */
const FRESNEL_NORMAL_INCIDENCE = 0.02;
const FRESNEL_POWER = 5.0;

/** Upwelling scatter: the only colour the water body itself has. */
const SCATTER_BASE = 0.34;
const SCATTER_RANGE = 1.15;
/** The whole sky dome lights the water, not just the sun. Without this it reads as metal. */
const SKY_DOME_CONTRIBUTION = 0.13;

/** Foam where the surface FOLDS, laced so it is not a stripe along the crest. */
const FOAM_FOLD_WIDTH = 0.34;
const FOAM_LACE_START = 0.02;
const FOAM_LACE_END = 0.42;
const FOAM_COVERAGE_CEILING = 0.86;

/** Aerial perspective: in air, distance is haze rather than absorption. */
const HAZE_HORIZON_TILT = 0.045;
const HAZE_PER_METRE = 0.0003;

const SUN_COLOR = "#FFF1D2";
const WATER_COLOR = "#0A6E9A";
const DEEP_COLOR = "#031B27";

export type SeaTopUniformValues = {
  uTime: { value: number };
  uNormals: { value: Texture };
  uSize: { value: number };
  uFoam: { value: number };
  uFoamEdge: { value: number };
  uDetail: { value: number };
  uExposure: { value: number };
  uSunColor: { value: Color };
  uWaterColor: { value: Color };
  uDeepColor: { value: Color };
  uHorizonColor: { value: Color };
  uFoamColor: { value: Color };
  [key: string]: { value: unknown };
};

/**
 * The uniform record both paths bind, built once so neither can be handed a
 * different number.
 *
 * `foamEdge` arrives from `foamFoldThreshold(seaState.whitecapFraction)` — a
 * measured mapping from Monahan's whitecap coverage onto the Jacobian
 * threshold, which is the difference between a sea state and a foam slider.
 */
export function seaTopUniformValues(normals: Texture, foamEdge: number): SeaTopUniformValues {
  return {
    uTime: { value: 0 },
    uNormals: { value: normals },
    uSize: { value: RIPPLE_WORLD_SCALE },
    uFoam: { value: FOAM_WEIGHT },
    uFoamEdge: { value: foamEdge },
    uDetail: { value: RIPPLE_NORMAL_WEIGHT },
    uExposure: { value: SURFACE_EXPOSURE },
    uSunColor: { value: new Color(SUN_COLOR) },
    uWaterColor: { value: new Color(WATER_COLOR) },
    uDeepColor: { value: new Color(DEEP_COLOR) },
    uHorizonColor: { value: new Color(SKY_HAZE) },
    uFoamColor: { value: new Color(FOAM_WHITE) }
  };
}

export type SeaTopMaterialSet = {
  material: Material;
  /** Advances the node path's own clock. A no-op on the classic path. */
  synchronise: () => void;
};

/** The classic path: the shipped `ShaderMaterial`, retyped nowhere. */
function classicSeaTopMaterial(uniforms: Record<string, { value: unknown }>, waveMax: number): SeaTopMaterialSet {
  const material = new ShaderMaterial({
    uniforms,
    side: DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      ${WAVE_UNIFORMS_GLSL(waveMax)}
      varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
      ${GERSTNER_SURFACE_GLSL(waveMax)}
      void main(){
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 offset; vec3 waveNormal; float fold;
        oceanSurface(world.xz, offset, waveNormal, fold);
        world += offset;
        vWorld = world;
        vWaveNormal = waveNormal;
        vFold = fold;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNormals;
      uniform float uTime; uniform float uSize; uniform float uFoam;
      uniform float uFoamEdge; uniform float uDetail; uniform float uExposure;
      uniform vec3 uSunColor;
      uniform vec3 uWaterColor; uniform vec3 uDeepColor;
      uniform vec3 uHorizonColor; uniform vec3 uFoamColor;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vWorld; varying vec3 vWaveNormal; varying float vFold;
      ${PREETHAM_SKY_GLSL}

      // Verbatim from three.js Water.js, constants included. The four divisors
      // (103, 107, 8907/9803, 1091/1027) and the four scroll rates are the whole
      // reason it does not look like a tiled texture: the periods are mutually
      // prime enough that the sum never repeats inside a frame.
      vec4 getNoise(vec2 uv){
        vec2 uv0 = (uv / 103.0) + vec2(uTime / 17.0, uTime / 29.0);
        vec2 uv1 = uv / 107.0 - vec2(uTime / -19.0, uTime / 31.0);
        vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(uTime / 101.0, uTime / 97.0);
        vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(uTime / 109.0, uTime / -113.0);
        vec4 sampled = texture2D(uNormals, uv0) + texture2D(uNormals, uv1)
                     + texture2D(uNormals, uv2) + texture2D(uNormals, uv3);
        return sampled * 0.5 - 1.0;
      }

      void main(){
        vec4 sampled = getNoise(vWorld.xz * uSize);
        // Two scales of normal, with different jobs. The Gerstner normal is the
        // SHAPE of the sea and it is exact; the texture is the capillary ripple
        // riding on it, which is where the sparkle lives and which no vertex
        // budget could ever resolve.
        vec3 ripple = normalize(sampled.xzy * vec3(1.5, 1.0, 1.5));
        vec3 n = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.z) * uDetail);

        vec3 toEye = cameraPosition - vWorld;
        float viewDistance = length(toEye);
        vec3 eyeDirection = normalize(toEye);

        // Water.js's own sunLight(): shiny 100, spec 2, diffuse 0.5. The
        // specular is the glitter path; the diffuse is what stops far water
        // going flat.
        vec3 mirrored = normalize(reflect(-uSkySunDirection, n));
        float alignment = max(0.0, dot(eyeDirection, mirrored));
        vec3 specular = pow(alignment, 100.0) * uSunColor * 2.0;
        vec3 diffuse = max(dot(uSkySunDirection, n), 0.0) * uSunColor * 0.5;

        vec3 skyDirection = normalize(reflect(-eyeDirection, n));
        skyDirection.y = abs(skyDirection.y);
        // The disc is excluded from the REFLECTION and left to the specular
        // term: a mirrored 19000x sun disc through a wave normal is a field of
        // white pixels the size of the tone map's shoulder, not a glitter path.
        vec3 sky = preethamSky(skyDirection, false);

        float theta = max(dot(eyeDirection, n), 0.0);
        // Physical rf0 for water is 0.02. Water.js uses 0.3 to compensate for a
        // dim mirror texture; our sky is analytic and correctly bright, so the
        // honest number works and the grazing horizon stays a mirror.
        float rf0 = 0.02;
        float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 5.0);
        // Upwelling scatter: the only colour the water body itself has, and
        // strongest looking straight down into it.
        vec3 scatter = mix(uDeepColor, uWaterColor, theta) * (0.34 + theta * 1.15);
        // The whole sky dome lights the water body, not just the sun. Without
        // this the non-reflective half of every wave has one directional source
        // and the sea reads as metal.
        scatter += uHorizonColor * 0.13;

        vec3 color = mix(scatter + diffuse * 0.55, sky + specular, reflectance);

        // Foam where the surface FOLDS. The Jacobian of the Gerstner
        // displacement collapses exactly where a real wave is overtaking
        // itself, which is what breaking IS — so foam appears on the forward
        // face of steep crests and nowhere else, without being told to. The
        // second, uncorrelated lace pattern stops it reading as a stripe
        // painted along the crest line.
        float breaking = smoothstep(uFoamEdge, uFoamEdge - 0.34, vFold);
        float lace = smoothstep(0.02, 0.42, sampled.x);
        color = mix(color, uFoamColor, clamp(breaking * lace * uFoam, 0.0, 0.86));

        // Aerial perspective. In air, distance is haze, not absorption. The
        // haze colour is the sky in THAT direction just above the horizon — so
        // the sea does not fade toward one average colour, it fades toward
        // whatever the sky actually is behind it, and the horizon dissolves
        // even when the sun is low and the two sides of the sky disagree.
        vec3 hazeDirection = normalize(vec3(-eyeDirection.x, 0.045, -eyeDirection.z));
        float haze = 1.0 - exp(-viewDistance * 0.00030);
        color = mix(color, preethamSky(hazeDirection, false), clamp(haze, 0.0, 1.0));

        gl_FragColor = vec4(color * uExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });

  return { material, synchronise: () => {} };
}

/**
 * The node path: the same surface, from the same library both faces of the
 * water already share.
 *
 * **IT SETS `vertexNode`, NOT `positionNode`, for the reason the water's
 * underside states at length**: the GLSL builds a WORLD position, displaces it
 * there and projects it itself, and reproducing that through `positionNode`
 * would mean inverting the model matrix — correct only while that matrix stays
 * a pure translation, which is an assumption about the rig a material has no
 * business making.
 *
 * **AND IT DOES NOT TONE MAP ITSELF.** The classic shader's last two lines are
 * `<tonemapping_fragment>` and `<colorspace_fragment>`; here the renderer's
 * frame-wide output pass does exactly that work, once, over the composited
 * frame. Doing it here as well would encode twice.
 */
function nodeSeaTopMaterial(
  uniformValues: SeaTopUniformValues,
  waveMax: number,
  skyNodes: SkyUniformNodes,
  waveNodes: WaveUniformNodes,
  modules: NodeMaterialModules
): SeaTopMaterialSet {
  const { NodeMaterial } = modules.webgpu;
  const {
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    modelWorldMatrix,
    normalize,
    positionGeometry,
    pow,
    reflect,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4
  } = modules.tsl;

  const material = new NodeMaterial();
  material.side = DoubleSide;
  material.fog = false;

  const elapsedSeconds = uniform(uniformValues.uTime.value);
  const rippleScale = uniform(uniformValues.uSize.value);
  const foamWeight = uniform(uniformValues.uFoam.value);
  const foamEdge = uniform(uniformValues.uFoamEdge.value);
  const rippleWeight = uniform(uniformValues.uDetail.value);
  const exposure = uniform(uniformValues.uExposure.value);
  const sunColor = uniform(uniformValues.uSunColor.value) as unknown as Node<"vec3">;
  const waterColor = uniform(uniformValues.uWaterColor.value) as unknown as Node<"vec3">;
  const deepColor = uniform(uniformValues.uDeepColor.value) as unknown as Node<"vec3">;
  const horizonColor = uniform(uniformValues.uHorizonColor.value) as unknown as Node<"vec3">;
  const foamColor = uniform(uniformValues.uFoamColor.value) as unknown as Node<"vec3">;

  // The vertex stage: the plane's own world position, displaced by the shared
  // Gerstner sum and projected here rather than by three.
  const geometryWorld = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
  const surface = oceanSurfaceNode(modules, waveNodes, vec2(geometryWorld.x, geometryWorld.z), waveMax);
  const displacedWorld = geometryWorld.add(surface.offset);
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(displacedWorld, 1));

  const world = varying(displacedWorld);
  const waveNormal = varying(surface.normal);
  const fold = varying(surface.jacobian);

  /** Water.js's four-scale lookup, at four mutually prime periods. */
  function surfaceNoise(uv: Node<"vec2">) {
    const firstUv = uv
      .div(NOISE_PERIOD_FIRST)
      .add(vec2(elapsedSeconds.div(NOISE_SCROLL_FIRST_X), elapsedSeconds.div(NOISE_SCROLL_FIRST_Y)));
    const secondUv = uv
      .div(NOISE_PERIOD_SECOND)
      .sub(vec2(elapsedSeconds.div(NOISE_SCROLL_SECOND_X), elapsedSeconds.div(NOISE_SCROLL_SECOND_Y)));
    const thirdUv = uv
      .div(vec2(NOISE_PERIOD_THIRD_X, NOISE_PERIOD_THIRD_Y))
      .add(vec2(elapsedSeconds.div(NOISE_SCROLL_THIRD_X), elapsedSeconds.div(NOISE_SCROLL_THIRD_Y)));
    const fourthUv = uv
      .div(vec2(NOISE_PERIOD_FOURTH_X, NOISE_PERIOD_FOURTH_Y))
      .sub(vec2(elapsedSeconds.div(NOISE_SCROLL_FOURTH_X), elapsedSeconds.div(NOISE_SCROLL_FOURTH_Y)));
    const summed = texture(uniformValues.uNormals.value, firstUv)
      .add(texture(uniformValues.uNormals.value, secondUv))
      .add(texture(uniformValues.uNormals.value, thirdUv))
      .add(texture(uniformValues.uNormals.value, fourthUv));
    return summed.mul(NOISE_SUM_SCALE).sub(NOISE_SUM_BIAS);
  }

  const sampled = surfaceNoise(vec2(world.x, world.z).mul(rippleScale));
  const ripple = normalize(vec3(sampled.x, sampled.z, sampled.y).mul(vec3(RIPPLE_HORIZONTAL_GAIN, RIPPLE_VERTICAL_GAIN, RIPPLE_HORIZONTAL_GAIN)));
  const surfaceNormal = normalize(waveNormal.add(vec3(ripple.x, float(0), ripple.z).mul(rippleWeight)));

  const toEye = cameraPosition.sub(world);
  const viewDistance = length(toEye);
  const eyeDirection = normalize(toEye);

  const mirrored = normalize(reflect(skyNodes.sunDirection.negate(), surfaceNormal));
  const alignment = max(float(0), dot(eyeDirection, mirrored));
  const specular = pow(alignment, float(SPECULAR_SHININESS)).mul(sunColor).mul(SPECULAR_GAIN);
  const diffuse = max(dot(skyNodes.sunDirection, surfaceNormal), float(0)).mul(sunColor).mul(DIFFUSE_GAIN);

  const reflected = normalize(reflect(eyeDirection.negate(), surfaceNormal));
  // `skyDirection.y = abs(skyDirection.y)` — a component assignment in GLSL,
  // and a rebuilt vector here. A reflection that points down has no sky to
  // sample, so it is folded back up.
  const skyDirection = vec3(reflected.x, abs(reflected.y), reflected.z) as unknown as Node<"vec3">;
  const sky = preethamSkyNode(modules, skyNodes, skyDirection, false);

  const theta = max(dot(eyeDirection, surfaceNormal), float(0));
  const reflectance = float(FRESNEL_NORMAL_INCIDENCE).add(
    float(1 - FRESNEL_NORMAL_INCIDENCE).mul(pow(float(1).sub(theta), float(FRESNEL_POWER)))
  );
  const scatter = mix(deepColor, waterColor, theta)
    .mul(float(SCATTER_BASE).add(theta.mul(SCATTER_RANGE)))
    .add(horizonColor.mul(SKY_DOME_CONTRIBUTION));

  const lit = mix(scatter.add(diffuse.mul(DIFFUSE_INTO_WATER_BODY)), sky.add(specular), reflectance);

  const breaking = smoothstep(foamEdge, foamEdge.sub(FOAM_FOLD_WIDTH), fold);
  const lace = smoothstep(float(FOAM_LACE_START), float(FOAM_LACE_END), sampled.x);
  const foamed = mix(lit, foamColor, clamp(breaking.mul(lace).mul(foamWeight), float(0), float(FOAM_COVERAGE_CEILING)));

  const hazeDirection = normalize(
    vec3(eyeDirection.x.negate(), float(HAZE_HORIZON_TILT), eyeDirection.z.negate())
  ) as unknown as Node<"vec3">;
  const haze = float(1).sub(exp(viewDistance.mul(-HAZE_PER_METRE)));
  const hazed = mix(foamed, preethamSkyNode(modules, skyNodes, hazeDirection, false), clamp(haze, float(0), float(1)));

  material.colorNode = vec4(hazed.mul(exposure), 1);

  return {
    material: material as unknown as Material,
    synchronise: () => {
      elapsedSeconds.value = uniformValues.uTime.value;
    }
  };
}

/** The sea surface seen from above, for whichever renderer is drawing. */
export function oceanSeaTopMaterial(
  uniformValues: SeaTopUniformValues,
  classicUniforms: Record<string, { value: unknown }>,
  waveMax: number,
  skyNodes: SkyUniformNodes | null,
  waveNodes: WaveUniformNodes | null,
  nodeModules: NodeMaterialModules | null
): SeaTopMaterialSet {
  if (nodeModules && skyNodes && waveNodes) {
    return nodeSeaTopMaterial(uniformValues, waveMax, skyNodes, waveNodes, nodeModules);
  }
  return classicSeaTopMaterial(classicUniforms, waveMax);
}
