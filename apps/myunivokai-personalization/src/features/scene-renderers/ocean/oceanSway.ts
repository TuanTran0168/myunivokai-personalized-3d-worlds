import { Vector2 } from "three";
import type { Node } from "three/webgpu";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * What makes the plants move, declared once so both shader languages bind the
 * same two values.
 *
 * Its own module rather than a corner of `oceanRigFlora.ts` because
 * `oceanBladeMaterial.ts` needs the types and the rig needs the material — the
 * two would import each other otherwise. The same split `oceanSky.ts` already
 * has between the uniforms and the shaders that read them.
 */

/**
 * The prevailing current, as a direction scaled by how strong it is.
 *
 * The 0.55 / 0.2 pair is a DIRECTION with a length, not two tuning knobs: it is
 * the current running mostly across the view and slightly into it, so a bed
 * leans in a direction the viewer can read rather than straight away from the
 * camera where the lean is invisible.
 */
const CURRENT_ACROSS_VIEW = 0.55;
const CURRENT_INTO_VIEW = 0.2;

export type SwayUniforms = {
  uSwayTime: { value: number };
  uCurrent: { value: Vector2 };
};

export function createSwayUniforms(currentStrength: number): SwayUniforms {
  return {
    uSwayTime: { value: 0 },
    uCurrent: { value: new Vector2(CURRENT_ACROSS_VIEW, CURRENT_INTO_VIEW).multiplyScalar(currentStrength) }
  };
}

/** The same two values as TSL nodes. */
export type SwayUniformNodes = {
  elapsedSeconds: Node<"float">;
  current: Node<"vec2">;
};

/**
 * The node twins, plus the one write the frame loop owes them.
 *
 * **THE CLOCK IS RETURNED AS A FUNCTION FOR THE REASON `waveUniformNodes` GIVES
 * AND THIS ONE MAKES WORSE.** A kelp bed whose time never advances is a
 * perfectly plausible still bed — on a screenshot it is indistinguishable from
 * a working one, and unlike the sea surface it has no horizon line to look
 * wrong. Putting the duty in the type is the only place it cannot be skipped
 * silently.
 *
 * **THE CURRENT IS THE SAME `Vector2` INSTANCE the classic uniform holds**, not
 * a copy. The rig scales it once at build time and never again, but the two
 * paths sharing the object is what makes "these two materials are given
 * different numbers" impossible rather than merely unlikely.
 */
export type SwayUniformNodeSet = {
  nodes: SwayUniformNodes;
  setElapsedSeconds: (seconds: number) => void;
};

export function swayUniformNodes(modules: NodeMaterialModules, sway: SwayUniforms): SwayUniformNodeSet {
  const { uniform } = modules.tsl;
  const elapsedSeconds = uniform(0);

  return {
    nodes: {
      elapsedSeconds: elapsedSeconds as unknown as Node<"float">,
      current: uniform(sway.uCurrent.value) as unknown as Node<"vec2">
    },
    setElapsedSeconds: (seconds: number) => {
      elapsedSeconds.value = seconds;
    }
  };
}
