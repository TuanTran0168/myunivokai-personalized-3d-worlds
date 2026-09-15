import { BackSide, Color, ShaderMaterial, type Material } from "three";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import {
  PREETHAM_SKY_GLSL,
  SKY_UNIFORMS_GLSL,
  preethamSkyNode,
  type SkyUniformNodes,
} from "./oceanSky";

/**
 * THE DOME BEHIND EVERYTHING, IN BOTH SHADER LANGUAGES.
 *
 * §26 Phases 6-8, the ocean. The first consumer of the node sky in `oceanSky.ts`,
 * which until now had none — and the largest single area in the frame, because
 * it is whatever is left after every other layer has drawn.
 *
 * ONE MESH, TWO COMPLETELY DIFFERENT JOBS, decided by which side of the
 * waterline the viewer is on:
 *
 *   - Above, the backdrop IS the sky. It is Preetham with the solar disc, and
 *     the disc, the Mie forward-scatter lobe and the reddened horizon all fall
 *     out of the model rather than being three hand-tuned powers of a dot
 *     product.
 *   - Below, there is no sun in the backdrop at all — the surface layer owns it
 *     — and the dome is a three-stop vertical gradient swallowed by the medium.
 *
 * **THE GLSL BELOW IS MOVED, NOT REWRITTEN, AND THAT IS DELIBERATE.** Its local
 * names are `dir` and `c`, which this repo's style rule would have renamed. They
 * are left exactly as they were so that moving the shader out of `oceanRig.ts`
 * is PROVABLE: the test compares the rebuilt string against the shipped one
 * token for token, and a rename would have spent that proof on nothing a viewer
 * can see. The node twin is new code and spells its names out.
 */

/**
 * The threshold the GLSL branches on.
 *
 * `uSunGlow` is a float carrying a boolean — it is set to `above ? 1 : 0` once
 * at construction and never written again — so the branch is decided before the
 * shader exists. The node path resolves it in JavaScript for that reason, the
 * same way `preethamSkyNode` takes `withDisc` as a JavaScript boolean.
 */
const SUN_GLOW_THRESHOLD = 0.001;

/**
 * How fast the gradient climbs to the zenith colour and falls to the floor
 * colour. Both are above 1 so the horizon band stays wide: the horizon is where
 * a viewer spends their attention, and a linear ramp puts most of the frame in
 * transition instead.
 */
const UPWARD_GRADIENT_POWER = 1.5;
const DOWNWARD_GRADIENT_POWER = 1.4;

/**
 * The same law every other underwater layer is subject to — `1 - exp(-(d*k)^2)`.
 * The squared falloff is what makes the near field keep its colour while the far
 * field goes uniformly to the water's own.
 */
const MEDIUM_SWALLOW_POWER = 2;

