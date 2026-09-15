import { InstancedBufferAttribute } from "three";
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
 * The per-instance attribute that three will actually step once per instance.
 *
 * **THIS FUNCTION EXISTS BECAUSE `instancedBufferAttribute()` DOES NOT MAKE AN
 * ATTRIBUTE INSTANCED, AND THE SYMPTOM IS A WHITE SCREEN RATHER THAN AN ERROR.**
 * Passing it a raw `Float32Array` or a plain `BufferAttribute` — the two shapes
 * its own JSDoc lists first — produces an attribute the GPU steps per VERTEX.
 * Three places in three have to agree for instancing to happen, and only one
 * input makes all three agree:
 *
 * 1. `createBufferAttribute`'s general return is
 *    `new BufferAttributeNode(...).setUsage(usage)` — **`.setInstanced(instanced)`
 *    is never called** (`BufferAttributeNode.js:387`). Only the `mat3` and `mat4`
 *    branches above it call it, so the `true` that the function's own name
 *    promises is dropped for every float, vec2 and vec3.
 * 2. The one surviving route into `node.instanced` is the constructor, which
 *    reads it off the value: `this.instanced = value.isInstancedBufferAttribute`
 *    (`:146`). A plain `BufferAttribute` leaves it undefined.
 * 3. A raw array is worse than useless. `setup()` wraps it in a plain
 *    `InterleavedBuffer` and sets `isInstancedBufferAttribute` on the ATTRIBUTE
 *    (`:355`) — but for an interleaved attribute both backends read the flag off
 *    the BUFFER: `data.isInstancedInterleavedBuffer` in
 *    `WebGPUAttributeUtils.js:307` and again in `WebGLBackend.js:2555`. three's
 *    own `@TODO: Add a possible: InstancedInterleavedBufferAttribute`, one line
 *    above, is the admission that this path cannot be instanced at all.
 *
 * A real, non-interleaved `InstancedBufferAttribute` is the only input that
 * satisfies every one of them: WebGPU then takes `WebGPUAttributeUtils.js:312`
 * and emits `stepMode: 'instance'`, and the WebGL2 backend takes
 * `WebGLBackend.js:2551` and calls `vertexAttribDivisor`.
 *
 * **WHAT IT LOOKS LIKE WHEN IT IS WRONG, because the symptom points nowhere
 * near the cause.** A per-vertex step makes all N instances re-read elements
 * 0..3 of the instance buffer as though they were the quad's four corners.
 * Those elements are star world positions — hundreds of units across — so every
 * sprite becomes a pair of screen-filling triangles, and the bloom chain
 * downsamples the whole frame through a mip pyramid and returns it as white.
 * Setting `count = 1` draws exactly one such quad and the frame survives, which
 * is why bisecting on `count` found the boundary and bisecting on the shader
 * maths never could: nothing in the shader was wrong.
 *
 * `nodeMaterials.test.ts` asserts this against three's real code rather than
 * against this description, so a version bump that changes any of the three
 * lines above fails a unit test instead of a screenshot.
 */
export function perInstanceAttribute(values: Float32Array, componentsPerInstance: number): InstancedBufferAttribute {
  return new InstancedBufferAttribute(values, componentsPerInstance);
}

/**
 * Whether the GPU will step this attribute once per instance, asked the way the
 * two backends ask it.
 *
 * This is `perInstanceAttribute`'s contract written as code, and it lives beside
 * it rather than in the three test files that check it, because three copies of
 * a predicate about someone else's internals is three copies that drift the
 * first time three moves a line. Nothing at runtime calls it — each backend
 * applies its own copy, at the lines named below — and that is the point: it
 * exists so a test can ask the same question the renderer will, instead of
 * restating the answer.
 *
 *   WebGPU  `WebGPUAttributeUtils.js:307` picks the flag off the BUFFER for an
 *           interleaved attribute and `:312` off the ATTRIBUTE otherwise, then
 *           emits `stepMode: 'instance'` or `'vertex'`.
 *   WebGL2  `WebGLBackend.js:2551` and `:2555` make the same two-branch choice
 *           and call `vertexAttribDivisor` only if one of them holds.
 *
 * The interleaved branch is what makes the raw-array overload unfixable: it
 * produces an interleaved attribute, so both backends look for the flag on a
 * buffer that never carries one.
 */
export function attributeStepsPerInstance(attribute: object): boolean {
  const flags = attribute as {
    isInterleavedBufferAttribute?: boolean;
    isInstancedBufferAttribute?: boolean;
    data?: { isInstancedInterleavedBuffer?: boolean };
  };
  if (flags.isInterleavedBufferAttribute === true) {
    return flags.data?.isInstancedInterleavedBuffer === true;
  }
  return flags.isInstancedBufferAttribute === true;
}

/**
 * Drops the cache. **Tests only** — there is no reason to unload these at
 * runtime, and a component that saw the modules once must keep seeing them.
 */
export function resetNodeMaterialModulesForTesting(): void {
  nodeMaterialModules = null;
  nodeMaterialModulesPromise = null;
}
