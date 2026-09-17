import { Color, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { applyCaustics, createCausticsUniforms } from "./oceanCaustics";
import { patchedStandardNodeMaterial } from "@/features/scene-renderers/shared/nodeMaterialChunkPatch";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE CAUSTICS EXIST TWICE AND THE NUMBERS MUST NOT DRIFT.
 *
 * Unlike every other port in this migration, the GLSL here is NOT generated
 * from the constants — it is the string that shipped, left byte for byte,
 * because it is the most heavily tuned shader in the app and the one every
 * visitor renders. The anti-drift guarantee therefore runs the other way: the
 * node graph is built from declared constants, and this file asserts every one
 * of them still appears in the shipped shader. Tune a number in one place and
 * not the other and this fails.
 *
 * It also checks the thing that has no visible symptom: that the node path
 * accepted the patch at all. A seabed with no caustics renders perfectly.
 */

const SEABED_LIGHT_COLOR = "#CFF6FF";
const SURFACE_HEIGHT_ABOVE_FLOOR = 12;
const CAUSTIC_STRENGTH = 0.42;

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

/** The shipped shader, read through the one path that has it: a classic patch. */
function shippedCausticsShader(): { vertexShader: string; fragmentShader: string } {
  const material = new MeshStandardMaterial();
  applyCaustics(material, createCausticsUniforms(CAUSTIC_STRENGTH, SURFACE_HEIGHT_ABOVE_FLOOR, SEABED_LIGHT_COLOR, null));
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main() {\n#include <tonemapping_fragment>\n}"
  };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe("ocean caustics", () => {
  /**
   * EVERY NUMBER THE NODE GRAPH USES IS STILL IN THE SHIPPED SHADER.
   *
   * The five ripple trains, the domain warp, the Jacobian's clamp and shape,
   * and the upness fade. A number that moved on one path and not the other
   * fails here rather than at the sixth decimal place of a parity score.
   */
  it("keeps every declared constant present in the shipped GLSL", () => {
    const { fragmentShader } = shippedCausticsShader();
    const declaredLiterals = [
      // Ripple wavenumbers, including the two expressed as multiples.
      "2.4",
      "1.7",
      "3.9",
      "1.61",
      "2.43",
      // The domain warp.
      "0.31",
      "0.13",
      "0.45",
      "0.71",
      "0.19",
      "0.27",
      "0.11",
      "0.63",
      "0.17",
      "1.5",
      // Train directions and slope amplitudes.
      "0.986",
      "0.164",
      "0.383",
      "0.924",
      "0.707",
      "0.643",
      "0.766",
      "0.259",
      "0.966",
      "0.26",
      "0.09",
      "0.06",
      // Drift rates.
      "0.9",
      "0.7",
      "1.3",
      "2.1",
      // Slope scale, Jacobian floor, ceiling, power, upness fade.
      "0.16",
      "1e-7",
      "1.8",
      "1.6",
      "0.35"
    ];

    const missing = declaredLiterals.filter((literal) => !fragmentShader.includes(literal));
    expect(missing, `these constants are declared in oceanCaustics.ts but no longer in its shader: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  /** The refraction index is real and is not a tuning knob. */
  it("refracts with air-into-water and throws the light by the water depth", () => {
    const { fragmentShader } = shippedCausticsShader();
    expect(fragmentShader).toContain("0.750188");
    expect(fragmentShader).toContain("uCausticDepth");
    expect(fragmentShader).toContain("dFdx(origin)");
  });

  it("binds the four uniforms and the define on the classic path", () => {
    const material = new MeshStandardMaterial();
    const uniforms = createCausticsUniforms(CAUSTIC_STRENGTH, SURFACE_HEIGHT_ABOVE_FLOOR, SEABED_LIGHT_COLOR, null);
    applyCaustics(material, uniforms);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <tonemapping_fragment>\n}"
    };
    material.onBeforeCompile(shader as never, null as never);

    expect(material.defines?.USE_OCEAN_CAUSTICS).toBe("");
    expect(shader.uniforms.uCausticStrength).toBe(uniforms.uCausticStrength);
    expect(shader.uniforms.uCausticColor).toBe(uniforms.uCausticColor);
    expect(uniforms.nodes, "the classic path builds no node uniforms").toBeNull();
  });

  /**
   * THE NODE PATH HAS TO TAKE THE PATCH, AND A SEABED WITHOUT IT LOOKS FINE.
   *
   * This is the assertion with no visual equivalent: sand with no caustic veins
   * is sand, and nothing else in this repository would notice.
   */
  it("registers the injection on a patchable node material", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = createCausticsUniforms(CAUSTIC_STRENGTH, SURFACE_HEIGHT_ABOVE_FLOOR, SEABED_LIGHT_COLOR, modules);
    const material = patchedStandardNodeMaterial(modules, { color: new Color("#FFFFFF") });

    applyCaustics(material as unknown as MeshStandardMaterial, uniforms);

    expect(material.chunkPatches).toHaveLength(1);
    expect(material.chunkPatches[0].name).toBe("oceanCaustics");
    expect(typeof material.chunkPatches[0].litColorAdjustment).toBe("function");
    // No vertex injection: `positionWorld` and `normalWorld` already carry what
    // the classic patch has to compute and pass across as two varyings.
    expect(material.chunkPatches[0].localPositionOffset).toBeUndefined();
  });

  /**
   * THE VALUES THAT ARRIVE LATE MUST REACH THE NODE UNIFORMS.
   *
   * Strength, colour and depth are all written by `tintSeabed` after the
   * material exists, and the clock every frame. Without the copy step the node
   * path would render the placeholder forever — strength 0, which is a seabed
   * with no caustics that looks exactly like one in deep water.
   */
  it("copies the late-arriving values into the node uniforms", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = createCausticsUniforms(0, 1, SEABED_LIGHT_COLOR, modules);
    const nodes = uniforms.nodes;
    expect(nodes).not.toBeNull();

    expect((nodes!.strength as unknown as { value: number }).value).toBe(0);

    uniforms.uCausticStrength.value = CAUSTIC_STRENGTH;
    uniforms.uCausticDepth.value = SURFACE_HEIGHT_ABOVE_FLOOR;
    uniforms.uCausticTime.value = 6;
    uniforms.uCausticColor.value.set("#FF0000");
    uniforms.synchronise();

    expect((nodes!.strength as unknown as { value: number }).value).toBe(CAUSTIC_STRENGTH);
    expect((nodes!.depth as unknown as { value: number }).value).toBe(SURFACE_HEIGHT_ABOVE_FLOOR);
    expect((nodes!.time as unknown as { value: number }).value).toBe(6);
    expect((nodes!.color as unknown as { value: Color }).value.getHexString()).toBe("ff0000");
  });

  /** The node graph builds rather than throwing when three calls the hook. */
  it("produces a node from the injection", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = createCausticsUniforms(CAUSTIC_STRENGTH, SURFACE_HEIGHT_ABOVE_FLOOR, SEABED_LIGHT_COLOR, modules);
    const material = patchedStandardNodeMaterial(modules, { color: new Color("#FFFFFF") });
    applyCaustics(material as unknown as MeshStandardMaterial, uniforms);

    const adjusted = material.chunkPatches[0].litColorAdjustment!(modules.tsl.vec3(0.5, 0.5, 0.5) as never);
    expect((adjusted as unknown as { isNode?: boolean }).isNode).toBe(true);
  });
});