/** How the GLSL spells a float, so a rebuilt string matches the shipped one. */
function glslFloat(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export type OceanBackdropSettings = {
  /** Graded by view direction so the horizon is EXACTLY the fog colour. */
  horizonColor: Color;
  upColor: Color;
  downColor: Color;
  /** What the far field falls toward. The water's own colour, below. */
  waterColor: Color;
  /** Zero above the surface, where there is nothing in the way. */
  fogDensityPerMetre: number;
  backdropRadiusMetres: number;
  /**
   * Above the waterline the backdrop is the sky and grows a solar disc; below
   * it there is no sun in it at all.
   */
  drawsSky: boolean;
};

export function backdropVertexShaderGlsl(): string {
  return /* glsl */ `varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`;
}

export function backdropFragmentShaderGlsl(): string {
  return /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uUp; uniform vec3 uDown;
      uniform float uSunGlow;
      uniform vec3 uWaterColor; uniform float uFogDensity; uniform float uBackdropRadius;
      ${SKY_UNIFORMS_GLSL}
      varying vec3 vW;
      ${PREETHAM_SKY_GLSL}
      void main(){
        vec3 dir = normalize(vW - cameraPosition);
        vec3 c;
        if (uSunGlow > ${glslFloat(SUN_GLOW_THRESHOLD, 3)}) {
          c = preethamSky(dir, true);
        } else {
          c = uHorizon;
          c = mix(c, uUp,   pow(clamp( dir.y, 0.0, 1.0), ${glslFloat(UPWARD_GRADIENT_POWER, 1)}));
          c = mix(c, uDown, pow(clamp(-dir.y, 0.0, 1.0), ${glslFloat(DOWNWARD_GRADIENT_POWER, 1)}));
          // The same law every other underwater layer is subject to: a
          // background falls toward the water colour by 1 - exp(-(d*k)^2).
          //
          // The dome did not have it, and it was the only thing in the scene
          // that did not. So a viewer at 24 m — where the sighting range is a
          // few metres and the far field is by definition uniform water — got
          // uUp painted straight on: a pale grey-olive dome filling half the
          // frame the moment the camera pitched toward the surface, measured at
          // 0.55 mean luma and 0.07 saturation where the same frame without the
          // dome measures 0.16 and 0.84. It reads as staring into the sun,
          // because a large pale shape overhead is what that looks like.
          //
          // This is the fault demos/ocean-depth-rig already recorded once, in
          // the other direction: the from-below SURFACE painting a dark ceiling
          // until it was fogged by the medium. Same rule, other layer.
          float swallow = 1.0 - exp(-pow(uBackdropRadius * uFogDensity, ${glslFloat(MEDIUM_SWALLOW_POWER, 1)}));
          c = mix(c, uWaterColor, clamp(swallow, 0.0, 1.0));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
}

/**
 * The uniform record, which is also what the classic material binds.
 *
 * Nothing in it is written after construction — there is no time, no camera and
 * no sea state in this dome — which is why the factory owns it rather than
 * handing it back for a frame loop to update.
 */
function backdropUniformValues(
  settings: OceanBackdropSettings,
  skyShared: Record<string, { value: unknown }>
): Record<string, { value: unknown }> {
  return {
    uHorizon: { value: settings.horizonColor.clone() },
    uUp: { value: settings.upColor.clone() },
    uDown: { value: settings.downColor.clone() },
    uWaterColor: { value: settings.waterColor.clone() },
    uFogDensity: { value: settings.fogDensityPerMetre },
    uBackdropRadius: { value: settings.backdropRadiusMetres },
    uSunGlow: { value: settings.drawsSky ? 1 : 0 },
    ...skyShared,
  };
}

function classicBackdropMaterial(
  settings: OceanBackdropSettings,
  skyShared: Record<string, { value: unknown }>
): Material {
  return new ShaderMaterial({
    uniforms: backdropUniformValues(settings, skyShared),
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: backdropVertexShaderGlsl(),
    fragmentShader: backdropFragmentShaderGlsl(),
  });
}

/**
 * The same dome as a node graph.
 *
 * **THE BRANCH IS RESOLVED IN JAVASCRIPT, WHICH IS THE PORT RATHER THAN A
 * SIMPLIFICATION.** `uSunGlow` never changes after construction in either
 * language; the difference is only that GLSL compiles both arms and picks at
 * run time, while a node graph has no preprocessor and builds the arm it was
 * asked for. Same pixels, one fewer branch.
 *
 * `positionWorld` is the node equivalent of the `vW` varying — `modelMatrix *
 * position`, interpolated — and is NOT affected by the trap that caught the
 * bubbles: this material sets no `positionNode`, so nothing reassigns it.
 */
function nodeBackdropMaterial(
  modules: NodeMaterialModules,
  settings: OceanBackdropSettings,
  skyNodes: SkyUniformNodes
): Material {
  const { NodeMaterial } = modules.webgpu;
  const { cameraPosition, clamp, exp, float, mix, normalize, positionWorld, pow, uniform, vec4 } = modules.tsl;

  const material = new NodeMaterial();
  material.side = BackSide;
  material.depthWrite = false;
  material.fog = false;

  const viewDirection = normalize(positionWorld.sub(cameraPosition));

  if (settings.drawsSky) {
    material.colorNode = vec4(preethamSkyNode(modules, skyNodes, viewDirection, true), 1);
    return material;
  }

  const horizonColor = uniform(settings.horizonColor.clone());
  const upColor = uniform(settings.upColor.clone());
  const downColor = uniform(settings.downColor.clone());
  const waterColor = uniform(settings.waterColor.clone());
  const fogDensity = uniform(settings.fogDensityPerMetre);
  const backdropRadius = uniform(settings.backdropRadiusMetres);

  const towardZenith = pow(clamp(viewDirection.y, 0, 1), float(UPWARD_GRADIENT_POWER));
  const towardFloor = pow(clamp(viewDirection.y.negate(), 0, 1), float(DOWNWARD_GRADIENT_POWER));
  const graded = mix(mix(horizonColor, upColor, towardZenith), downColor, towardFloor);

  const swallow = float(1).sub(exp(pow(backdropRadius.mul(fogDensity), float(MEDIUM_SWALLOW_POWER)).negate()));
  material.colorNode = vec4(mix(graded, waterColor, clamp(swallow, 0, 1)), 1);
  return material;
}

/**
 * The backdrop dome's material, on whichever path the renderer is.
 *
 * `nodeModules` is null on the classic path, which is every visitor until the
 * WebGPU renderer is the default.
 */
export function oceanBackdropMaterial(
  settings: OceanBackdropSettings,
  skyShared: Record<string, { value: unknown }>,
  skyNodes: SkyUniformNodes | null,
  nodeModules: NodeMaterialModules | null
): Material {
  if (nodeModules && skyNodes) {
    return nodeBackdropMaterial(nodeModules, settings, skyNodes);
  }
  return classicBackdropMaterial(settings, skyShared);
}
