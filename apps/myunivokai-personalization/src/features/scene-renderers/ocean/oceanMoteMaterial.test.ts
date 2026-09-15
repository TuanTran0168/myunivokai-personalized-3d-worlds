import { AdditiveBlending, Color, NormalBlending } from "three";
import { describe, expect, it } from "vitest";
import {
  moteFragmentShaderGlsl,
  moteLayerBuild,
  moteVertexShaderGlsl,
  MOTE_SEED_ATTRIBUTE,
  type MoteLayerSettings
} from "./oceanMoteMaterial";
import {
  attributeStepsPerInstance,
  type NodeMaterialModules
} from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * MARINE SNOW EXISTS TWICE AND THE TWO COPIES ARE NOT EVEN THE SAME PRIMITIVE.
 *
 * `sizedStarPointsMaterial.test.ts` carries the long version: WebGPU has no
 * point size, so a sized point is a `Points` on the classic path and an
 * instanced `Sprite` on the node one. What this file adds is the pair of
 * conventions that make THIS layer different from the star layer, and getting
 * either wrong changes the frame without failing anything.
 */

const MOTE_COUNT = 5;
const POSITION_COMPONENTS = 3;

const SNOW_SETTINGS: MoteLayerSettings = {
  size: 2.4,
  color: "#E6F4F6",
  opacity: 0.26,
  fall: 0.24,
  span: 96,
  living: false
};

const BIOLUMINESCENT_SETTINGS: MoteLayerSettings = { ...SNOW_SETTINGS, color: "#5CF2E0", living: true };

function motePositions() {
  return new Float32Array(MOTE_COUNT * POSITION_COMPONENTS).fill(1);
}

function moteSeeds() {
  return new Float32Array(MOTE_COUNT).fill(0.5);
}

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

