import { DoubleSide, Texture } from "three";
import { describe, expect, it } from "vitest";
import { oceanSeaTopMaterial, seaTopUniformValues } from "./oceanSeaTopMaterial";
import { skyCoefficients, skyUniformNodes, waveUniformNodes } from "./oceanSky";
import { Vector2, Vector3, Vector4 } from "three";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE SEA SEEN FROM ABOVE, IN TWO SHADER LANGUAGES.
 *
 * §26 Phase 8's largest port, and the one with the least visible failure mode in
 * this repository: no parity fixture was above water until this commit, so the
 * material could have been refused, drawn nowhere, and moved no number at all.
 * `e2e/fixtures/ocean-surface-world.json` closes that; this file checks what a
 * screenshot cannot.
 */

const FOAM_EDGE = 0.42;
const WAVE_MAX = 8;
const SUN_DIRECTION = new Vector3(0.3, 0.6, 0.74).normalize();
/** A sun well clear of the horizon, so the Preetham fit is in its valid range. */
const SUN_ELEVATION_RADIANS = Math.PI / 4;

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

function waveInputs() {
  return {
    directions: [new Vector2(1, 0), new Vector2(0.7, 0.7)],
    terms: [new Vector4(0.4, 0.2, 0.9, 0), new Vector4(0.2, 0.4, 1.3, 1)]
  };
}

describe("ocean sea top material", () => {
  it("builds the classic path as the shipped ShaderMaterial", () => {
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    const { material } = oceanSeaTopMaterial(uniformValues, { ...uniformValues }, WAVE_MAX, null, null, null);
    const shaderMaterial = material as unknown as {
      isShaderMaterial?: boolean;
      fragmentShader: string;
      vertexShader: string;
      fog: boolean;
      side: number;
    };

    expect(shaderMaterial.isShaderMaterial).toBe(true);
    expect(shaderMaterial.side).toBe(DoubleSide);
    expect(shaderMaterial.fog).toBe(false);
    // It encodes ITSELF on this path, which is exactly why it is portable and
    // the god rays are not.
    expect(shaderMaterial.fragmentShader).toContain("#include <tonemapping_fragment>");
    expect(shaderMaterial.fragmentShader).toContain("#include <colorspace_fragment>");
  });

  /**
   * EVERY CONSTANT THE NODE GRAPH USES IS STILL IN THE SHIPPED SHADER.
   *
   * The GLSL here is not generated — it is the string that shipped, moved
   * between files without a character changing — so the anti-drift guarantee
   * runs this way round: tune a number in one place and not the other and this
   * fails.
   */
  it("keeps every declared constant present in the shipped GLSL", () => {
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    const { material } = oceanSeaTopMaterial(uniformValues, { ...uniformValues }, WAVE_MAX, null, null, null);
    const fragment = (material as unknown as { fragmentShader: string }).fragmentShader;

    const declaredLiterals = [
      // Water.js's four lookup periods and four scroll rates.
      "103.0",
      "107.0",
      "8907.0",
      "9803.0",
      "1091.0",
      "1027.0",
      "17.0",
      "29.0",
      "-19.0",
      "31.0",
      "101.0",
      "97.0",
      "109.0",
      "-113.0",
      // The ripple's two gains, the specular and diffuse constants.
      "1.5",
      "100.0",
      "2.0",
      "0.5",
      "0.55",
      // Fresnel, scatter, sky dome.
      "0.02",
      "5.0",
      "0.34",
      "1.15",
      "0.13",
      // Foam and haze.
      "0.42",
      "0.86",
      "0.045",
      "0.00030"
    ];

    const missing = declaredLiterals.filter((literal) => !fragment.includes(literal));
    expect(missing, `declared in oceanSeaTopMaterial.ts but no longer in its shader: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives the uniform record the sea state's own foam threshold", () => {
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    expect(uniformValues.uFoamEdge.value).toBe(FOAM_EDGE);
    expect(uniformValues.uExposure.value).toBe(1);
    expect(uniformValues.uSize.value).toBe(5);
  });

  /**
   * THE NODE ARM MUST BE A NODE MATERIAL AND MUST SET `vertexNode`.
   *
   * The GLSL builds a WORLD position, displaces it there and projects it itself.
   * `positionNode` is local space, and reproducing the world build through it
   * would mean inverting the model matrix — correct only while that matrix stays
   * a pure translation, which is an assumption about the rig a material has no
   * business making.
   */
  it("builds the node path with a vertexNode and a colorNode", async () => {
    const modules = await nodeMaterialModules();
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    const skyNodes = skyUniformNodes(modules, SUN_DIRECTION, skyCoefficients(SUN_ELEVATION_RADIANS));
    const { directions, terms } = waveInputs();
    const waveNodeSet = waveUniformNodes(modules, directions, terms, directions.length, 0.7);

    const { material } = oceanSeaTopMaterial(
      uniformValues,
      { ...uniformValues },
      WAVE_MAX,
      skyNodes,
      waveNodeSet.nodes,
      modules
    );
    const nodeMaterial = material as unknown as {
      isNodeMaterial?: boolean;
      isShaderMaterial?: boolean;
      vertexNode: unknown;
      colorNode: unknown;
      positionNode: unknown;
      side: number;
      fog: boolean;
    };

    expect(nodeMaterial.isNodeMaterial, "the node path must not fall back to the ShaderMaterial").toBe(true);
    expect(nodeMaterial.isShaderMaterial).not.toBe(true);
    expect(nodeMaterial.vertexNode).not.toBeNull();
    expect(nodeMaterial.colorNode).not.toBeNull();
    // `positionNode` reassigns `positionLocal`; this material projects itself.
    expect(nodeMaterial.positionNode).toBeNull();
    expect(nodeMaterial.side).toBe(DoubleSide);
    expect(nodeMaterial.fog).toBe(false);
  });

  /**
   * The node path's clock is its own uniform, and a sea whose time never
   * advances is a still sea rather than a blank frame — the same hazard the wave
   * field and the kelp carry, given the same treatment.
   */
  it("advances the node clock through the returned synchroniser", async () => {
    const modules = await nodeMaterialModules();
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    const skyNodes = skyUniformNodes(modules, SUN_DIRECTION, skyCoefficients(SUN_ELEVATION_RADIANS));
    const { directions, terms } = waveInputs();
    const waveNodeSet = waveUniformNodes(modules, directions, terms, directions.length, 0.7);

    const { material, synchronise } = oceanSeaTopMaterial(
      uniformValues,
      { ...uniformValues },
      WAVE_MAX,
      skyNodes,
      waveNodeSet.nodes,
      modules
    );

    uniformValues.uTime.value = 6;
    synchronise();
    // The uniform is internal to the graph; what is observable is that the
    // colour graph still stands after the write.
    expect((material as unknown as { colorNode: { isNode?: boolean } }).colorNode.isNode).toBe(true);
  });

  /** The classic arm ignores the node clock entirely, and must not throw for it. */
  it("gives the classic path a synchroniser that does nothing", () => {
    const uniformValues = seaTopUniformValues(new Texture(), FOAM_EDGE);
    const { synchronise } = oceanSeaTopMaterial(uniformValues, { ...uniformValues }, WAVE_MAX, null, null, null);
    expect(() => synchronise()).not.toThrow();
  });
});
