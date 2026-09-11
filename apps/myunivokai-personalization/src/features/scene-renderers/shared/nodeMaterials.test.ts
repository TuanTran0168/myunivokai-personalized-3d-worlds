import { afterEach, describe, expect, it } from "vitest";
import {
  isNodeRenderer,
  loadNodeMaterialModules,
  loadedNodeMaterialModules,
  nodeMaterialModulesFor,
  resetNodeMaterialModulesForTesting
} from "./nodeMaterials";

/**
 * THE TWO QUESTIONS THIS MODULE ANSWERS ARE DIFFERENT QUESTIONS, AND CONFLATING
 * THEM IS THE BUG IT EXISTS TO PREVENT.
 *
 * "Have the node modules been loaded" and "is this scene being drawn by a node
 * renderer" happen to give the same answer today, because the only thing that
 * loads them is the node renderer's own construction. A material factory that
 * relied on that coincidence would build node materials for a classic renderer
 * the first time anything else imported `three/webgpu` — and `WebGLRenderer`
 * cannot draw one, so the scene would go blank with nothing thrown.
 */
describe("node material modules", () => {
  afterEach(() => {
    resetNodeMaterialModulesForTesting();
  });

  /**
   * `WebGLRenderer` has no `backend` property at all, so its ABSENCE is the
   * identification.
   *
   * **THESE ARE SHAPE ASSERTIONS AND NOT RENDERER ONES, WHICH IS WORTH SAYING
   * PLAINLY.** Neither renderer can be constructed here: `WebGLRenderer` calls
   * `document.createElementNS` for its canvas and these tests run under node
   * with no DOM, and `WebGPURenderer` needs a GPU adapter. Testing the
   * prototypes instead does not help either — three assigns every field,
   * `isWebGLRenderer` and `render` included, inside the CONSTRUCTOR, so both
   * prototypes are effectively empty and `isNodeRenderer` would pass on
   * anything.
   *
   * So what is pinned here is the LOGIC against the shapes three's renderers
   * present. That the real ones present those shapes is asserted where real
   * ones exist: `ParityHarnessBridge.describeBackend` reads the same property,
   * and `e2e/scene-parity.spec.ts` fails a leg whose backend is not the one it
   * asked for — which is the assertion that would catch this being wrong.
   */
  it("does not mistake the classic renderer for a node renderer", () => {
    expect(isNodeRenderer({ isWebGLRenderer: true, domElement: {}, shadowMap: {} })).toBe(false);
  });

  it("treats anything carrying a backend as a node renderer", () => {
    // `WebGPURenderer` cannot be constructed without a GPU adapter, so the
    // shape it is identified BY is what is asserted — which is also exactly
    // what `isNodeRenderer` reads and all it reads.
    expect(isNodeRenderer({ backend: { isWebGLBackend: true } })).toBe(true);
    expect(isNodeRenderer({ backend: { isWebGPUBackend: true } })).toBe(true);
  });

  /**
   * A `forceWebGL` node renderer draws node graphs through a WebGL2 backend, and
   * it is the configuration roughly a fifth of users land on after the renderer
   * swap. Choosing the material by which GRAPHICS API is in play rather than by
   * which MATERIAL SYSTEM is would be wrong for precisely that case, and it
   * would be wrong on the machine nobody develops on.
   */
  it("counts a WebGL-backed node renderer as a node renderer", () => {
    expect(isNodeRenderer({ backend: { isWebGLBackend: true }, coordinateSystem: 2000 })).toBe(true);
  });

  it("is not confused by null, undefined or a plain object", () => {
    expect(isNodeRenderer(null)).toBe(false);
    expect(isNodeRenderer(undefined)).toBe(false);
    expect(isNodeRenderer({})).toBe(false);
  });

  it("reports no modules until something loads them", () => {
    expect(loadedNodeMaterialModules()).toBe(null);
  });

  it("caches the modules so two callers get one copy", async () => {
    const [first, second] = await Promise.all([loadNodeMaterialModules(), loadNodeMaterialModules()]);
    expect(first).toBe(second);
    expect(loadedNodeMaterialModules()).toBe(first);
    expect(typeof first.webgpu.MeshStandardNodeMaterial).toBe("function");
    expect(typeof first.tsl.texture).toBe("function");
  });

  /**
   * THE CONFLATION, ASSERTED AS NOT HAPPENING. Modules loaded plus a classic
   * renderer still means "build the classic material".
   */
  it("returns null for a classic renderer even once the modules are loaded", async () => {
    await loadNodeMaterialModules();
    expect(loadedNodeMaterialModules()).not.toBe(null);
    expect(nodeMaterialModulesFor({ isWebGLRenderer: true })).toBe(null);
  });

  /**
   * And the other direction: a node renderer with nothing loaded yet gets null
   * rather than a half-built material. There is no such window in practice —
   * the renderer cannot exist before `three/webgpu` has — but a factory that
   * depends on that ordering silently is one that breaks when it changes.
   */
  it("returns null for a node renderer before the modules have loaded", () => {
    expect(nodeMaterialModulesFor({ backend: { isWebGPUBackend: true } })).toBe(null);
  });

  it("returns the modules for a node renderer once they have loaded", async () => {
    const modules = await loadNodeMaterialModules();
    expect(nodeMaterialModulesFor({ backend: { isWebGPUBackend: true } })).toBe(modules);
  });
});
