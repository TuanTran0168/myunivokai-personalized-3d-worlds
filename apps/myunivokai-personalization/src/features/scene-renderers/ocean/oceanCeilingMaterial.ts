import { Color, DoubleSide, ShaderMaterial, type Material } from "three";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import {
  GERSTNER_SURFACE_GLSL,
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  WAVE_UNIFORMS_GLSL,
  oceanSurfaceNode,
  skyThroughSnellsWindowNode,
  type SkyUniformNodes,
  type WaveUniformNodes,
} from "./oceanSky";

/**
 * THE WATER SEEN FROM UNDERNEATH, IN BOTH SHADER LANGUAGES.
 *
 * §26 Phases 6-8, the ocean. The first consumer of BOTH halves of the node
 * library landed in `1121758` — `oceanSurfaceNode` for the Gerstner vertex sum
 * and `skyThroughSnellsWindowNode` for what refracts down through it — which
 * until now had no caller at all.
 *
 * WHAT A VIEWER UNDERWATER ACTUALLY SEES OVERHEAD. Not a sky. A disc: beyond
 * the critical angle the surface stops being a window and becomes a mirror,
 * because light arriving from outside cannot refract past it. That disc is
 * Snell's window, it is about 97 degrees wide, and everything outside it is the
 * water column reflected back down.
 *
 * **THE GLSL IS MOVED, NOT REWRITTEN.** Its locals are `n`, `d` and `view`,
 * which this repo's style rule would rename; they are left exactly as they were
 * so the extraction stays checkable token for token, the same decision
 * `oceanBackdropMaterial.ts` records. The node twin is new code and spells its
 * names out.
 */

/**
 * How far the critical-angle test tilts toward the true wave normal.
 *
 * Measuring against the FULL normal fragments the window into patches at any
 * real swell height, because every wave face crosses the critical angle
 * separately. At a third of the way the disc holds as one shape and still moves
 * with the water.
 */
const NORMAL_TILT_FRACTION = 0.32;

/**
 * Where the window closes, as a sine.
 *
 * **THIS IS THE CRITICAL SINE ROUNDED, AND IT IS LEFT ROUNDED DELIBERATELY.**
 * The exact value is `1 / WATER_REFRACTIVE_INDEX` = 0.750187…, which this module
 * already declares; the shipped shader spells 0.75. Substituting the exact
 * constant would be a look change of two parts in ten thousand that nobody
 * asked for and no test could see, hidden inside a port. It is named here so the
 * next reader knows it is a rounding rather than a coincidence.
 */
const CRITICAL_SINE_ROUNDED = 0.75;
const TOTAL_INTERNAL_REFLECTION_START = 0.7;
const TOTAL_INTERNAL_REFLECTION_END = 0.775;

/**
 * The ripple sparkle, strongest where refraction magnifies the slope, faded
 * radially so it does not hold flat and then stop at the window's hard rim.
 */
const SPARKLE_NORMAL_POWER = 6;
const SPARKLE_WEIGHT = 0.06;

/** Outside the window the surface is a mirror of the water column below it. */
const MIRROR_UPNESS_POWER = 0.7;
const MIRROR_WATER_WEIGHT = 0.85;

/** Schlick, at water's real normal-incidence reflectance. */
const FRESNEL_NORMAL_INCIDENCE = 0.02;
const FRESNEL_RANGE = 0.98;
const FRESNEL_POWER = 5;
const FRESNEL_TINT_WEIGHT = 0.6;

/**
 * The same extinction law the medium uses, because this sheet is IN the medium.
 * Overhead it is metres away and survives; at the grazing angles that would
 * otherwise paint the whole upper frame it is hundreds of metres away and gone.
 */
const EXTINCTION_POWER = 2;

