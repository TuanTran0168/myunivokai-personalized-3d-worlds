import { Color, DoubleSide, type MeshStandardMaterial } from "three";
import type { Node } from "three/webgpu";
import {
  applyClassicShaderPatch,
  requireShaderChunks,
  SHADER_CHUNK_MARKERS
} from "@/features/scene-renderers/shared/shaderChunkPatch";
import {
  addNodeMaterialChunkPatch,
  standardMaterialForRenderer
} from "@/features/scene-renderers/shared/nodeMaterialChunkPatch";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * A SWIMMING ANIMAL'S BODY, IN BOTH SHADER LANGUAGES.
 *
 * §26 Phase 7, the last and largest of the ocean's patch ports. It is one patch
 * in the count and three shaders in practice: the undulation has three body
 * plans, chosen per species before the shader exists.
 *
 *   - **Anguilliform** — most fish. A travelling wave down the body, offset
 *     across the x axis.
 *   - **Vertical** — cetaceans. The same wave, offset up and down, because
 *     their flukes are horizontal.
 *   - **Mobuliform** — rays. The wave runs across the SPAN and grows toward the
 *     wingtip, and the body axis holds still. A ray that undulated like a fish
 *     is the single most obvious wrong animal in the scene.
 *
 * On the classic path that choice is a JavaScript ternary that picks a GLSL
 * snippet; on the node path it is a JavaScript branch that picks a node
 * expression. Neither compiles the other two, which is the same property the
 * sky's `withDisc` has and for the same reason — a node graph has no
 * preprocessor and simply builds what it was asked for.
 *
 * **WHAT DOES NOT GET PORTED, AND IT IS NOT AN OVERSIGHT.** The classic shader
 * declares `varying float vAlong`, assigns it in the vertex stage, and no
 * fragment ever reads it. It is dead, exactly as `uSunDirection` is dead on the
 * water's underside. Deleting it is a cleanup, reviving it is a look change, and
 * a port is the wrong moment for either — so the GLSL keeps it verbatim and the
 * node graph, which has no varyings to declare, simply never grows one. A test
 * pins the fact so the next reader finds it stated.
 */

/** Tail beat and body wave are both measured in turns, not radians. */
const FULL_TURN_RADIANS = 6.2831853;

/**
 * The rigid fraction of the body can reach 1, and the envelope divides by what
 * is left of it. This is the floor that stops that division exploding.
 */
const UNDULATION_SPAN_FLOOR = 1e-4;

/**
 * How sharply a ray's flap grows toward the wingtip.
 *
 * Above linear, so the wing root stays nearly still and the tip carries the
 * motion — which is what a manta actually does and what makes it read as flying
 * rather than as flapping a rigid sheet.
 */
const MOBULIFORM_TIP_POWER = 1.7;
const MOBULIFORM_SPAN_MINIMUM = 0;
const MOBULIFORM_SPAN_MAXIMUM = 1;

/**
 * Counter-shading: dark back, bright belly.
 *
 * It is why a school reads as a flicker of light rather than as a cloud of
 * identical objects, and it is the one thing on this material that is lighting
 * rather than motion. The half-width is small because the transition on a real
 * fish is a line, not a gradient across the whole body.
 */
const COUNTERSHADE_BELLY_BRIGHTENING = 1.7;
const COUNTERSHADE_BACK_DARKENING = 0.72;
const COUNTERSHADE_BLEND_HALF_WIDTH = 0.16;

/** The species defaults, for a fauna entry that does not state them. */
const DEFAULT_FISH_ROUGHNESS = 0.44;
const DEFAULT_FISH_METALNESS = 0.3;
const DEFAULT_MOBULIFORM_SPAN = 0.5;
const FISH_EMISSIVE_COLOR = "#000000";
const FISH_EMISSIVE_INTENSITY = 0;

/** The two per-vertex attributes both paths read the body's shape from. */
export const FISH_ALONG_BODY_ATTRIBUTE = "along";
export const FISH_PHASE_ATTRIBUTE = "aPhase";

/**
 * The travelling wave, shared by both body plans that use it.
 *
 * Exported because `oceanRigFauna.ts` injects it into the classic shader and
 * `oceanFishMaterial.test.ts` asserts the node graph was built from the same
 * numbers.
 */
export const GLSL_UNDULATION = /* glsl */ `
  float bodyLateralOffset(float alongBody, float onset, float waves,
                          float amplitude, float beatHertz, float elapsed, float phase) {
    float span = max(1e-4, 1.0 - onset);
    float envelope = max(0.0, (alongBody - onset) / span);
    float p = beatHertz * elapsed * 6.2831853 - alongBody * waves * 6.2831853 + phase;
    return envelope * envelope * amplitude * sin(p);
  }
`;

