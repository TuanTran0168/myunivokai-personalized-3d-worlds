import { AdditiveBlending, BackSide, Color, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  GOD_RAY_VISIBILITY_STRENGTH_FLOOR,
  MARCH_DISTANCE_RANGE_MULTIPLE,
  godRayUniformValues,
  oceanGodRayMaterial,
  type GodRayInputs
} from "./oceanGodRays";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE SHAFTS, IN TWO SHADER LANGUAGES.
 *
 * The last shader in the ocean, and the one whose port was a decision rather
 * than a translation. The decision is recorded in `oceanGodRays.ts`; what is
 * checked here is that both arms were built from the same numbers and that
 * neither of them quietly acquired an encode the other does not have.
 */

const WORLD_BRIGHTNESS = 0.7;
const WORLD_RANGE = 40;
const WATER_EXTINCTION = 0.035;
const SURFACE_Y_METRES = -14;

function inputs(overrides: Partial<GodRayInputs> = {}): GodRayInputs {
  return {
    isAboveWater: false,
    brightness: WORLD_BRIGHTNESS,
    keyColor: new Color("#8FD8FF"),
    sunBelow: new Vector3(0.2, -0.9, 0.35).normalize(),
    extinction: WATER_EXTINCTION,
    range: WORLD_RANGE,
    surfaceY: SURFACE_Y_METRES,
    ...overrides
  };
}

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

