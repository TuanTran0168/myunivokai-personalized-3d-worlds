import { DoubleSide } from "three";
import { describe, expect, it } from "vitest";
import {
  bladeSwayBeginVertexGlsl,
  bladeSwayCommonFragmentGlsl,
  bladeSwayCommonVertexGlsl,
  bladeSwayToneMappingFragmentGlsl,
  oceanBladeMaterial
} from "./oceanBladeMaterial";
import { createSwayUniforms, swayUniformNodes } from "./oceanSway";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE KELP BLADE'S TWO IMPLEMENTATIONS MUST NOT DRIFT, AND THIS ONE HAS A
 * FAILURE MODE THE PREVIOUS PORTS DID NOT.
 *
 * A refused `ShaderMaterial` at least prints a refusal and drops the draw. A
 * patch that never reaches the node path prints NOTHING: `onBeforeCompile` is
 * assigned, the property sits there, three never reads it, and the bed renders
 * as three thousand rigid blades of one flat colour. That frame still looks
 * like a frame, and no count anywhere moves.
 *
 * So this file checks three separate things, because no one of them catches the
 * others: that the GLSL carries only numbers the module declares, that the node
 * arm actually produced a patch rather than a bare material, and that the node
 * arm did NOT reach for `positionNode` — which would compile, run, and collapse
 * every instance onto the world origin.
 */

const CURRENT_STRENGTH = 0.8;
const BLADE_COLOR = "#4E9463";

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

