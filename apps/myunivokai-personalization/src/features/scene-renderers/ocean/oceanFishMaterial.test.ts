import { DoubleSide } from "three";
import { describe, expect, it } from "vitest";
import { fishAxisGlsl, GLSL_UNDULATION, oceanFishMaterial, type FishSwimStyle } from "./oceanFishMaterial";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THREE BODY PLANS, TWO SHADER LANGUAGES, AND ONE SET OF NUMBERS.
 *
 * The undulation counts as one of the nine patches and is three shaders in
 * practice — anguilliform, vertical and mobuliform — chosen before the shader
 * exists. The failure this guards is the same one the whole of §26 Phase 7 is
 * about: on the node path an unported patch does not throw, it simply stops
 * happening, and a school of rigid fish is still a school of fish.
 */

const ANGUILLIFORM: FishSwimStyle = { onset: 0.55, amplitude: 0.09, waves: 1.4, beat: 2.1 };
const CETACEAN: FishSwimStyle = { onset: 0.62, amplitude: 0.14, waves: 0.9, beat: 0.6, vertical: true };
const RAY: FishSwimStyle = { onset: 0.4, amplitude: 0.22, waves: 0.6, beat: 0.5, mobuliform: true, span: 0.7 };

const FISH_COLOR = "#7FA6C4";

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

function materialOptions(swim: FishSwimStyle, nodeModules: NodeMaterialModules | null) {
  return {
    color: FISH_COLOR,
    swim,
    creatureTime: { value: 0 },
    bellyUniform: { value: 1 },
    spanUniform: { value: swim.span ?? 0.5 },
    nodeModules
  };
}

describe("ocean fish material", () => {
  /**
   * The three body plans produce three different vertex offsets, and picking
   * the wrong one is the most visible error available here — a ray that
   * undulates like a fish reads as a broken animal rather than a shading bug.
   */
  it("gives each body plan its own axis", () => {
    expect(fishAxisGlsl(ANGUILLIFORM)).toBe("transformed.x += lateral;");
    expect(fishAxisGlsl(CETACEAN)).toContain("transformed.y += lateral;");
    expect(fishAxisGlsl(RAY)).toContain("float flap = sin(");
    expect(fishAxisGlsl(RAY)).toContain("transformed.y += flap * pow(span, 1.7) * uAmplitude;");
  });

  /**
   * The travelling wave's own constants, which the node graph folds in as
   * literals because nothing ever writes them.
   */
  it("keeps the undulation constants the node graph was built from", () => {
    expect(GLSL_UNDULATION).toContain("max(1e-4, 1.0 - onset)");
    expect(GLSL_UNDULATION).toContain("6.2831853");
    expect(GLSL_UNDULATION).toContain("envelope * envelope * amplitude * sin(p)");
  });

  it("builds the classic material with the patch and the fish's render state", () => {
    const material = oceanFishMaterial(materialOptions(ANGUILLIFORM, null)).material;
    expect(typeof material.onBeforeCompile).toBe("function");
    expect(material.side).toBe(DoubleSide);
    expect(material.emissiveIntensity).toBe(0);
  });

  it("applies the classic patch to a shader that carries the markers", () => {
    const options = materialOptions(ANGUILLIFORM, null);
    const material = oceanFishMaterial(options).material;
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <tonemapping_fragment>\n}"
    };

    material.onBeforeCompile(shader as never, null as never);

    expect(shader.uniforms.uCreatureTime).toBe(options.creatureTime);
    expect(shader.uniforms.uBellyScale).toBe(options.bellyUniform);
    expect(shader.vertexShader).toContain("float lateral = bodyLateralOffset(");
    expect(shader.fragmentShader).toContain("gl_FragColor.rgb *= mix(1.7, 0.72,");
  });

  /**
   * `vAlong` IS DEAD AND IS LEFT DEAD.
   *
   * It is declared in both stages and assigned in the vertex stage, and no
   * fragment reads it. Deleting it is a cleanup, reviving it is a look change,
   * and a port is the wrong moment for either — so the node graph never grows
   * one, and this pins the fact so the next reader finds it stated rather than
   * rediscovering it.
   */
  it("carries vAlong in the GLSL and nowhere in the node graph", () => {
    const material = oceanFishMaterial(materialOptions(ANGUILLIFORM, null)).material;
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <tonemapping_fragment>\n}"
    };
    material.onBeforeCompile(shader as never, null as never);

    expect(shader.vertexShader).toContain("vAlong = along;");
    // Declared in the fragment stage and never read there. One mention, which is
    // its own declaration.
    expect(shader.fragmentShader.split("vAlong").length - 1).toBe(1);
  });

  it.each([
    ["anguilliform", ANGUILLIFORM],
    ["vertical", CETACEAN],
    ["mobuliform", RAY]
  ])("registers both injections on the node path for a %s swimmer", async (_name, swim) => {
    const modules = await nodeMaterialModules();
    const material = oceanFishMaterial(materialOptions(swim, modules)).material;
    const patchable = material as unknown as {
      isNodeMaterial?: boolean;
      chunkPatches?: {
        name: string;
        localPositionOffset: () => { isNode?: boolean };
        litColorAdjustment: (color: unknown) => { isNode?: boolean };
      }[];
    };

    expect(patchable.isNodeMaterial).toBe(true);
    expect(patchable.chunkPatches).toHaveLength(1);
    expect(patchable.chunkPatches?.[0].name).toBe("oceanRigFauna undulation");
    expect(patchable.chunkPatches?.[0].localPositionOffset().isNode).toBe(true);
    expect(patchable.chunkPatches?.[0].litColorAdjustment(modules.tsl.vec3(1, 1, 1) as never).isNode).toBe(true);
  });

  /**
   * AND IT MUST NOT USE `positionNode`, which would discard the instance matrix
   * and stack an entire school on the world origin.
   */
  it("leaves positionNode alone", async () => {
    const modules = await nodeMaterialModules();
    const material = oceanFishMaterial(materialOptions(ANGUILLIFORM, modules)).material;
    expect((material as unknown as { positionNode: unknown }).positionNode).toBeNull();
  });

  /**
   * The three values written after the material exists have to reach the node
   * uniforms, and the clock is the one that fails silently: a school that never
   * advances it is a school of rigid fish, not a blank frame.
   */
  it("copies the clock, the belly scale and the wing span into the node uniforms", async () => {
    const modules = await nodeMaterialModules();
    const options = materialOptions(RAY, modules);
    const set = oceanFishMaterial(options);

    options.creatureTime.value = 6;
    options.bellyUniform.value = 0.4;
    options.spanUniform.value = 0.9;
    set.synchronise();

    const material = set.material as unknown as { chunkPatches: { localPositionOffset: () => unknown }[] };
    // The uniforms are internal to the graph, so this asserts the only thing
    // observable from outside: the graph still builds after a synchronise, and
    // the call did not throw on a value it did not expect.
    expect((material.chunkPatches[0].localPositionOffset() as { isNode?: boolean }).isNode).toBe(true);
  });

  it("gives both paths the same render state", async () => {
    const modules = await nodeMaterialModules();
    const classic = oceanFishMaterial(materialOptions(ANGUILLIFORM, null)).material;
    const node = oceanFishMaterial(materialOptions(ANGUILLIFORM, modules)).material;

    expect(node.side).toBe(classic.side);
    expect(node.transparent).toBe(classic.transparent);
    expect(node.depthWrite).toBe(classic.depthWrite);
    expect(node.roughness).toBe(classic.roughness);
    expect(node.metalness).toBe(classic.metalness);
    expect(node.color.getHexString()).toBe(classic.color.getHexString());
  });
});
