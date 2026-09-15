import { NormalBlending, Texture } from "three";
import { describe, expect, it } from "vitest";
import {
  buildCloudPointsNodeLayer,
  cloudPointsFragmentShaderGlsl,
  CLOUD_POINTS_VERTEX_SHADER,
  type CloudLayerAttributes
} from "./nebulaCloudPointsMaterial";
import {
  attributeStepsPerInstance,
  type NodeMaterialModules
} from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE CLOUD LAYER EXISTS TWICE AND THE TWO COPIES MUST NOT DRIFT.
 *
 * `sizedStarPointsMaterial.test.ts` carries the long version of why the second
 * group of assertions below is here at all. The short version: on the node path
 * a sized sprite is an instanced quad, and whether its per-cloud values step per
 * instance or per vertex is one word in one constructor that nothing warns about.
 *
 * This layer has MORE of those values than the star layer — six rather than four
 * — which is the whole reason the check belongs in a test rather than in a
 * careful reading.
 */

const CLOUD_COUNT = 4;
const POSITION_COMPONENTS = 3;
const COLOR_COMPONENTS = 3;

function cloudLayerAttributes(): CloudLayerAttributes {
  return {
    positions: new Float32Array(CLOUD_COUNT * POSITION_COMPONENTS).fill(1),
    colors: new Float32Array(CLOUD_COUNT * COLOR_COMPONENTS).fill(1),
    sizes: new Float32Array(CLOUD_COUNT).fill(40),
    rotations: new Float32Array(CLOUD_COUNT).fill(0),
    alphas: new Float32Array(CLOUD_COUNT).fill(0.1),
    variants: new Float32Array(CLOUD_COUNT).fill(0)
  };
}

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

async function cloudLayer() {
  return buildCloudPointsNodeLayer(await nodeMaterialModules(), cloudLayerAttributes(), NormalBlending, new Texture());
}

type AttributeCarryingNode = { attribute: object };

describe("nebula cloud points material", () => {
  /**
   * Zero and one are permitted as structural GLSL — `clamp(0.0, 1.0)` is the
   * unit range, not a tuning decision. Every other literal has to be a value the
   * module declares, so a retune moves both implementations or neither.
   */
  it("contains no numeric literal that is not one of the declared constants", () => {
    const declaredValues = new Set([0.5, 0.004]);
    const structuralLiterals = new Set([0, 1]);
    const LITERALS_IN_THE_SHADER = 5;
    // The lookbehind excludes digits that belong to an IDENTIFIER — `vec2`,
    // `vec4`, `texture2D` — which are spelling rather than values.
    const numericLiterals = (cloudPointsFragmentShaderGlsl().match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(
      Number
    );

    expect(numericLiterals.length, "the shader should still be built from the constants").toBe(
      LITERALS_IN_THE_SHADER
    );
    for (const literal of numericLiterals) {
      const permitted = declaredValues.has(literal) || structuralLiterals.has(literal);
      expect(permitted, `${literal} is in the shader but is not a declared constant`).toBe(true);
    }
  });

  /**
   * The classic size attenuation, which is the expression three's sprite path is
   * being matched against — see the star material's test for the node side.
   */
  it("attenuates the classic point size by the view depth", () => {
    expect(CLOUD_POINTS_VERTEX_SHADER).toContain("gl_PointSize = cloudSize * (uPointScale / -mvPosition.z)");
  });

  it("builds a geometry of its own rather than sharing three's sprite quad", async () => {
    const first = await cloudLayer();
    const second = await cloudLayer();

    expect(first.geometry).not.toBe(second.geometry);
  });

  it("draws one instance per cloud", async () => {
    const layer = await cloudLayer();
    expect(layer.instanceCount).toBe(CLOUD_COUNT);
  });

  /**
   * **THE REGRESSION.** See `perInstanceAttribute` in `nodeMaterials.ts` for what
   * a per-vertex step does to a frame, and `sizedStarPointsMaterial.test.ts` for
   * how it was found.
   */
  it("steps the cloud centres once per instance", async () => {
    const layer = await cloudLayer();
    const positionNode = layer.material.positionNode as unknown as AttributeCarryingNode;

    expect(attributeStepsPerInstance(positionNode.attribute)).toBe(true);
  });

  it("steps the quad's own corners once per vertex", async () => {
    const layer = await cloudLayer();

    expect(attributeStepsPerInstance(layer.geometry.getAttribute("position"))).toBe(false);
    expect(attributeStepsPerInstance(layer.geometry.getAttribute("uv"))).toBe(false);
  });

  /**
   * The layer's blending is the caller's choice and carries meaning: additive
   * makes the layer glow (nebula, galactic core), normal with dark colours makes
   * it DARKEN what is behind it (the Great Rift's dust). A node path that
   * defaulted to additive would turn the rift into a second nebula.
   */
  it("keeps the blending mode the caller asked for", async () => {
    const layer = await cloudLayer();
    expect(layer.material.blending).toBe(NormalBlending);
    expect(layer.material.depthWrite).toBe(false);
    expect(layer.material.transparent).toBe(true);
  });

  it("expresses the cloud as position, size and colour graphs", async () => {
    const layer = await cloudLayer();
    const material = layer.material as unknown as {
      isNodeMaterial?: boolean;
      positionNode?: unknown;
      sizeNode?: unknown;
      colorNode?: unknown;
    };

    expect(material.isNodeMaterial).toBe(true);
    expect(material.positionNode).toBeDefined();
    expect(material.sizeNode).toBeDefined();
    expect(material.colorNode).toBeDefined();
  });
});
