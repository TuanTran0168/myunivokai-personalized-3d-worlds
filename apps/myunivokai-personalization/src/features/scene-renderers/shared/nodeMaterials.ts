import type * as ThreeTSL from "three/tsl";
import type * as ThreeWebGPU from "three/webgpu";

/**
 * ONE MATERIAL, TWO IMPLEMENTATIONS, AND THE MACHINERY FOR CHOOSING BETWEEN
 * THEM. This is what §26 Phases 6-8 need before a single shader is ported.
 *
 * **THE NODE PATH IS ALL-OR-NOTHING.** `WebGPURenderer` cannot draw a raw GLSL
 * `ShaderMaterial`, and `onBeforeCompile` does not exist on a node material —
 * there is no GLSL string to patch, because the shader is assembled from a node
 * graph. So a scene is either entirely node materials or it cannot run on the
 * node renderer at all. Meanwhile `WebGLRenderer` is what every visitor gets
 * and will keep getting until Phase 9, and it cannot draw a node material.
 *
 * Both have to exist, side by side, until the swap. That is not a transitional
 * inconvenience to be minimised — it is the ONLY safe way to do this migration,
 * because it is what lets `scene-parity.spec.ts` render the same scene through
 * both and subtract the frames. A port with no baseline to compare against is a
 * rewrite.
 *
 * THE SHAPE EVERY PORTED MATERIAL TAKES:
 *
 *     export function createFoliageMaterial(source, renderer) {
 *       const modules = loadedNodeMaterialModules();
 *       if (isNodeRenderer(renderer) && modules) return nodeVariant(source, modules);
 *       return shaderVariant(source);
 *     }
 *
 * WHY THE MODULES ARE CACHED RATHER THAN IMPORTED. `three/webgpu` and
 * `three/tsl` are a SECOND FULL COPY of three, about 1 MB, and a static import
 * anywhere in the scene tree puts it in the main bundle of every visitor — to
 * serve a renderer that today only the parity harness mounts. Every existing
 * reference to them in this app is a dynamic `import()` for exactly that reason.
 *
 * But a React component cannot `await` in its render, and a material has to be
 * constructed synchronously — `forestModels.ts` builds them while walking a
 * parsed GLB. So the modules are loaded ONCE, by whoever creates the node
 * renderer, and read back synchronously afterwards. `UniverseCanvas`'s `gl`
 * factory is that whoever: it is already async, already awaits
 * `import("three/webgpu")` to construct the renderer, and fiber awaits it before
 * mounting a single child. By the time any component runs, the cache is warm.
 *
 * `loadedNodeMaterialModules()` returning null therefore means "this is not the
 * node path", and every caller treats it the same as `isNodeRenderer` being
 * false. It is not an error state and must not throw: a scene that renders with
 * its classic materials is correct on the classic renderer.
 */

/** What a ported material needs from the two node modules, and nothing else. */
export type NodeMaterialModules = {
  webgpu: typeof ThreeWebGPU;
  tsl: typeof ThreeTSL;
};

let nodeMaterialModules: NodeMaterialModules | null = null;
let nodeMaterialModulesPromise: Promise<NodeMaterialModules> | null = null;

/**
 * Loads and caches `three/webgpu` and `three/tsl`.
 *
 * Idempotent, and the promise is cached rather than only the result: two
 * concurrent callers must not start two imports, because the module registry
 * would dedupe them but the `Promise.all` would not, and a second copy of the
 * node material classes would fail every `instanceof` against the first.
 */
export async function loadNodeMaterialModules(): Promise<NodeMaterialModules> {
  if (nodeMaterialModules) return nodeMaterialModules;
  if (!nodeMaterialModulesPromise) {
    nodeMaterialModulesPromise = Promise.all([import("three/webgpu"), import("three/tsl")]).then(([webgpu, tsl]) => {
      nodeMaterialModules = { webgpu, tsl };
      return nodeMaterialModules;
    });
  }
  return nodeMaterialModulesPromise;
}

/**
 * The cached modules, or null if nothing has loaded them yet.
 *
 * Synchronous on purpose — see the header. A null here is never an error: it is
 * the ordinary answer on the classic renderer, which is every visitor today.
 */
export function loadedNodeMaterialModules(): NodeMaterialModules | null {
  return nodeMaterialModules;
}

/**
 * Whether this renderer assembles shaders from node graphs.
 *
 * `WebGLRenderer` has no `backend` property at all, so its ABSENCE is the
 * identification rather than a missing case — the same test
 * `ParityHarnessBridge.describeBackend` makes, for the same reason: it asks the
 * instance rather than trusting what was requested. `WebGPURenderer` with
 * `forceWebGL: true` is still a node renderer; it draws node graphs through a
 * WebGL2 backend, and a material chosen by which GRAPHICS API is in play rather
 * than by which MATERIAL SYSTEM is in play would be wrong for exactly that
 * configuration — which is the one ~20% of users would land on after Phase 9.
 */
export function isNodeRenderer(renderer: unknown): boolean {
  return (renderer as { backend?: unknown } | null | undefined)?.backend !== undefined;
}

/**
 * Both conditions at once, which is what every call site actually wants.
 *
 * Kept as one function rather than two checks at seventeen call sites, because
 * the two can disagree for one frame — a node renderer whose modules have not
 * finished loading — and a call site that checked only `isNodeRenderer` would
 * construct nothing. There is no such window in practice, since the renderer
 * cannot exist before `three/webgpu` has loaded, but a material factory that
 * depends on that ordering silently is a material factory that breaks when the
 * ordering changes.
 */
export function nodeMaterialModulesFor(renderer: unknown): NodeMaterialModules | null {
  return isNodeRenderer(renderer) ? loadedNodeMaterialModules() : null;
}

/**
 * Drops the cache. **Tests only** — there is no reason to unload these at
 * runtime, and a component that saw the modules once must keep seeing them.
 */
export function resetNodeMaterialModulesForTesting(): void {
  nodeMaterialModules = null;
  nodeMaterialModulesPromise = null;
}
