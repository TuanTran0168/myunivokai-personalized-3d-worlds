/**
 * EVERY `onBeforeCompile` PATCH IN THIS APP GOES THROUGH HERE, SO THAT A
 * PATCH WHICH STOPS MATCHING SAYS SO.
 *
 * The nine shader patches work by string replacement against three.js's own
 * `#include <chunk>` directives. `String.prototype.replace` on a marker that is
 * not present returns the source **unchanged and without complaint**, so a
 * chunk that three renames or stops emitting turns a patch into a no-op —
 * silently, in production, in one family, on one material.
 *
 * That is the exact failure this project keeps rediscovering: the forest's
 * seasonal leaf recolour, the ocean's caustics, the seabed's slope rock and the
 * kelp's height gradient would each simply stop being applied, the scene would
 * still render, and nothing anywhere would report it. `npm test` passes,
 * `tsc` passes, `next build` passes, and the frame is wrong.
 *
 * Written for the three.js 0.171.0 → 0.185.1 upgrade, where fifteen releases of
 * chunk churn is precisely the event this guards against — and deliberately
 * added BEFORE the version bump, so it is the upgrade that gets checked rather
 * than the guard.
 *
 * TWO LAYERS, because they catch different things:
 *
 * - This function, at runtime: a marker missing from the shader three actually
 *   generated for THIS material. Loud (`console.error`), and it returns the
 *   source unchanged so the scene still draws — a thrown error here would take
 *   the whole canvas down over a cosmetic patch, and `WebGLFailureBoundary`
 *   exists for real failures.
 * - `shaderChunkPatch.test.ts`, at test time: a marker missing from three's
 *   shipped `ShaderLib` at all. That fails the build on the upgrade commit,
 *   before anything renders, which is where an upgrade should fail.
 */

/**
 * The chunk markers this app injects at, named once.
 *
 * Six of them across nine patches, which is the fact §7 of the WebGPU
 * feasibility report leans on: a small, fixed set of injection points is what
 * makes the eventual port to node slots mechanical rather than exploratory.
 */
export const SHADER_CHUNK_MARKERS = {
  /** Declarations — uniforms, attributes, varyings. Both stages. */
  common: "#include <common>",
  /** Vertex position, after `transformed` exists and before it is projected. */
  beginVertex: "#include <begin_vertex>",
  /** World-space position, for anything that needs it in the fragment stage. */
  worldPositionVertex: "#include <worldpos_vertex>",
  /** Where the diffuse map is multiplied into `diffuseColor`. */
  mapFragment: "#include <map_fragment>",
  /** The tone curve. Anything injected before it is tone mapped with the frame. */
  toneMappingFragment: "#include <tonemapping_fragment>",
  /** The output transfer function. After it, values are display-encoded. */
  colorSpaceFragment: "#include <colorspace_fragment>"
} as const;

export type ShaderChunkMarker = (typeof SHADER_CHUNK_MARKERS)[keyof typeof SHADER_CHUNK_MARKERS];

/**
 * Checks that every chunk a patch is about to replace is actually in the shader,
 * and returns the shader unchanged so it can be used inline:
 *
 *     shader.vertexShader = requireShaderChunks(shader.vertexShader, "oceanCaustics vertex", [
 *       SHADER_CHUNK_MARKERS.common,
 *       SHADER_CHUNK_MARKERS.worldPositionVertex
 *     ])
 *       .replace(SHADER_CHUNK_MARKERS.common, ...)
 *       .replace(SHADER_CHUNK_MARKERS.worldPositionVertex, ...);
 *
 * It guards the chain rather than wrapping each `.replace()`, and that shape was
 * chosen for a reason worth stating: rewriting seventeen call sites that carry
 * multi-line GLSL template literals is a change with real odds of a typo inside
 * a shader string, and a typo there is a worse bug than the one being guarded
 * against. The check happens BEFORE the replacements, which is where the
 * information is — most of these patches re-emit the marker they replace, so
 * inspecting the result afterwards proves nothing.
 *
 * `patchName` is required rather than optional: the value of the error is that
 * it names which patch, in which stage, stopped being applied. "A replacement
 * did not match" is not actionable.
 *
 * Reports and continues rather than throwing. A thrown error inside
 * `onBeforeCompile` takes the whole canvas down over a cosmetic patch, and
 * `WebGLFailureBoundary` exists for real failures; a scene that draws without
 * its leaf recolour is worth more than a blank rectangle. It returns the number
 * of misses through the console, not through a value, because every caller is
 * an assignment expression.
 */
export function requireShaderChunks(
  shaderSource: string,
  patchName: string,
  markers: readonly ShaderChunkMarker[]
): string {
  const missing = markers.filter((marker) => !shaderSource.includes(marker));
  if (missing.length > 0) {
    console.error(
      `${patchName}: three.js no longer emits ${missing.join(", ")} in this shader, so ${
        missing.length === 1 ? "that part of the patch was" : "those parts of the patch were"
      } NOT applied. The scene will render without it. See shared/shaderChunkPatch.ts.`
    );
  }
  return shaderSource;
}
