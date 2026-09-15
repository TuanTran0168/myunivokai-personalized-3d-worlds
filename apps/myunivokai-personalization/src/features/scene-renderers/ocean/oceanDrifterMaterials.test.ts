import { AdditiveBlending, Color } from "three";
import { describe, expect, it } from "vitest";
import {
  bubbleFragmentShaderGlsl,
  bubbleMaterial,
  bubbleVertexShaderGlsl,
  jellyfishFragmentShaderGlsl,
  jellyfishMaterial,
  jellyfishVertexShaderGlsl,
  BUBBLE_ANCHOR_ATTRIBUTE,
  BUBBLE_SEED_ATTRIBUTE,
  JELLYFISH_ANCHOR_ATTRIBUTE,
  JELLYFISH_SEED_ATTRIBUTE
} from "./oceanDrifterMaterials";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE OCEAN'S FIRST TWO PORTED SHADERS, AND THE TWO COPIES MUST NOT DRIFT.
 *
 * `forestFoliageMaterial.test.ts` explains the general shape. What is specific
 * to this family is the LAST assertion in each group: these layers are additive
 * and must not be tone mapped or colour-space encoded, and that is a property a
 * frame will not report — it reports a haze over the whole water column, which
 * reads as a lighting decision rather than as a bug. It has been shipped once.
 */

const JELLYFISH_COLUMN_HEIGHT = 40;

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

/**
 * Zero and one are permitted without being tuning constants — they are how GLSL
 * writes "none of this" and "all of this", and the `w` of a position. Every
 * other literal has to be a value the module declares, which is what makes a
 * retune move both implementations or neither.
 */
function assertEveryLiteralIsDeclared(shader: string, declaredValues: Set<number>, expectedCount: number) {
  const structuralLiterals = new Set([0, 1]);
  // The lookbehind excludes digits that are part of an IDENTIFIER — `vec3`,
  // `vec4`, `mat3` — which are GLSL's type names rather than values.
  const numericLiterals = (shader.match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(Number);

  expect(numericLiterals.length, "the shader should still be built from the constants").toBe(expectedCount);
  for (const literal of numericLiterals) {
    const permitted = declaredValues.has(literal) || structuralLiterals.has(literal);
    expect(permitted, `${literal} is in the shader but is not a declared constant`).toBe(true);
  }
}

describe("jellyfish material", () => {
  const declaredValues = new Set([
    1.15, 6.2831853, 0.5, 0.22, 0.3, 0.34, 0.62, 0.08, 0.11, 3, 2.4, 0.09, 2, 1.6, 0.4, 0.85, 0.2, 1.4, 0.15
  ]);

  it("builds its vertex shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(jellyfishVertexShaderGlsl(), declaredValues, 24);
  });

  it("builds its fragment shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(jellyfishFragmentShaderGlsl(), declaredValues, 4);
  });

  /**
   * The attribute names are shared with the geometry that supplies them, so a
   * rename cannot move one and leave the other. `oceanRigDrifters.ts` sets both
   * from the same two constants.
   */
  it("reads its per-instance values through the shared attribute names", () => {
    const vertexShader = jellyfishVertexShaderGlsl();
    expect(vertexShader).toContain(`attribute vec3 ${JELLYFISH_ANCHOR_ATTRIBUTE};`);
    expect(vertexShader).toContain(`attribute float ${JELLYFISH_SEED_ATTRIBUTE};`);
  });

  /**
   * **THE RULE THAT A FRAME WILL NOT REPORT.** An additive layer that encodes
   * its own output is inflated roughly two and a half times before it is summed,
   * because sRGB is steep near black. Four of those at once is the haze this
   * family shipped. Neither path may grow an encode, and the GLSL is the half of
   * that a string can check.
   */
  it("writes its fragment raw, with no encode and no tone mapping", () => {
    const fragmentShader = jellyfishFragmentShaderGlsl();
    expect(fragmentShader).toContain("gl_FragColor = vec4(");
    expect(fragmentShader).not.toContain("linearToOutputTexel");
    expect(fragmentShader).not.toContain("toneMapping");
    expect(fragmentShader).not.toContain("sRGBTransferOETF");
  });

  it("builds the classic material as an additive shell that writes no depth", () => {
    const { material, uniforms } = jellyfishMaterial(JELLYFISH_COLUMN_HEIGHT, null);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(AdditiveBlending);
    expect(uniforms.uJellyColor.value).toBeInstanceOf(Color);
  });

  it("builds the node material with a position graph and a colour graph", async () => {
    const { material, uniforms } = jellyfishMaterial(JELLYFISH_COLUMN_HEIGHT, await nodeMaterialModules());
    const nodeMaterial = material as unknown as {
      isNodeMaterial?: boolean;
      positionNode?: unknown;
      colorNode?: unknown;
    };

    expect(nodeMaterial.isNodeMaterial, "the node path must not fall back to the classic material").toBe(true);
    expect(nodeMaterial.positionNode, "the motion is entirely in the vertex stage").toBeDefined();
    expect(nodeMaterial.colorNode).toBeDefined();
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);
  });

  /**
   * `oceanRig` tints this layer with `uniforms.uJellyColor.value.set(...)` — it
   * mutates the `Color` in place and never replaces it. A node uniform that only
   * noticed reassignment would freeze the tint at its construction colour on the
   * node path alone, so what both paths must expose is the same `Color`
   * INSTANCE, addressable the same way.
   */
  it("exposes a mutable Color on both paths, because the rig tints it in place", async () => {
    for (const modules of [null, await nodeMaterialModules()]) {
      const { uniforms } = jellyfishMaterial(JELLYFISH_COLUMN_HEIGHT, modules);
      uniforms.uJellyColor.value.set("#48FFD5");
      expect(uniforms.uJellyColor.value.getHexString()).toBe(new Color("#48FFD5").getHexString());
    }
  });
});

