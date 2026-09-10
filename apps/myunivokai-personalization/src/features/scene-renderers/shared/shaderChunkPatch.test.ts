import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ShaderChunk, ShaderLib } from "three";
import { describe, expect, it, vi } from "vitest";
import { requireShaderChunks, SHADER_CHUNK_MARKERS, type ShaderChunkMarker } from "./shaderChunkPatch";

/**
 * THE UPGRADE GUARD.
 *
 * Nine shader patches inject into six of three.js's `#include <chunk>`
 * directives. If a release renames one, or stops emitting it from the material
 * this app patches, `String.replace` returns the shader unchanged and says
 * nothing: the patch becomes a no-op, the scene still draws, and every other
 * check in this repository passes.
 *
 * So the markers are asserted against three's own shipped `ShaderChunk` and
 * `ShaderLib` — which means this test fails on the UPGRADE COMMIT, before any
 * browser is opened, which is where an upgrade should fail. Added deliberately
 * ahead of the 0.171.0 → 0.185.1 bump so that it is the bump being checked and
 * not the guard.
 *
 * Both halves matter, and they fail for different reasons:
 *
 *   - the chunk exists in the library at all — catches a rename
 *   - the STANDARD material's generated shader actually contains the directive,
 *     in the stage the patch injects into — catches three inlining a chunk,
 *     moving it behind an `#ifdef`, or dropping it from that material
 */

/** Which stage each marker is injected into. Every patch here targets `MeshStandardMaterial`. */
const MARKER_STAGES: ReadonlyArray<{ marker: ShaderChunkMarker; stage: "vertex" | "fragment" }> = [
  { marker: SHADER_CHUNK_MARKERS.common, stage: "vertex" },
  { marker: SHADER_CHUNK_MARKERS.common, stage: "fragment" },
  { marker: SHADER_CHUNK_MARKERS.beginVertex, stage: "vertex" },
  { marker: SHADER_CHUNK_MARKERS.worldPositionVertex, stage: "vertex" },
  { marker: SHADER_CHUNK_MARKERS.mapFragment, stage: "fragment" },
  { marker: SHADER_CHUNK_MARKERS.toneMappingFragment, stage: "fragment" },
  { marker: SHADER_CHUNK_MARKERS.colorSpaceFragment, stage: "fragment" }
];

/** `#include <x>` → `x`. */
function chunkNameOf(marker: ShaderChunkMarker): string {
  const name = marker.match(/^#include <([a-z_]+)>$/)?.[1];
  expect(name, `${marker} is not a well-formed include directive`).toBeDefined();
  return name as string;
}

/**
 * Every source file that patches a shader. Listed rather than globbed so that a
 * new patch site has to be added here on purpose — a glob would silently accept
 * a tenth patch that bypasses the guard, which is the same class of
 * quiet-omission bug this whole file is about.
 */
const PATCHING_SOURCE_FILES = [
  "../forest/forestModels.ts",
  "../ocean/oceanCaustics.ts",
  "../ocean/oceanRigFauna.ts",
  "../ocean/oceanRigFlora.ts",
  "../ocean/oceanRigTerrain.ts"
] as const;

function readPatchingSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("shader chunk patch guard", () => {
  it("every marker this app injects at is still a chunk three ships", () => {
    for (const marker of Object.values(SHADER_CHUNK_MARKERS)) {
      const chunkName = chunkNameOf(marker);
      expect(ShaderChunk, `three no longer ships a ${chunkName} chunk`).toHaveProperty(chunkName);
    }
  });

  it("the standard material still emits each marker in the stage its patch injects into", () => {
    for (const { marker, stage } of MARKER_STAGES) {
      const shaderSource = stage === "vertex" ? ShaderLib.standard.vertexShader : ShaderLib.standard.fragmentShader;
      expect(
        shaderSource.includes(marker),
        `MeshStandardMaterial's ${stage} shader no longer contains ${marker}; the patches that inject there are now no-ops`
      ).toBe(true);
    }
  });

  /**
   * The convention test. Without it the guard decays: the next patch is written
   * as a bare `.replace("#include <...>")`, is not covered, and fails silently
   * exactly the way the guarded ones no longer do.
   */
  it("no shader patch replaces a raw include directive outside the guard", () => {
    const offences: string[] = [];
    for (const relativePath of PATCHING_SOURCE_FILES) {
      const source = readPatchingSource(relativePath);
      for (const [lineIndex, line] of source.split("\n").entries()) {
        if (/\.replace\(\s*"#include </.test(line)) {
          offences.push(`${relativePath}:${lineIndex + 1}`);
        }
      }
    }
    expect(offences, "these sites bypass SHADER_CHUNK_MARKERS and are unguarded").toEqual([]);
  });

  it("every file that patches a shader routes its chains through the guard", () => {
    const unguarded: string[] = [];
    for (const relativePath of PATCHING_SOURCE_FILES) {
      const source = readPatchingSource(relativePath);
      const patchesAShader = source.includes("onBeforeCompile");
      if (patchesAShader && !source.includes("requireShaderChunks(")) {
        unguarded.push(relativePath);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("reports the missing marker by name and leaves the shader alone", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const shaderWithoutTheMarker = "void main() {}";
    const returned = requireShaderChunks(shaderWithoutTheMarker, "a test patch", [
      SHADER_CHUNK_MARKERS.beginVertex
    ]);
    expect(returned).toBe(shaderWithoutTheMarker);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toContain("a test patch");
    expect(consoleError.mock.calls[0][0]).toContain(SHADER_CHUNK_MARKERS.beginVertex);
    consoleError.mockRestore();
  });

  it("says nothing when every marker is present", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    requireShaderChunks(ShaderLib.standard.vertexShader, "a test patch", [
      SHADER_CHUNK_MARKERS.common,
      SHADER_CHUNK_MARKERS.beginVertex
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