export type FishSwimStyle = {
  /** Fraction of the body that stays rigid. 0.88 is a swordfish, 0.55 an eel. */
  onset: number;
  amplitude: number;
  waves: number;
  /** Tail beats per second. */
  beat: number;
  /** Cetaceans oscillate vertically: their flukes are horizontal. */
  vertical?: boolean;
  /** Rays fly. The wave runs across the SPAN and the body axis holds still. */
  mobuliform?: boolean;
  /** Half the wingspan in body lengths, for the mobuliform envelope. */
  span?: number;
};

export type FishMaterialOptions = {
  color: string;
  roughness?: number;
  metalness?: number;
  swim: FishSwimStyle;
  /** Shared across every school so the whole scene beats on one clock. */
  creatureTime: { value: number };
  /** Written once, when a species adopts its GLB. */
  bellyUniform: { value: number };
  spanUniform: { value: number };
  nodeModules: NodeMaterialModules | null;
};

/**
 * The material, and the one write the frame loop owes its node twin.
 *
 * `synchronise` is a no-op on the classic path. On the node path it is the
 * whole animation: three of this material's uniforms are written after it is
 * built — the clock every frame, the belly scale and the wing span when a
 * species adopts its model — and a node uniform initialised from the same
 * number at build time would hold the placeholder forever. A school that never
 * advanced its clock is not a blank frame; it is a school of rigid fish, which
 * on a screenshot is a school.
 */
export type FishMaterialSet = {
  material: MeshStandardMaterial;
  synchronise: () => void;
};

/** The body-plan-specific half of the vertex patch, as the classic path spells it. */
export function fishAxisGlsl(swim: FishSwimStyle): string {
  if (swim.mobuliform) {
    return `// The wave runs across the SPAN and grows toward the wingtip.
         float span = clamp(abs(position.x) / uSpan, 0.0, 1.0);
         float flap = sin(uCreatureTime * uBeat * 6.2831853 + aPhase - span * uWaves * 6.2831853);
         transformed.y += flap * pow(span, 1.7) * uAmplitude;`;
  }
  if (swim.vertical) {
    return "transformed.y += lateral;   // a cetacean oscillates VERTICALLY";
  }
  return "transformed.x += lateral;";
}

function fishMaterialParameters(options: FishMaterialOptions) {
  return {
    color: new Color(options.color),
    roughness: options.roughness ?? DEFAULT_FISH_ROUGHNESS,
    metalness: options.metalness ?? DEFAULT_FISH_METALNESS,
    side: DoubleSide,
    emissive: new Color(FISH_EMISSIVE_COLOR),
    emissiveIntensity: FISH_EMISSIVE_INTENSITY
  };
}

/**
 * The classic path, with the GLSL kept exactly as it shipped.
 *
 * The uniform record is assembled here rather than in the rig so both arms of
 * this factory read one list — the classic one binds it to the shader, the node
 * one builds twins of the three entries that move.
 */
function classicFishMaterial(options: FishMaterialOptions): FishMaterialSet {
  const material = standardMaterialForRenderer(null, fishMaterialParameters(options));
  const axis = fishAxisGlsl(options.swim);

  applyClassicShaderPatch(material, "oceanRigFauna undulation", (shader) => {
    shader.uniforms.uCreatureTime = options.creatureTime;
    shader.uniforms.uOnset = { value: options.swim.onset };
    shader.uniforms.uAmplitude = { value: options.swim.amplitude };
    shader.uniforms.uWaves = { value: options.swim.waves };
    shader.uniforms.uBeat = { value: options.swim.beat };
    shader.uniforms.uSpan = options.spanUniform;
    shader.uniforms.uBellyScale = options.bellyUniform;

    shader.vertexShader = requireShaderChunks(shader.vertexShader, "oceanRigFauna undulation vertex", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.beginVertex
    ])
      .replace(
        SHADER_CHUNK_MARKERS.common,
        `#include <common>
          uniform float uCreatureTime; uniform float uOnset; uniform float uAmplitude;
          uniform float uWaves; uniform float uBeat; uniform float uSpan;
          uniform float uBellyScale;
          attribute float along; attribute float aPhase;
          varying float vBelly; varying float vAlong;
          ${GLSL_UNDULATION}`
      )
      .replace(
        SHADER_CHUNK_MARKERS.beginVertex,
        `#include <begin_vertex>
          vBelly = position.y * uBellyScale;
          vAlong = along;
          float lateral = bodyLateralOffset(along, uOnset, uWaves, uAmplitude, uBeat, uCreatureTime, aPhase);
          ${axis}`
      );

    shader.fragmentShader = requireShaderChunks(shader.fragmentShader, "oceanRigFauna undulation fragment", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.toneMappingFragment
    ])
      .replace(SHADER_CHUNK_MARKERS.common, "#include <common>\nvarying float vBelly;\nvarying float vAlong;")
      // Counter-shading: dark back, bright belly. It is why a school reads as a
      // flicker of light rather than a cloud of identical objects.
      .replace(
        SHADER_CHUNK_MARKERS.toneMappingFragment,
        "gl_FragColor.rgb *= mix(1.7, 0.72, smoothstep(-0.16, 0.16, vBelly));\n#include <tonemapping_fragment>"
      );
  });

  return { material, synchronise: () => {} };
}

