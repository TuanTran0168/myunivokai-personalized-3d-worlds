import { Color, DoubleSide, MeshStandardMaterial } from "three";
import type { Node } from "three/webgpu";
import {
  applyClassicShaderPatch,
  requireShaderChunks,
  SHADER_CHUNK_MARKERS
} from "@/features/scene-renderers/shared/shaderChunkPatch";
import {
  addNodeMaterialChunkPatch,
  patchedStandardNodeMaterial
} from "@/features/scene-renderers/shared/nodeMaterialChunkPatch";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";
import type { SwayUniformNodes, SwayUniforms } from "./oceanSway";

/**
 * THE KELP AND SEAGRASS BLADE, IN BOTH SHADER LANGUAGES, FROM ONE SET OF
 * NUMBERS.
 *
 * §26 Phase 7, and the first of the ocean's eight patches to get a node arm.
 * It is the lowest-complexity of them, which is why it goes first: the shape it
 * establishes — constants declared once, both implementations built from them,
 * a test asserting the GLSL text still contains the numbers the node graph
 * uses — is the shape the other seven follow, exactly as
 * `forestFoliageMaterial.ts` established it for the forest.
 *
 * WHAT IT DOES. A blade is a 14-segment plane bent into a leaf, instanced a few
 * thousand times. Two things are added to what three draws:
 *
 *   - **A bend, in the vertex stage.** Quadratic in height, so the blade is
 *     anchored at its holdfast and free at its tip. A linear ramp makes the
 *     whole plant SLIDE rather than bend, which reads as the bed sliding across
 *     the seabed.
 *   - **A base-to-tip gradient and a per-plant tone, in the fragment stage.**
 *     Darkest at the ground, which is the contact shadow that stops vegetation
 *     floating, and brightest at the tip, where a translucent blade really does
 *     catch the light. The tone varies per instance so a bed is not one colour.
 *
 * **WHY THE NODE ARM IS A CHUNK PATCH AND NOT A `positionNode`.** This material
 * is drawn on an `InstancedMesh`, and `positionNode` is read AFTER three has
 * applied the instance matrix and then OVERWRITES it — every blade would
 * collapse onto the world origin. `shared/nodeMaterialChunkPatch.ts` carries the
 * full account and the line numbers; this file is the first caller of it.
 */

/**
 * The sway, as the classic GLSL spells it and the node graph rebuilds it.
 *
 * Two trains at different rates so the motion never repeats visibly: the
 * x term carries a height-dependent phase, which makes the bend travel UP the
 * blade rather than the whole blade swinging as a rigid line.
 */
const BLADE_SWAY_ACROSS_TIME_RATE = 1.15;
const BLADE_SWAY_ACROSS_HEIGHT_PHASE = 2.4;
const BLADE_SWAY_ACROSS_AMPLITUDE = 0.34;
const BLADE_SWAY_ALONG_TIME_RATE = 0.83;
const BLADE_SWAY_ALONG_PHASE_RATE = 1.7;
const BLADE_SWAY_ALONG_AMPLITUDE = 0.24;

/**
 * How much of the prevailing current a blade leans into, at its tip.
 *
 * Separate from the two oscillations because it is a steady lean rather than a
 * sway: it is what makes a bed read as standing in moving water rather than
 * waving in place.
 */
const BLADE_CURRENT_LEAN = 0.5;

/**
 * The per-plant tone, hashed from the instance's own sway phase.
 *
 * The hash constants are the standard `fract(sin(x * 12.9898) * 43758.5453)`
 * pair. They are reused rather than reinvented because the classic shader has
 * shipped with them and the port's whole claim is that the two paths compute
 * the SAME thing — a better hash here would be a look change wearing a port's
 * clothes.
 */
const BLADE_TONE_HASH_FREQUENCY = 12.9898;
const BLADE_TONE_HASH_SCALE = 43758.5453;
const BLADE_TONE_DARKEST = 0.72;
const BLADE_TONE_RANGE = 0.56;

/**
 * The base-to-tip gradient.
 *
 * The floor is well below one and the ceiling well above it: a blade's base is
 * in its own contact shadow and its tip is lit through, and a gradient that
 * only darkened would make a bed read as uniformly dimmer rather than as
 * vegetation standing on a floor.
 */
const BLADE_BASE_DARKENING = 0.16;
const BLADE_TIP_BRIGHTENING = 1.32;
const BLADE_GRADIENT_START = 0;
const BLADE_GRADIENT_END = 0.8;

/** The blade's surface, which is matte and not a mirror. */
const BLADE_ROUGHNESS = 0.92;
const BLADE_METALNESS = 0;