function assertEveryLiteralIsDeclared(shader: string, declaredValues: Set<number>, expectedCount: number) {
  const structuralLiterals = new Set([0, 1]);
  const numericLiterals = (shader.match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(Number);

  expect(numericLiterals.length, "the shader should still be built from the constants").toBe(expectedCount);
  for (const literal of numericLiterals) {
    const permitted = declaredValues.has(literal) || structuralLiterals.has(literal);
    expect(permitted, `${literal} is in the shader but is not a declared constant`).toBe(true);
  }
}

describe("marine snow material", () => {
  const declaredValues = new Set([
    6.2831853, 0.6, 0.8, 0.5, 0.2, 0.4, 0.02, 2, 0.85, 0.45, 0.55, 1.4, 3, 12, 300, 1.7
  ]);

  it("builds its vertex shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(moteVertexShaderGlsl(), declaredValues, 21);
  });

  it("builds its fragment shader from the declared constants", () => {
    assertEveryLiteralIsDeclared(moteFragmentShaderGlsl(), declaredValues, 7);
  });

  it("reads its per-mote seed through the shared attribute name", () => {
    expect(moteVertexShaderGlsl()).toContain(`attribute float ${MOTE_SEED_ATTRIBUTE};`);
  });

  /**
   * **THIS LAYER'S SIZE CONVENTION IS NOT THE STAR LAYER'S, and the GLSL is
   * where that is visible.** `SizedStarPoints` scales by half the drawing
   * buffer's height, which is exactly what three's `sizeAttenuation` computes,
   * so its port hands three a raw size. This one scales by a FIXED 300, so the
   * node path has to switch attenuation off and divide itself. A port that let
   * three attenuate this layer would re-scale every mote with the window.
   */
  it("scales by a fixed distance constant rather than by the viewport", () => {
    const vertexShader = moteVertexShaderGlsl();
    expect(vertexShader).toContain("300.0 / max(1.0, viewDistance)");
    expect(vertexShader).not.toContain("uPointScale");
  });

  it("writes its fragment raw, with no encode and no tone mapping", () => {
    const fragmentShader = moteFragmentShaderGlsl();
    expect(fragmentShader).toContain("gl_FragColor = vec4(");
    expect(fragmentShader).not.toContain("linearToOutputTexel");
    expect(fragmentShader).not.toContain("sRGBTransferOETF");
  });

  /**
   * Snow REFLECTS the light already in the water; bioluminescence MAKES it. The
   * three snow layers therefore blend normally and only the living one is
   * additive — blending 4200 flakes additively is most of the abyss's
   * brightness, and it was.
   */
  it("blends snow normally and bioluminescence additively, on both paths", async () => {
    const modules = await nodeMaterialModules();
    for (const nodeModules of [null, modules]) {
      const snow = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), nodeModules);
      const living = moteLayerBuild(BIOLUMINESCENT_SETTINGS, moteSeeds(), motePositions(), nodeModules);
      expect(snow.material.blending).toBe(NormalBlending);
      expect(living.material.blending).toBe(AdditiveBlending);
      expect(snow.material.depthWrite).toBe(false);
    }
  });

  it("builds the classic path with no geometry of its own and a single draw", () => {
    const build = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), null);
    expect(build.geometry, "the caller builds the Points geometry on this path").toBe(null);
    expect(build.instanceCount).toBe(1);
    expect(build.uniforms.uFogColor.value).toBeInstanceOf(Color);
  });

  it("builds the node path as one instance per mote, on its own quad", async () => {
    const build = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), await nodeMaterialModules());

    expect(build.instanceCount).toBe(MOTE_COUNT);
    expect(build.geometry).not.toBe(null);
    expect(build.geometry?.getAttribute("position")).toBeDefined();
    expect(build.geometry?.getAttribute("uv")).toBeDefined();
  });

  /**
   * The quad's OWN corners must stay per VERTEX. Making them instanced collapses
   * all four onto one point and the sprite has no area — the same trap as the
   * one `perInstanceAttribute` exists for, facing the other way.
   *
   * The per-instance half is not asserted here because this material composes
   * its centres into an expression rather than handing the attribute straight to
   * `positionNode`; `nodeMaterials.test.ts` asserts that property against three's
   * own behaviour, which is where a version bump would break it.
   */
  it("keeps the quad's own corners stepping per vertex", async () => {
    const build = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), await nodeMaterialModules());

    expect(attributeStepsPerInstance(build.geometry!.getAttribute("position"))).toBe(false);
    expect(attributeStepsPerInstance(build.geometry!.getAttribute("uv"))).toBe(false);
  });

  /**
   * `sizeAttenuation` OFF is the whole reason the node path can honour the fixed
   * 300 above. three's attenuation would multiply in half the canvas height on
   * top of it.
   */
  it("turns three's own size attenuation off on the node path", async () => {
    const build = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), await nodeMaterialModules());
    const material = build.material as unknown as {
      isNodeMaterial?: boolean;
      sizeAttenuation?: boolean;
      sizeNode?: unknown;
      positionNode?: unknown;
      colorNode?: unknown;
    };

    expect(material.isNodeMaterial).toBe(true);
    expect(material.sizeAttenuation).toBe(false);
    expect(material.sizeNode).toBeDefined();
    expect(material.positionNode).toBeDefined();
    expect(material.colorNode).toBeDefined();
  });

  it("exposes the same four frame uniforms on both paths", async () => {
    const modules = await nodeMaterialModules();
    for (const nodeModules of [null, modules]) {
      const { uniforms } = moteLayerBuild(SNOW_SETTINGS, moteSeeds(), motePositions(), nodeModules);
      uniforms.uMoteTime.value = 6;
      uniforms.uMoteOpacity.value = 0.3;
      uniforms.uFogColor.value.set("#123456");
      expect(uniforms.uMoteTime.value).toBe(6);
      expect(uniforms.uMoteOpacity.value).toBe(0.3);
      expect(uniforms.uFogColor.value.getHexString()).toBe(new Color("#123456").getHexString());
      expect(typeof uniforms.uFogDensity.value).toBe("number");
    }
  });
});