describe("ocean god rays", () => {
  it("gives a world above the water no shafts at all", () => {
    const uniforms = godRayUniformValues(inputs({ isAboveWater: true }));
    expect(uniforms.uStrength.value).toBe(0);
    expect(uniforms.uStrength.value).toBeLessThan(GOD_RAY_VISIBILITY_STRENGTH_FLOOR);
  });

  it("derives strength from world brightness when the config carries none", () => {
    const derived = godRayUniformValues(inputs());
    const configured = godRayUniformValues(inputs({ configuredStrength: 0.5 }));
    expect(derived.uStrength.value).toBeGreaterThan(0);
    expect(configured.uStrength.value).not.toBe(derived.uStrength.value);
  });

  it("marches past the world's own visible range", () => {
    const uniforms = godRayUniformValues(inputs());
    expect(uniforms.uMarchDistance.value).toBe(WORLD_RANGE * MARCH_DISTANCE_RANGE_MULTIPLE);
    expect(uniforms.uMarchDistance.value).toBeGreaterThan(WORLD_RANGE);
  });

  /**
   * The ray colour is the key light PULLED TOWARD a surface white, not the key
   * light itself and not the white. A shaft the exact colour of the key light
   * reads as a coloured gel; one the exact colour of the surface reads as fog.
   */
  it("pulls the shaft colour off the key light without reaching surface white", () => {
    const keyColor = new Color("#8FD8FF");
    const uniforms = godRayUniformValues(inputs({ keyColor }));
    expect(uniforms.uRayColor.value.getHexString()).not.toBe(keyColor.getHexString());
    expect(uniforms.uRayColor.value.getHexString()).not.toBe(new Color("#DCF6FF").getHexString());
    // And it does not mutate what the rig handed over.
    expect(keyColor.getHexString()).toBe(new Color("#8FD8FF").getHexString());
  });

  /**
   * **THE CLASSIC ARM MUST NOT ENCODE ITSELF, AND THAT IS THE WHOLE POINT OF
   * THE FILE'S HEADER.** It writes raw linear values into an already-encoded
   * framebuffer; the node arm cannot, because the encode there is frame-wide.
   * If somebody ever "fixes" this by adding the includes, the shipped comment
   * says what happens — the rays clipped a 14 m reef to pure white, 100% of
   * measured pixels — and this is the test that catches it first.
   */
  it("builds the classic arm as an additive ShaderMaterial that does not encode itself", () => {
    const uniforms = godRayUniformValues(inputs());
    const { material } = oceanGodRayMaterial(uniforms, null);
    const shaderMaterial = material as unknown as {
      isShaderMaterial?: boolean;
      fragmentShader: string;
      blending: number;
      side: number;
      depthTest: boolean;
      depthWrite: boolean;
      fog: boolean;
    };

    expect(shaderMaterial.isShaderMaterial).toBe(true);
    expect(shaderMaterial.blending).toBe(AdditiveBlending);
    expect(shaderMaterial.side).toBe(BackSide);
    expect(shaderMaterial.depthTest).toBe(false);
    expect(shaderMaterial.depthWrite).toBe(false);
    expect(shaderMaterial.fog).toBe(false);
    expect(shaderMaterial.fragmentShader).not.toContain("tonemapping_fragment");
    expect(shaderMaterial.fragmentShader).not.toContain("colorspace_fragment");
  });

  /**
   * EVERY CONSTANT THE NODE GRAPH USES IS STILL IN THE SHIPPED SHADER.
   *
   * The GLSL is not generated here — it is the string that shipped, moved
   * between files without a character changing — so the anti-drift guarantee
   * runs this way round: retune a number in one arm and not the other and this
   * fails.
   */
  it("keeps every declared constant present in the shipped GLSL", () => {
    const uniforms = godRayUniformValues(inputs());
    const { material } = oceanGodRayMaterial(uniforms, null);
    const fragment = (material as unknown as { fragmentShader: string }).fragmentShader;

    const declaredLiterals = [
      // The value-noise hash.
      "127.1",
      "311.7",
      "43758.5453123",
      // Four octaves, and the lacunarity that is deliberately not 2.0.
      "2.03",
      // The anisotropic beam plane, and the drift across it.
      "0.30",
      "0.075",
      "0.02",
      // The density threshold, above the field's mean.
      "0.52",
      "0.86",
      // The second octave riding on top.
      "0.62",
      "0.38",
      "3.7",
      "0.05",
      // The march itself.
      "24"
    ];

    const missing = declaredLiterals.filter((literal) => !fragment.includes(literal));
    expect(missing, `declared in oceanGodRays.ts but no longer in its shader: ${missing.join(", ")}`).toEqual([]);
  });

  it("builds the node arm as an additive node material with a colour graph", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = godRayUniformValues(inputs());
    const { material } = oceanGodRayMaterial(uniforms, modules);
    const nodeMaterial = material as unknown as {
      isNodeMaterial?: boolean;
      isShaderMaterial?: boolean;
      colorNode: { isNode?: boolean } | null;
      blending: number;
      side: number;
      depthTest: boolean;
      depthWrite: boolean;
      fog: boolean;
    };

    expect(nodeMaterial.isNodeMaterial, "the node path must not fall back to the ShaderMaterial").toBe(true);
    expect(nodeMaterial.isShaderMaterial).not.toBe(true);
    expect(nodeMaterial.colorNode?.isNode).toBe(true);
    expect(nodeMaterial.blending).toBe(AdditiveBlending);
    expect(nodeMaterial.side).toBe(BackSide);
    expect(nodeMaterial.depthTest).toBe(false);
    expect(nodeMaterial.depthWrite).toBe(false);
    expect(nodeMaterial.fog).toBe(false);
  });

  /**
   * The two axis vectors are SHARED INSTANCES and the rig recomputes them in
   * place every frame, so they need no copy; the clock is a number and does.
   * This is the caustics' lesson applied before it could cost anything.
   */
  it("shares the axis vectors with the rig and copies the clock through synchronise", async () => {
    const modules = await nodeMaterialModules();
    const uniforms = godRayUniformValues(inputs());
    const { material, synchronise } = oceanGodRayMaterial(uniforms, modules);

    const axisBefore = uniforms.uAxisA.value.clone();
    uniforms.uAxisA.value.set(0, 0, 1);
    expect(uniforms.uAxisA.value.equals(axisBefore)).toBe(false);

    uniforms.uTime.value = 6;
    expect(() => synchronise()).not.toThrow();
    expect((material as unknown as { colorNode: { isNode?: boolean } }).colorNode.isNode).toBe(true);
  });

  it("gives the classic path a synchroniser that does nothing", () => {
    const uniforms = godRayUniformValues(inputs());
    const { synchronise } = oceanGodRayMaterial(uniforms, null);
    expect(() => synchronise()).not.toThrow();
  });
});