/** The height fraction is clamped, because a bent blade's geometry overshoots. */
const BLADE_HEIGHT_FRACTION_MINIMUM = 0;
const BLADE_HEIGHT_FRACTION_MAXIMUM = 1;

/** The per-instance attribute both paths read the plant's own phase from. */
export const BLADE_SWAY_PHASE_ATTRIBUTE = "aSwayPhase";

/**
 * The GLSL, built from the constants above.
 *
 * Exported so `oceanBladeMaterial.test.ts` can assert the shipped string still
 * contains the numbers the node graph is built from. A template literal rather
 * than a fixed string for the same reason: a tuned constant has to move both
 * implementations or neither.
 */
export function bladeSwayCommonVertexGlsl(): string {
  return [
    SHADER_CHUNK_MARKERS.common,
    "          uniform float uSwayTime; uniform vec2 uCurrent;",
    `          attribute float ${BLADE_SWAY_PHASE_ATTRIBUTE};`,
    "          varying float vHeightFraction; varying float vPlantTone;"
  ].join("\n");
}

export function bladeSwayBeginVertexGlsl(): string {
  return [
    SHADER_CHUNK_MARKERS.beginVertex,
    `          vHeightFraction = clamp(position.y, ${BLADE_HEIGHT_FRACTION_MINIMUM.toFixed(1)}, ${BLADE_HEIGHT_FRACTION_MAXIMUM.toFixed(1)});`,
    `          vPlantTone = ${BLADE_TONE_DARKEST} + ${BLADE_TONE_RANGE} * fract(sin(${BLADE_SWAY_PHASE_ATTRIBUTE} * ${BLADE_TONE_HASH_FREQUENCY}) * ${BLADE_TONE_HASH_SCALE});`,
    "          // Quadratic envelope: anchored at the base, free at the tip. A linear",
    "          // ramp makes the whole plant slide instead of bend.",
    "          float bend = vHeightFraction * vHeightFraction;",
    `          transformed.x += sin(uSwayTime * ${BLADE_SWAY_ACROSS_TIME_RATE} + ${BLADE_SWAY_PHASE_ATTRIBUTE} + vHeightFraction * ${BLADE_SWAY_ACROSS_HEIGHT_PHASE}) * bend * ${BLADE_SWAY_ACROSS_AMPLITUDE};`,
    `          transformed.z += cos(uSwayTime * ${BLADE_SWAY_ALONG_TIME_RATE} + ${BLADE_SWAY_PHASE_ATTRIBUTE} * ${BLADE_SWAY_ALONG_PHASE_RATE}) * bend * ${BLADE_SWAY_ALONG_AMPLITUDE};`,
    `          transformed.xz += uCurrent * bend * ${BLADE_CURRENT_LEAN};`
  ].join("\n");
}

export function bladeSwayCommonFragmentGlsl(): string {
  return `${SHADER_CHUNK_MARKERS.common}\nvarying float vHeightFraction;\nvarying float vPlantTone;`;
}

export function bladeSwayToneMappingFragmentGlsl(): string {
  return [
    `gl_FragColor.rgb *= mix(${BLADE_BASE_DARKENING}, ${BLADE_TIP_BRIGHTENING}, smoothstep(${BLADE_GRADIENT_START.toFixed(1)}, ${BLADE_GRADIENT_END}, vHeightFraction)) * vPlantTone;`,
    SHADER_CHUNK_MARKERS.toneMappingFragment
  ].join("\n");
}

function bladeMaterialParameters(color: string) {
  return {
    color: new Color(color),
    roughness: BLADE_ROUGHNESS,
    metalness: BLADE_METALNESS,
    side: DoubleSide
  };
}

/**
 * The classic path: a `MeshStandardMaterial` whose two chunks are replaced.
 *
 * This is what every visitor renders today and what `scene-parity.spec.ts`
 * measures the node variant against.
 */
function classicBladeMaterial(color: string, sway: SwayUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial(bladeMaterialParameters(color));
  applyClassicShaderPatch(material, "oceanRigFlora sway", (patched) => {
    Object.assign(patched.uniforms, sway);
    patched.vertexShader = requireShaderChunks(patched.vertexShader, "oceanRigFlora sway vertex", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.beginVertex
    ])
      .replace(SHADER_CHUNK_MARKERS.common, bladeSwayCommonVertexGlsl())
      .replace(SHADER_CHUNK_MARKERS.beginVertex, bladeSwayBeginVertexGlsl());
    patched.fragmentShader = requireShaderChunks(patched.fragmentShader, "oceanRigFlora sway fragment", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.toneMappingFragment
    ])
      .replace(SHADER_CHUNK_MARKERS.common, bladeSwayCommonFragmentGlsl())
      // Darkest at the ground — the contact shadow that stops vegetation
      // floating — brightest at the tip, where a translucent blade really does
      // catch the light.
      .replace(SHADER_CHUNK_MARKERS.toneMappingFragment, bladeSwayToneMappingFragmentGlsl());
  });
  return material;
}