/**
 * The node path: the same offset and the same counter-shading, as a graph.
 *
 * **FOUR OF THE SEVEN UNIFORMS ARE NOT UNIFORMS HERE.** `uOnset`, `uAmplitude`,
 * `uWaves` and `uBeat` are per-species constants that nothing ever writes, so
 * the node graph folds them in as literals. That is not a shortcut: a uniform
 * exists to carry a value that changes, and three of these seven do — the
 * clock, the belly scale and the wing span — which is exactly the three
 * `synchronise` copies.
 */
function nodeFishMaterial(options: FishMaterialOptions, modules: NodeMaterialModules): FishMaterialSet {
  const material = standardMaterialForRenderer(modules, fishMaterialParameters(options));
  const { abs, attribute, clamp, float, max, mix, pow, positionGeometry, sin, smoothstep, uniform, varying, vec3 } =
    modules.tsl;

  const elapsedSeconds = uniform(options.creatureTime.value);
  const bellyScale = uniform(options.bellyUniform.value);
  const wingSpan = uniform(options.spanUniform.value);

  // TSL declares `attribute()` as returning a bare `AttributeNode`, which
  // carries no operator methods — the same cast every port in this family makes.
  const alongBody = attribute(FISH_ALONG_BODY_ATTRIBUTE, "float") as unknown as Node<"float">;
  const bodyPhase = attribute(FISH_PHASE_ATTRIBUTE, "float") as unknown as Node<"float">;
  const belly = varying(positionGeometry.y.mul(bellyScale));

  const { onset, amplitude, waves, beat } = options.swim;

  /** `bodyLateralOffset`, with its four constant arguments already resolved. */
  function bodyLateralOffset(): Node<"float"> {
    const rigidSpan = Math.max(UNDULATION_SPAN_FLOOR, 1 - onset);
    const envelope = max(float(0), alongBody.sub(onset).div(rigidSpan));
    const phase = elapsedSeconds
      .mul(beat * FULL_TURN_RADIANS)
      .sub(alongBody.mul(waves * FULL_TURN_RADIANS))
      .add(bodyPhase);
    return envelope.mul(envelope).mul(amplitude).mul(sin(phase)) as unknown as Node<"float">;
  }

  function mobuliformOffset(): Node<"vec3"> {
    const spanFraction = clamp(
      abs(positionGeometry.x).div(wingSpan),
      float(MOBULIFORM_SPAN_MINIMUM),
      float(MOBULIFORM_SPAN_MAXIMUM)
    );
    const flap = sin(
      elapsedSeconds
        .mul(beat * FULL_TURN_RADIANS)
        .add(bodyPhase)
        .sub(spanFraction.mul(waves * FULL_TURN_RADIANS))
    );
    return vec3(
      float(0),
      flap.mul(pow(spanFraction, float(MOBULIFORM_TIP_POWER))).mul(amplitude),
      float(0)
    ) as unknown as Node<"vec3">;
  }

  addNodeMaterialChunkPatch(material, {
    name: "oceanRigFauna undulation",
    localPositionOffset: () => {
      if (options.swim.mobuliform) return mobuliformOffset();
      const lateral = bodyLateralOffset();
      if (options.swim.vertical) return vec3(float(0), lateral, float(0)) as unknown as Node<"vec3">;
      return vec3(lateral, float(0), float(0)) as unknown as Node<"vec3">;
    },
    litColorAdjustment: (litColor) =>
      litColor.mul(
        mix(
          float(COUNTERSHADE_BELLY_BRIGHTENING),
          float(COUNTERSHADE_BACK_DARKENING),
          smoothstep(float(-COUNTERSHADE_BLEND_HALF_WIDTH), float(COUNTERSHADE_BLEND_HALF_WIDTH), belly)
        )
      ) as unknown as Node<"vec3">
  });

  return {
    material,
    synchronise: () => {
      elapsedSeconds.value = options.creatureTime.value;
      bellyScale.value = options.bellyUniform.value;
      wingSpan.value = options.spanUniform.value;
    }
  };
}

/** The swimming body for whichever renderer is drawing. */
export function oceanFishMaterial(options: FishMaterialOptions): FishMaterialSet {
  const resolved: FishMaterialOptions = {
    ...options,
    swim: { ...options.swim, span: options.swim.span ?? DEFAULT_MOBULIFORM_SPAN }
  };
  return options.nodeModules ? nodeFishMaterial(resolved, options.nodeModules) : classicFishMaterial(resolved);
}
