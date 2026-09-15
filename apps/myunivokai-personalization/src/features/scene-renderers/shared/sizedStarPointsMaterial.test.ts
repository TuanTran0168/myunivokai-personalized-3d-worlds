import { describe, expect, it } from "vitest";
import {
  buildStarPointsNodeLayer,
  starPointsFragmentShaderGlsl,
  STAR_POINTS_VERTEX_SHADER,
  type StarLayerAttributes
} from "./sizedStarPointsMaterial";
import { attributeStepsPerInstance, type NodeMaterialModules } from "./nodeMaterials";

/**
 * THE STAR LAYER EXISTS TWICE AND THE TWO COPIES MUST NOT DRIFT.
 *
 * `forestFoliageMaterial.test.ts` explains the general shape. This file adds the
 * part that is specific to the point layers and that cost a real-GPU bisect to
 * learn: **on the node path a sized star is not a point, it is an instanced
 * quad**, and whether its per-star values reach the GPU once per instance or
 * once per vertex is a property of one word in one constructor. Getting it wrong
 * throws nothing, compiles, and renders a white screen.
 *
 * So the assertions below are in two groups. The first is the usual no-drift
 * check on the shader text. The second asks three what it will actually do with
 * the attributes this module builds.
 */

const STAR_COUNT = 3;
const POSITION_COMPONENTS = 3;
const COLOR_COMPONENTS = 3;
const FULL_SPIKE_STRENGTH = 1;

function starLayerAttributes(): StarLayerAttributes {
  return {
    positions: new Float32Array(STAR_COUNT * POSITION_COMPONENTS).fill(1),
    colors: new Float32Array(STAR_COUNT * COLOR_COMPONENTS).fill(1),
    sizes: new Float32Array(STAR_COUNT).fill(2),
    twinklePhases: new Float32Array(STAR_COUNT).fill(0)
  };
}

async function nodeMaterialModules(): Promise<NodeMaterialModules> {
  const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  return { webgpu, tsl } as unknown as NodeMaterialModules;
}

type AttributeCarryingNode = { attribute: object };

describe("sized star points material", () => {
  /**
   * EVERY NUMBER IN THE GLSL HAS TO BE ONE THE MODULE DECLARES.
   *
   * Zero and one are permitted without being tuning constants: they are how GLSL
   * writes "none of this" and "all of this" — `max(0.0, ...)`, `1.0 - x`, the
   * `w` of a position — and forcing them through named constants would make the
   * shader harder to read while proving nothing. Every other literal has to come
   * from the module, which is what makes a retune move both implementations.
   */
  it("contains no numeric literal that is not one of the declared constants", () => {
    const declaredValues = new Set([2, 1, 16, 0.6, 0.03, 28, 10, 0.7071, 0.3, 0.85, 0.15, 1.4, 0.008]);
    const structuralLiterals = new Set([0, 1]);
    const LITERALS_IN_THE_SHADER = 28;
    // The lookbehind excludes digits that are part of an IDENTIFIER — `vec2`,
    // `vec3`, `vec4` — which are GLSL's type names rather than values.
    const numericLiterals = (starPointsFragmentShaderGlsl().match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(
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
   * THE TWO SIZING EXPRESSIONS ARE THE SAME EXPRESSION, and this asserts the
   * half of it that lives in text.
   *
   * The GLSL divides by `-mvPosition.z` and scales by a uniform the component
   * sets to half the drawing-buffer height. three's `setupVertexSprite` does
   * `pointSize.mul(scale.div(positionView.z.negate()))` under its own comment
   * *"follow WebGLRenderer's implementation"* (`PointsNodeMaterial.js:117`), so
   * the node path gets the same product from three's own code rather than from
   * a second copy of this arithmetic. What this test protects is that the
   * classic side is still the side three is being matched against.
   */
  it("attenuates the classic point size by the view depth, which is what three's sprite path also does", () => {
    expect(STAR_POINTS_VERTEX_SHADER).toContain("gl_PointSize = starSize * (uPointScale / -mvPosition.z)");
  });

  /**
   * THE GEOMETRY IS THIS LAYER'S OWN, and that is not tidiness.
   *
   * `Sprite` assigns a MODULE-LEVEL shared quad to every instance it constructs
   * (`Sprite.js:69-93`). Two star layers and a cloud layer attaching to that one
   * object would each overwrite the others, and the app mounts several.
   */
  it("builds a geometry of its own rather than sharing three's sprite quad", async () => {
    const first = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), 0);
    const second = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), 0);

    expect(first.geometry).not.toBe(second.geometry);
    expect(first.geometry.getAttribute("position")).toBeDefined();
    expect(first.geometry.getAttribute("uv")).toBeDefined();
  });

  it("draws one instance per star", async () => {
    const layer = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), 0);
    expect(layer.instanceCount).toBe(STAR_COUNT);
  });

  /**
   * **THE REGRESSION THIS FILE EXISTS FOR.**
   *
   * The first version of this module built its per-star values with
   * `new BufferAttribute(...)`, which `instancedBufferAttribute()` accepts and
   * then steps per VERTEX — so all N sprites re-read elements 0..3 of the star
   * buffer as if they were the quad's corners, every sprite became a pair of
   * screen-filling triangles, and the bloom chain returned the whole frame
   * white. It took a bisect on real hardware to find, because nothing throws.
   *
   * `perInstanceAttribute` is the fix and its doc comment is the explanation.
   * The centre is the one of the four the material exposes directly; the colour,
   * size and twinkle phase are built by the same call and are asserted against
   * three's own behaviour in `nodeMaterials.test.ts`, which is where a change in
   * three would show up first.
   */
  it("steps the star centres once per instance", async () => {
    const layer = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), FULL_SPIKE_STRENGTH);
    const positionNode = layer.material.positionNode as unknown as AttributeCarryingNode;

    expect(attributeStepsPerInstance(positionNode.attribute), "star centres must be per instance").toBe(true);
  });

  /**
   * And the other half of the same trap: the QUAD's own corners must NOT be
   * instanced, or all four vertices collapse onto one point and the sprite has
   * no area. One constructor away from the assertion above, in both directions.
   */
  it("steps the quad's own corners once per vertex", async () => {
    const layer = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), 0);

    expect(attributeStepsPerInstance(layer.geometry.getAttribute("position"))).toBe(false);
    expect(attributeStepsPerInstance(layer.geometry.getAttribute("uv"))).toBe(false);
  });

  /**
   * The node material is a node material, and carries the three graphs the
   * sprite path reads. A silent fall-through to a stock `PointsNodeMaterial`
   * with no `sizeNode` would render every star at one pixel — visible, but only
   * as "the sky looks dimmer", which is not a report anyone would trace here.
   */
  it("expresses the star as position, size and colour graphs", async () => {
    const layer = buildStarPointsNodeLayer(await nodeMaterialModules(), starLayerAttributes(), FULL_SPIKE_STRENGTH);
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