describe("ocean blade material", () => {
  /**
   * EVERY NUMBER IN THE GLSL HAS TO BE ONE THE MODULE DECLARES.
   *
   * Comparing against a fixed string would be the same literal typed twice.
   * This extracts every numeric literal from all four shader fragments and
   * requires each to be a declared value, so tuning a constant moves the shader
   * and typing a number into the shader fails here.
   */
  it("contains no numeric literal that is not one of the declared constants", () => {
    const declaredValues = new Set([
      0, 1, 0.72, 0.56, 12.9898, 43758.5453, 1.15, 2.4, 0.34, 0.83, 1.7, 0.24, 0.5, 0.16, 1.32, 0.8
    ]);
    const shaderText = [
      bladeSwayCommonVertexGlsl(),
      bladeSwayBeginVertexGlsl(),
      bladeSwayCommonFragmentGlsl(),
      bladeSwayToneMappingFragmentGlsl()
    ].join("\n");
    // The lookbehind excludes digits that are part of an IDENTIFIER — `vec2`,
    // `vec3` — which are GLSL's type names rather than values.
    const numericLiterals = (shaderText.match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(Number);

    expect(numericLiterals.length, "the shader should still carry its seventeen numbers").toBe(17);
    for (const literal of numericLiterals) {
      expect(declaredValues.has(literal), `${literal} is in the shader but is not a declared constant`).toBe(true);
    }
  });

  /**
   * The bend is quadratic in height and the gradient runs base to tip.
   *
   * Both are the shape of the effect rather than its tuning, and both were
   * arrived at by looking: a linear bend makes the whole plant slide, and a
   * gradient that only darkens makes a bed read as dimmer rather than as
   * vegetation.
   */
  it("bends quadratically and grades from base to tip", () => {
    const vertex = bladeSwayBeginVertexGlsl();
    expect(vertex).toContain("float bend = vHeightFraction * vHeightFraction;");
    expect(vertex).toContain("transformed.x +=");
    expect(vertex).toContain("transformed.z +=");
    expect(vertex).toContain("transformed.xz += uCurrent");
    expect(bladeSwayToneMappingFragmentGlsl()).toContain("gl_FragColor.rgb *= mix(");
  });

  it("builds the classic material with the patch and the blade's render state", () => {
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const material = oceanBladeMaterial(BLADE_COLOR, sway, null, null);

    expect(typeof material.onBeforeCompile).toBe("function");
    expect(material.side).toBe(DoubleSide);
    expect(material.metalness).toBe(0);
    expect(material.roughness).toBe(0.92);
  });

  /**
   * The classic patch goes through `requireShaderChunks`, so a chunk three
   * renames becomes a LOUD no-op. Exercised with a shader that carries both
   * markers, because the failure guarded against is that one day it does not.
   */
  it("applies the classic patch to a shader that carries the markers", () => {
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const material = oceanBladeMaterial(BLADE_COLOR, sway, null, null);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <tonemapping_fragment>\n}"
    };

    material.onBeforeCompile(shader as never, null as never);

    expect(shader.vertexShader).toContain("float bend = vHeightFraction");
    expect(shader.fragmentShader).toContain("gl_FragColor.rgb *= mix(");
    expect(shader.uniforms.uSwayTime, "the classic patch binds the sway clock").toBe(sway.uSwayTime);
    expect(shader.uniforms.uCurrent).toBe(sway.uCurrent);
  });

  /**
   * THE NODE ARM MUST PRODUCE A PATCH, NOT JUST A MATERIAL.
   *
   * This is the assertion that catches the failure this whole phase is about. A
   * node material with an empty patch list renders perfectly — unbent, ungraded
   * and silent — and nothing else in this repository would notice.
   */
  it("builds the node material with both injections registered", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);
    const material = oceanBladeMaterial(BLADE_COLOR, sway, swayNodeSet.nodes, modules);
    const patchable = material as unknown as {
      isNodeMaterial?: boolean;
      chunkPatches?: { name: string; localPositionOffset?: () => unknown; litColorAdjustment?: unknown }[];
    };

    expect(patchable.isNodeMaterial, "the node path must not fall back to the classic material").toBe(true);
    expect(patchable.chunkPatches, "the sway must be registered as a chunk patch").toHaveLength(1);
    expect(patchable.chunkPatches?.[0].name).toBe("oceanRigFlora sway");
    expect(typeof patchable.chunkPatches?.[0].localPositionOffset).toBe("function");
    expect(typeof patchable.chunkPatches?.[0].litColorAdjustment).toBe("function");
  });

  /**
   * AND IT MUST NOT USE `positionNode`.
   *
   * `NodeMaterial.setupPosition` applies the instance matrix and THEN reads
   * `positionNode`, which assigns over `positionLocal` — so a blade bed ported
   * that way loses every instance transform and stacks three thousand blades on
   * the world origin. three's default is `null` rather than undefined, which is
   * why this asserts null.
   */
  it("leaves positionNode alone, because it would discard the instance matrix", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);
    const material = oceanBladeMaterial(BLADE_COLOR, sway, swayNodeSet.nodes, modules);

    expect((material as unknown as { positionNode: unknown }).positionNode).toBeNull();
    expect((material as unknown as { outputNode: unknown }).outputNode).toBeNull();
  });

  /** The two hooks build real nodes rather than throwing when three calls them. */
  it("produces nodes from both injections", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);
    const material = oceanBladeMaterial(BLADE_COLOR, sway, swayNodeSet.nodes, modules);
    const patch = (material as unknown as {
      chunkPatches: {
        localPositionOffset: () => { isNode?: boolean };
        litColorAdjustment: (color: unknown) => { isNode?: boolean };
      }[];
    }).chunkPatches[0];

    expect(patch.localPositionOffset().isNode).toBe(true);
    expect(patch.litColorAdjustment(modules.tsl.vec3(1, 1, 1) as never).isNode).toBe(true);
  });

  /**
   * The node clock has to be reachable, because a frozen bed is a plausible bed.
   *
   * Same hazard `waveUniformNodes` carries and the same treatment: the write is
   * handed back as a function, and this asserts the function reaches the uniform
   * rather than that somebody remembered to call it.
   */
  it("advances the node sway clock through the returned setter", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);

    expect((swayNodeSet.nodes.elapsedSeconds as unknown as { value: number }).value).toBe(0);
    swayNodeSet.setElapsedSeconds(6);
    expect((swayNodeSet.nodes.elapsedSeconds as unknown as { value: number }).value).toBe(6);
  });

  /**
   * The current is the SAME `Vector2` the classic uniform holds, not a copy.
   *
   * Two paths given two objects is how a tuned value moves on one renderer and
   * not the other — the drift this whole family of tests exists to make
   * impossible rather than merely unlikely.
   */
  it("binds the classic current vector into the node uniform", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);

    expect((swayNodeSet.nodes.current as unknown as { value: unknown }).value).toBe(sway.uCurrent.value);
  });

  /**
   * Both arms must agree on the render state, which is the half a colour
   * comparison cannot see. A `DoubleSide` blade that became `FrontSide` would
   * disappear from one side at every angle.
   */
  it("gives both paths the same render state", async () => {
    const modules = await nodeMaterialModules();
    const sway = createSwayUniforms(CURRENT_STRENGTH);
    const swayNodeSet = swayUniformNodes(modules, sway);
    const classic = oceanBladeMaterial(BLADE_COLOR, sway, null, null);
    const node = oceanBladeMaterial(BLADE_COLOR, sway, swayNodeSet.nodes, modules);

    expect(node.side).toBe(classic.side);
    expect(node.transparent).toBe(classic.transparent);
    expect(node.depthWrite).toBe(classic.depthWrite);
    expect(node.roughness).toBe(classic.roughness);
    expect(node.metalness).toBe(classic.metalness);
    expect(node.color.getHexString()).toBe(classic.color.getHexString());
  });
});
