import { Color, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import { foliageMapFragmentGlsl, recolorableFoliageMaterial } from "./forestFoliageMaterial";
import type { NodeMaterialModules } from "@/features/scene-renderers/shared/nodeMaterials";

/**
 * THE TWO IMPLEMENTATIONS OF ONE MATERIAL MUST NOT DRIFT, AND A RENDERED FRAME
 * WILL NOT TELL YOU WHEN THEY DO.
 *
 * This is the shape every one of §26 Phases 6-8's eighteen ports needs. Each of
 * them exists twice — GLSL for `WebGLRenderer`, a node graph for the node
 * renderer — and the failure mode is not a crash. It is two canvases that agree
 * to within a few units of 255 and are nonetheless rendering different
 * arithmetic, which `scene-parity.spec.ts` would report as a small residual
 * divergence indistinguishable from the ones it already tolerates.
 *
 * So the numbers are declared once and BOTH implementations are built from
 * them, and this file checks the one thing that structure cannot enforce by
 * itself: that nobody typed a literal into the shader string.
 */

function foliageSourceMaterial() {
  const source = new MeshStandardMaterial({
    map: new Texture(),
    transparent: true,
    alphaTest: 0.5,
    roughness: 0.8
  });
  return source;
}

describe("forest foliage material", () => {
  /**
   * EVERY NUMBER IN THE GLSL HAS TO BE ONE THE MODULE DECLARES.
   *
   * A direct comparison against a fixed string would pass while saying nothing —
   * it would be the same literal typed twice. This instead extracts every
   * numeric literal the shader contains and requires each to be a value the
   * module's constants can produce, so tuning a constant moves the shader and
   * typing a number into the shader fails here.
   *
   * The permitted set is the five tuning constants plus the vector and swizzle
   * arithmetic GLSL needs to express them.
   */
  it("contains no numeric literal that is not one of the declared constants", () => {
    const declaredValues = new Set([0.299, 0.587, 0.114, 0.72, 1.12]);
    // The lookbehind excludes digits that are part of an IDENTIFIER — `vec3`,
    // `vec4`, `texture2D` — which are GLSL's type names rather than values.
    // Without it this counts eight numbers and three of them are spelling.
    const numericLiterals = (foliageMapFragmentGlsl().match(/(?<![A-Za-z0-9_])\d+(?:\.\d+)?/g) ?? []).map(Number);

    expect(numericLiterals.length, "the shader should still carry its five tuning numbers").toBe(5);
    for (const literal of numericLiterals) {
      expect(declaredValues.has(literal), `${literal} is in the shader but is not a declared constant`).toBe(true);
    }
  });

  /**
   * The patch has to REPLACE the stock map multiply, not sit beside it.
   *
   * `<map_fragment>` is what multiplies the leaf texture's own hue into
   * `diffuseColor`, and that hue is the one thing this material exists to
   * discard. A patch that appended instead of replacing would put the green back
   * under the autumn tint and turn the canopy muddy — the original complaint.
   */
  it("replaces the stock map multiply rather than adding to it", () => {
    const glsl = foliageMapFragmentGlsl();
    expect(glsl).toContain("diffuseColor.rgb *= leafLuma");
    expect(glsl).not.toContain("diffuseColor *= sampledDiffuseColor");
    expect(glsl).toContain("#ifdef USE_MAP");
    expect(glsl).toContain("#endif");
  });

  it("builds the classic material with the patch and a shared program cache key", () => {
    const material = recolorableFoliageMaterial(foliageSourceMaterial(), null);
    expect(material.metalness).toBe(0);
    expect(material.color.getHexString()).toBe(new Color("#FFFFFF").getHexString());
    expect(typeof material.onBeforeCompile).toBe("function");
    // One program for all foliage despite per-instance colours. Without this,
    // every season tint would compile its own.
    expect(material.customProgramCacheKey?.()).toBe("forest-foliage-recolor");
  });

  /**
   * The classic patch is applied through `requireShaderChunks`, so a chunk three
   * renames turns it into a LOUD no-op rather than a silent one. Exercised here
   * with a shader that carries the marker, because the failure this guards
   * against is that the marker one day does not.
   */
  it("applies the patch to a shader that carries the marker", () => {
    const material = recolorableFoliageMaterial(foliageSourceMaterial(), null);
    const shader = { vertexShader: "", fragmentShader: "void main() {\n#include <map_fragment>\n}" };
    material.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(shader.fragmentShader).toContain("leafLuma");
  });

  /**
   * The node variant, built against the real `three/webgpu` and `three/tsl`.
   *
   * Imported dynamically HERE and nowhere in the app: those modules are a second
   * full copy of three, and the whole point of `nodeMaterials.ts` is that the
   * bundle never pays for it. A test can.
   */
  it("builds the node material with a colorNode instead of an onBeforeCompile patch", async () => {
    const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
    const modules = { webgpu, tsl } as unknown as NodeMaterialModules;

    const material = recolorableFoliageMaterial(foliageSourceMaterial(), modules);
    const nodeMaterial = material as unknown as { colorNode?: unknown; isNodeMaterial?: boolean };

    expect(nodeMaterial.isNodeMaterial, "the node path must not fall back to the classic material").toBe(true);
    expect(nodeMaterial.colorNode, "the recolour is expressed as colorNode on this path").toBeDefined();
    expect(material.metalness).toBe(0);
    expect(material.color.getHexString()).toBe(new Color("#FFFFFF").getHexString());
  });

  /**
   * A source material with no map gets no recolour on EITHER path, and the node
   * path must not set an empty `colorNode` for it.
   *
   * The GLSL guards this with `#ifdef USE_MAP`, which three defines only when a
   * map is bound. The node graph has no preprocessor, so the guard is a
   * JavaScript branch — and a `colorNode` built from an absent texture would be
   * a graph that samples nothing.
   */
  it("leaves a map-less material alone on the node path", async () => {
    const [webgpu, tsl] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
    const modules = { webgpu, tsl } as unknown as NodeMaterialModules;

    const material = recolorableFoliageMaterial(new MeshStandardMaterial({ roughness: 0.8 }), modules);
    expect((material as unknown as { colorNode?: unknown }).colorNode ?? null).toBe(null);
  });
});