/** How the GLSL spells a float, so a rebuilt string matches the shipped one. */
function glslFloat(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export type OceanCeilingSettings = {
  waterColor: Color;
  deepColor: Color;
  sunColor: Color;
  /** The adaptation exposure for this depth, applied as a final multiply. */
  brightness: number;
  fogDensityPerMetre: number;
  /** How much of the sky survives the trip down, anchored to the water's value. */
  skyGain: number;
  /**
   * Read from below the eye sees SLOPES, not crests; full wave height turns the
   * ceiling into corrugated iron.
   */
  waveDamping: number;
};

export function ceilingVertexShaderGlsl(maxComponents: number): string {
  return /* glsl */ `
      uniform float uWaveDamping;
      ${WAVE_UNIFORMS_GLSL(maxComponents)}
      varying vec3 vWorld; varying vec3 vWaveNormal;
      ${GERSTNER_SURFACE_GLSL(maxComponents)}
      void main(){
        vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 offset; vec3 normal; float fold;
        oceanSurface(world.xz, offset, normal, fold);
        world += offset * uWaveDamping;
        vWorld = world;
        vWaveNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, uWaveDamping));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`;
}

export function ceilingFragmentShaderGlsl(): string {
  return /* glsl */ `
      uniform vec3 uWaterColor; uniform vec3 uDeepColor; uniform vec3 uSunColor;
      uniform vec3 uSunDirection; uniform float uBrightness; uniform float uFogDensity;
      uniform float uSkyGain;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vWorld; varying vec3 vWaveNormal;
      ${PREETHAM_SKY_GLSL}
      void main(){
        vec3 view = normalize(vWorld - cameraPosition);
        vec3 n = normalize(vWaveNormal);
        // Measure the critical angle against a TILTED normal, not the full wave
        // normal: at a real swell height the window otherwise fragments into
        // patches instead of holding as one disc.
        vec3 tilted = normalize(mix(vec3(0.0, 1.0, 0.0), n, ${glslFloat(NORMAL_TILT_FRACTION, 2)}));
        float upness = abs(dot(view, tilted));
        float sinTheta = sqrt(max(0.0, 1.0 - upness * upness));
        // Beyond sin(theta) = 1/1.333 nothing can refract in, so the surface
        // goes total-internal-reflection: a mirror, not a window.
        float window = 1.0 - smoothstep(${glslFloat(TOTAL_INTERNAL_REFLECTION_START, 2)}, ${glslFloat(TOTAL_INTERNAL_REFLECTION_END, 3)}, sinTheta);
        // How far out across the cone we are: 0 at the zenith, 1 at the
        // critical angle. The sky's own gradient, compressed.
        float coneT = clamp(sinTheta / ${glslFloat(CRITICAL_SINE_ROUNDED, 2)}, 0.0, 1.0);
        vec3 sky = skyThroughSnellsWindow(view, sinTheta) * uSkyGain;
        // Ripple sparkle, strongest where refraction magnifies the slope,
        // fading radially toward the window's rim instead of holding flat
        // then cutting off with the window's own hard edge.
        sky += uSunColor * pow(max(0.0, n.y), ${glslFloat(SPARKLE_NORMAL_POWER, 1)}) * ${glslFloat(SPARKLE_WEIGHT, 2)} * (1.0 - coneT);

        vec3 mirror = mix(uDeepColor, uWaterColor, pow(upness, ${glslFloat(MIRROR_UPNESS_POWER, 1)})) + uWaterColor * ${glslFloat(MIRROR_WATER_WEIGHT, 2)};
        float fresnel = ${glslFloat(FRESNEL_NORMAL_INCIDENCE, 2)} + ${glslFloat(FRESNEL_RANGE, 2)} * pow(1.0 - upness, ${glslFloat(FRESNEL_POWER, 1)});
        vec3 color = mix(mirror, sky, window);
        color = mix(color, uWaterColor, fresnel * (1.0 - window) * ${glslFloat(FRESNEL_TINT_WEIGHT, 1)});

        // The same extinction law the medium uses, because this sheet is IN the
        // medium. Overhead it is metres away and survives; at the grazing angles
        // that would otherwise paint the whole upper frame it is hundreds of
        // metres away and is gone.
        float d = length(vWorld - cameraPosition);
        float swallow = 1.0 - exp(-pow(d * uFogDensity, ${glslFloat(EXTINCTION_POWER, 1)}));
        color = mix(color, uWaterColor, clamp(swallow, 0.0, 1.0));

        gl_FragColor = vec4(color * uBrightness, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
}

/**
 * The uniform record the classic material binds.
 *
 * **`uSunDirection` IS DECLARED, BOUND, AND NEVER READ**, and it is left that
 * way rather than quietly deleted or quietly revived. The fragment stage
 * mentions it exactly once — in its own declaration — because the sun reaches
 * this surface through `skyThroughSnellsWindow`, which takes its direction from
 * the shared sky uniforms instead. Removing it is a cleanup someone should make
 * deliberately; reviving it is a look change. A port is the wrong moment for
 * either. The node twin simply does not build a node for it, which is not a
 * decision — there is nothing to port.
 *
 * `uFoamEdge` used to be bound here too and is NOT, because the shader never
 * declared it: the surface seen from below has no foam term at all. It was
 * computed every build and uploaded to a uniform that does not exist.
 */
function ceilingUniformValues(
  settings: OceanCeilingSettings,
  sunDirection: Color | { clone: () => unknown },
  skyShared: Record<string, { value: unknown }>,
  waveShared: Record<string, { value: unknown }>
): Record<string, { value: unknown }> {
  return {
    uWaterColor: { value: settings.waterColor.clone() },
    uDeepColor: { value: settings.deepColor.clone() },
    uSunColor: { value: settings.sunColor.clone() },
    uSunDirection: { value: sunDirection.clone() },
    uBrightness: { value: settings.brightness },
    uFogDensity: { value: settings.fogDensityPerMetre },
    uSkyGain: { value: settings.skyGain },
    uWaveDamping: { value: settings.waveDamping },
    ...skyShared,
    ...waveShared,
  };
}

function classicCeilingMaterial(
  settings: OceanCeilingSettings,
  sunDirection: { clone: () => unknown },
  skyShared: Record<string, { value: unknown }>,
  waveShared: Record<string, { value: unknown }>,
  maxComponents: number
): Material {
  return new ShaderMaterial({
    uniforms: ceilingUniformValues(settings, sunDirection as Color, skyShared, waveShared),
    side: DoubleSide,
    transparent: true,
    fog: false,
    vertexShader: ceilingVertexShaderGlsl(maxComponents),
    fragmentShader: ceilingFragmentShaderGlsl(),
  });
}

/**
 * The same sheet as a node graph.
 *
 * **IT SETS `vertexNode`, NOT `positionNode`, AND THAT IS THE FAITHFUL PORT.**
 * The GLSL builds a WORLD position, displaces it there, and projects it itself.
 * `positionNode` is local space, so reproducing this through it would mean
 * inverting the model matrix — correct only while that matrix stays a pure
 * translation, which is an assumption about the rig that this material has no
 * business making. `vertexNode` is the clip position, which is exactly what the
 * GLSL's last line computes.
 *
 * It also sidesteps the trap that cost the bubbles a frame: `positionNode`
 * reassigns `positionLocal` (`NodeMaterial.js:804`), so anything reading the
 * geometry after setting it reads the displaced value. `positionGeometry` is
 * read here and nothing reassigns it.
 */
function nodeCeilingMaterial(
  modules: NodeMaterialModules,
  settings: OceanCeilingSettings,
  skyNodes: SkyUniformNodes,
  waveNodes: WaveUniformNodes,
  maxComponents: number
): Material {
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
    smoothstep,
    sqrt,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
  } = modules.tsl;

  const material = new NodeMaterial();
  material.side = DoubleSide;
  material.transparent = true;
  material.fog = false;

  const waterColor = uniform(settings.waterColor.clone());
  const deepColor = uniform(settings.deepColor.clone());
  const sunColor = uniform(settings.sunColor.clone());
  const brightness = uniform(settings.brightness);
  const fogDensity = uniform(settings.fogDensityPerMetre);
  const skyGain = uniform(settings.skyGain);
  const waveDamping = uniform(settings.waveDamping);

  // ---- the vertex stage, in world space exactly as the GLSL has it --------
  const geometryWorld = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
  const surface = oceanSurfaceNode(modules, waveNodes, vec2(geometryWorld.x, geometryWorld.z), maxComponents);
  const displacedWorld = geometryWorld.add(surface.offset.mul(waveDamping));

  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(displacedWorld, 1));

  const worldPosition = varying(displacedWorld);
  const waveNormal = varying(normalize(mix(vec3(0, 1, 0), surface.normal, waveDamping)));

  // ---- the fragment stage -------------------------------------------------
  const viewDirection = normalize(worldPosition.sub(cameraPosition));
  const surfaceNormal = normalize(waveNormal);
  const tiltedNormal = normalize(mix(vec3(0, 1, 0), surfaceNormal, float(NORMAL_TILT_FRACTION)));
  const upness = abs(dot(viewDirection, tiltedNormal));
  const sinTheta = sqrt(max(float(0), float(1).sub(upness.mul(upness))));

  const windowOpenness = float(1).sub(
    smoothstep(float(TOTAL_INTERNAL_REFLECTION_START), float(TOTAL_INTERNAL_REFLECTION_END), sinTheta)
  );
  const acrossTheCone = clamp(sinTheta.div(float(CRITICAL_SINE_ROUNDED)), 0, 1);

  const sparkle = sunColor
    .mul(pow(max(float(0), surfaceNormal.y), float(SPARKLE_NORMAL_POWER)))
    .mul(float(SPARKLE_WEIGHT))
    .mul(float(1).sub(acrossTheCone));
  const throughTheWindow = skyThroughSnellsWindowNode(modules, skyNodes, viewDirection, sinTheta)
    .mul(skyGain)
    .add(sparkle);

  const mirrored = mix(deepColor, waterColor, pow(upness, float(MIRROR_UPNESS_POWER))).add(
    waterColor.mul(float(MIRROR_WATER_WEIGHT))
  );
  const fresnel = float(FRESNEL_NORMAL_INCIDENCE).add(
    float(FRESNEL_RANGE).mul(pow(float(1).sub(upness), float(FRESNEL_POWER)))
  );

  const windowed = mix(mirrored, throughTheWindow, windowOpenness);
  const tinted = mix(
    windowed,
    waterColor,
    fresnel.mul(float(1).sub(windowOpenness)).mul(float(FRESNEL_TINT_WEIGHT))
  );

  const viewDistance = length(worldPosition.sub(cameraPosition));
  const swallow = float(1).sub(
    exp(pow(viewDistance.mul(fogDensity), float(EXTINCTION_POWER)).negate())
  );

  material.colorNode = vec4(mix(tinted, waterColor, clamp(swallow, 0, 1)).mul(brightness), 1);
  return material;
}

/**
 * The water's underside, on whichever path the renderer is.
 *
 * `nodeModules` is null on the classic path, which is every visitor until the
 * WebGPU renderer is the default.
 */
export function oceanCeilingMaterial(
  settings: OceanCeilingSettings,
  sunDirection: { clone: () => unknown },
  skyShared: Record<string, { value: unknown }>,
  waveShared: Record<string, { value: unknown }>,
  skyNodes: SkyUniformNodes | null,
  waveNodes: WaveUniformNodes | null,
  maxComponents: number,
  nodeModules: NodeMaterialModules | null
): Material {
  if (nodeModules && skyNodes && waveNodes) {
    return nodeCeilingMaterial(nodeModules, settings, skyNodes, waveNodes, maxComponents);
  }
  return classicCeilingMaterial(settings, sunDirection, skyShared, waveShared, maxComponents);
}
