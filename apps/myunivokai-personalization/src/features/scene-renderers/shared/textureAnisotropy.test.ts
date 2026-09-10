import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY, maximumTextureAnisotropy } from "./textureAnisotropy";

/**
 * THE FIRST THING THAT ACTUALLY BROKE UNDER A WebGPURenderer.
 *
 * `capabilities.getMaxAnisotropy()` exists on `WebGLRenderer` and nowhere else,
 * so reading through `capabilities` on a `WebGPURenderer` throws and
 * `WebGLFailureBoundary` replaces the entire canvas. It was found by pointing
 * Phase 4's parity harness at the app, and only by that: the page's own console
 * said nothing, and the failure looked like "the harness never appeared".
 *
 * The convention test at the bottom is the part that keeps this fixed. A helper
 * nothing is required to use decays into a helper two of five sites use — and
 * five is how many there were, after an initial grep truncated by `head` said
 * two.
 */

const WEBGPU_RENDERER_WITHOUT_CAPABILITIES = {};

describe("maximum texture anisotropy", () => {
  it("uses the renderer's own limit when it has one", () => {
    expect(maximumTextureAnisotropy({ capabilities: { getMaxAnisotropy: () => 8 } })).toBe(8);
    expect(maximumTextureAnisotropy({ capabilities: { getMaxAnisotropy: () => 16 } })).toBe(16);
  });

  it("falls back when the renderer has no capabilities at all", () => {
    // A WebGPURenderer. This is the case that took the canvas down.
    expect(maximumTextureAnisotropy(WEBGPU_RENDERER_WITHOUT_CAPABILITIES)).toBe(
      MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY
    );
  });

  it("falls back on the other two ways this can go wrong, not only the one that was seen", () => {
    expect(maximumTextureAnisotropy({ capabilities: {} })).toBe(MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY);
    expect(maximumTextureAnisotropy({ capabilities: { getMaxAnisotropy: () => Number.NaN } })).toBe(
      MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY
    );
    expect(maximumTextureAnisotropy({ capabilities: { getMaxAnisotropy: () => 0 } })).toBe(
      MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY
    );
    expect(maximumTextureAnisotropy(undefined)).toBe(MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY);
    expect(maximumTextureAnisotropy(null)).toBe(MAXIMUM_ANISOTROPY_WITHOUT_A_LIMIT_QUERY);
  });

  /**
   * Listed rather than globbed, for the same reason `shaderChunkPatch.test.ts`
   * lists its patch sites: a glob would silently accept a sixth site that
   * bypasses the helper, which is precisely the omission this file exists to
   * close.
   */
  it("is the only way this app reads the anisotropy limit", () => {
    const sourceFiles = [
      "../ocean/oceanRigSurface.ts",
      "../ocean/oceanRigTerrain.ts",
      "../solar-system/DistantBlackHole.tsx",
      "./textureQuality.ts"
    ];
    const offences: string[] = [];
    for (const relativePath of sourceFiles) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
      for (const [lineIndex, line] of source.split("\n").entries()) {
        if (line.includes("capabilities.getMaxAnisotropy")) {
          offences.push(`${relativePath}:${lineIndex + 1}`);
        }
      }
    }
    expect(offences, "these read through capabilities directly and will throw on a WebGPURenderer").toEqual([]);
  });
});