describe("bubble material", () => {
  const declaredValues = new Set([0.42, 1.5, 0.035, 0.075, 1.7, 6, 4, 0.22, 2.2, 0.86, 0.04, 0.85]);

  it("builds its vertex shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(bubbleVertexShaderGlsl(), declaredValues, 19);
  });

  it("builds its fragment shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(bubbleFragmentShaderGlsl(), declaredValues, 2);
  });

  it("reads its per-instance values through the shared attribute names", () => {
    const vertexShader = bubbleVertexShaderGlsl();
    expect(vertexShader).toContain(`attribute vec3 ${BUBBLE_ANCHOR_ATTRIBUTE};`);
    expect(vertexShader).toContain(`attribute float ${BUBBLE_SEED_ATTRIBUTE};`);
  });

  it("writes its fragment raw, with no encode and no tone mapping", () => {
    const fragmentShader = bubbleFragmentShaderGlsl();
    expect(fragmentShader).toContain("gl_FragColor = vec4(");
    expect(fragmentShader).not.toContain("linearToOutputTexel");
    expect(fragmentShader).not.toContain("toneMapping");
    expect(fragmentShader).not.toContain("sRGBTransferOETF");
  });

  it("builds the classic material as an additive shell that writes no depth", () => {
    const { material, uniforms } = bubbleMaterial(null);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(AdditiveBlending);
    expect(uniforms.uBubbleTint.value).toBeInstanceOf(Color);
  });

  it("builds the node material with a position graph and a colour graph", async () => {
    const { material } = bubbleMaterial(await nodeMaterialModules());
    const nodeMaterial = material as unknown as {
      isNodeMaterial?: boolean;
      positionNode?: unknown;
      colorNode?: unknown;
    };

    expect(nodeMaterial.isNodeMaterial).toBe(true);
    expect(nodeMaterial.positionNode).toBeDefined();
    expect(nodeMaterial.colorNode).toBeDefined();
    expect(material.blending).toBe(AdditiveBlending);
  });

  /**
   * The rig re-scales the column per world — `uBubbleTop` is the span the rise
   * is taken modulo — so this one has to be writable rather than baked into the
   * graph as a literal.
   */
  it("exposes a writable column top on both paths", async () => {
    for (const modules of [null, await nodeMaterialModules()]) {
      const { uniforms } = bubbleMaterial(modules);
      uniforms.uBubbleTop.value = 90;
      expect(uniforms.uBubbleTop.value).toBe(90);
    }
  });
});