/**
 * The node path: the same two injections, at the same two points.
 *
 * **`positionGeometry`, NOT `positionLocal`.** The GLSL reads `position`, which
 * is the raw attribute — the blade's own untransformed height, 0 at the
 * holdfast and 1 at the tip. `positionLocal` at the moment this offset is added
 * is that same value, but only because nothing else on this material writes to
 * it; naming the attribute says what the number means and survives a morph
 * target or a displacement map arriving later.
 *
 * **The two stage-crossing values are `varying()` rather than recomputed.** A
 * fragment stage cannot read a vertex attribute, and `aSwayPhase` is one — the
 * classic shader declares `varying float vHeightFraction; varying float
 * vPlantTone;` for exactly this reason, and these are the same two varyings
 * under the names the node builder gives them.
 */
function nodeBladeMaterial(color: string, swayNodes: SwayUniformNodes, modules: NodeMaterialModules): MeshStandardMaterial {
  const material = patchedStandardNodeMaterial(modules, bladeMaterialParameters(color));
  const { attribute, clamp, cos, float, fract, mix, positionGeometry, sin, smoothstep, varying, vec3 } = modules.tsl;

  const heightFraction = varying(
    clamp(positionGeometry.y, float(BLADE_HEIGHT_FRACTION_MINIMUM), float(BLADE_HEIGHT_FRACTION_MAXIMUM))
  );
  // TSL declares `attribute()` as returning a bare `AttributeNode`, which
  // carries no operator methods — the same cast every other port in this family
  // makes, for the same reason.
  const swayPhase = attribute(BLADE_SWAY_PHASE_ATTRIBUTE, "float") as unknown as Node<"float">;
  const plantTone = varying(
    float(BLADE_TONE_DARKEST).add(
      float(BLADE_TONE_RANGE).mul(fract(sin(swayPhase.mul(float(BLADE_TONE_HASH_FREQUENCY))).mul(float(BLADE_TONE_HASH_SCALE))))
    )
  );

  addNodeMaterialChunkPatch(material, {
    name: "oceanRigFlora sway",
    localPositionOffset: () => {
      const bend = heightFraction.mul(heightFraction);
      const across = sin(
        swayNodes.elapsedSeconds
          .mul(float(BLADE_SWAY_ACROSS_TIME_RATE))
          .add(swayPhase)
          .add(heightFraction.mul(float(BLADE_SWAY_ACROSS_HEIGHT_PHASE)))
      )
        .mul(bend)
        .mul(float(BLADE_SWAY_ACROSS_AMPLITUDE));
      const along = cos(
        swayNodes.elapsedSeconds
          .mul(float(BLADE_SWAY_ALONG_TIME_RATE))
          .add(swayPhase.mul(float(BLADE_SWAY_ALONG_PHASE_RATE)))
      )
        .mul(bend)
        .mul(float(BLADE_SWAY_ALONG_AMPLITUDE));
      const lean = swayNodes.current.mul(bend).mul(float(BLADE_CURRENT_LEAN));
      return vec3(across.add(lean.x), float(0), along.add(lean.y));
    },
    litColorAdjustment: (litColor) => {
      const gradient = mix(
        float(BLADE_BASE_DARKENING),
        float(BLADE_TIP_BRIGHTENING),
        smoothstep(float(BLADE_GRADIENT_START), float(BLADE_GRADIENT_END), heightFraction)
      );
      return litColor.mul(gradient).mul(plantTone);
    }
  });

  return material;
}

/**
 * The swaying blade material for whichever renderer is drawing.
 *
 * `nodeModules` is null on the classic path, which is every visitor today. Both
 * arms take the same `color`, and the node arm takes the node twins of the same
 * two uniforms the classic arm binds, so the two cannot be given different
 * numbers without the call site doing it on purpose.
 */
export function oceanBladeMaterial(
  color: string,
  sway: SwayUniforms,
  swayNodes: SwayUniformNodes | null,
  nodeModules: NodeMaterialModules | null
): MeshStandardMaterial {
  if (nodeModules && swayNodes) return nodeBladeMaterial(color, swayNodes, nodeModules);
  return classicBladeMaterial(color, sway);
}

