import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * EVERY SHADER PATCH IN THIS APP GOES THROUGH `applyClassicShaderPatch`, SO THAT
 * A PATCH WITH NO NODE ARM SAYS SO INSTEAD OF DISAPPEARING.
 *
 * `onBeforeCompile` does not exist on a node material. Assigning it is legal
 * JavaScript, the property sits on the object, three never reads it, and the
 * effect is simply gone — no refusal, no console line, no thrown error. That is
 * worse than a refused `ShaderMaterial`, which at least prints its refusal and
 * drops the draw: a dropped patch leaves a material that renders correctly in
 * every respect except the one the patch was for.
 *
 * §26 Phase 7 gave all nine of this app's patches a node arm. This test is what
 * stops the tenth from being written without one. It is a ratchet, in the same
 * shape as `threeSubpathImports.test.ts`: it scans the source the bundler
 * actually builds, so a patch added tomorrow is covered the moment it is
 * written.
 *
 * It checks the SITE, not the behaviour — a direct assignment fails here, and
 * whether the node arm is correct is each material's own test. That division is
 * deliberate: this one has to be cheap enough to never be the reason someone
 * skips running it.
 */

const SCENE_RENDERERS_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Test files are excluded because the bundler builds none of them, and because
 * a test that quotes the forbidden form is indistinguishable from one that uses
 * it — the same trap `threeSubpathImports.test.ts` fell into first.
 */
const EXCLUDED_FILE_SUFFIXES = [".test.ts", ".test.tsx"];

/**
 * The guard itself has to perform the assignment it forbids everywhere else.
 * Named as a path fragment rather than matched loosely, so moving the file
 * fails this test rather than quietly widening the exemption.
 */
const PATCH_HELPER_FILE = "shared/shaderChunkPatch.ts";

/**
 * Matches an ASSIGNMENT to the hook and not a read of it.
 *
 * `const previous = material.onBeforeCompile` is how the two chained patches on
 * the seabed avoid clobbering each other, and it is correct — the lookahead for
 * `=` without a second `=` is what tells the two apart.
 */
const DIRECT_ASSIGNMENT_PATTERN = /\.onBeforeCompile\s*=(?!=)/g;

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesUnder(path));
      continue;
    }
    if (!SOURCE_FILE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
    if (EXCLUDED_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    found.push(path);
  }
  return found;
}

describe("shader patch sites", () => {
  it("assigns onBeforeCompile only inside the guard", () => {
    const offenders: string[] = [];
    for (const path of sourceFilesUnder(SCENE_RENDERERS_DIRECTORY)) {
      const relativePath = path.slice(SCENE_RENDERERS_DIRECTORY.length).split("\\").join("/");
      if (relativePath === PATCH_HELPER_FILE) continue;
      const source = readFileSync(path, "utf8");
      const matches = source.match(DIRECT_ASSIGNMENT_PATTERN);
      if (matches) offenders.push(`${relativePath} (${matches.length})`);
    }

    expect(
      offenders,
      "these assign onBeforeCompile directly, so on the node path the patch is silently dropped; " +
        "use applyClassicShaderPatch and give the material a node arm: " +
        offenders.join(", ")
    ).toEqual([]);
  });

  /**
   * The floor that stops the scan passing vacuously.
   *
   * A regular expression that matches nothing, a directory that moves, or an
   * extension list that stops covering `.tsx` would all make the test above
   * green and worthless. This asserts the scan still sees the patches it is
   * supposed to be guarding.
   */
  it("still finds the guarded patch sites", () => {
    let guardedSites = 0;
    for (const path of sourceFilesUnder(SCENE_RENDERERS_DIRECTORY)) {
      guardedSites += (readFileSync(path, "utf8").match(/applyClassicShaderPatch\(/g) ?? []).length;
    }
    // Five call sites for nine patches: the seabed's four boulder bands and its
    // floor share one caustics site, and the kelp and turf beds share one sway
    // site. The count is a floor rather than an equality so adding a patch does
    // not fail a test about scanning.
    expect(guardedSites).toBeGreaterThanOrEqual(5);
  });
});
