import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * EVERY `three` SUBPATH THIS APP IMPORTS RESOLVES TO A FILE THAT EXISTS.
 *
 * This gate is here because the app's whole build went down over an import that
 * nothing a visitor does would ever execute. `NodePostEffects.tsx` reaches for
 * `three/addons/tsl/display/ChromaticAberrationNode.js` inside a `useEffect`,
 * through a dynamic `import()`, on a code path only the parity harness mounts —
 * and a dev container still holding three 0.171.0 (the addon arrived later)
 * failed to compile `page.tsx` outright.
 *
 * **A dynamic `import()` is not a runtime concern.** The comment above that call
 * says it is dynamic to keep a second copy of three out of the main bundle, and
 * that part is true. What it does NOT do is defer resolution: webpack reads the
 * specifier at build time, and an unresolvable one is a build error, not a
 * caught exception. So a harness-only chain is a build-time dependency of the
 * ordinary page, and the error it produces — "Can't resolve" — reads like a
 * missing dependency when the cause may be a stale one.
 *
 * `three/addons/*` maps to `examples/jsm/*`, which is exactly the part of three
 * that carries no stability promise: files there are added, renamed and moved
 * between releases. Phases 6-10 of the WebGPU migration will import more of
 * them. This test walks the source tree, so each new one is covered the moment
 * it is written, and a three upgrade that moves a file fails **here**, in a
 * suite CI runs, instead of on someone's dev server.
 *
 * It answers precisely the question the bundler asks — does this specifier name
 * a file? — and no more. It does not import the modules, so it says nothing
 * about whether their exports are still the ones the code uses; a rename inside
 * a file that still exists passes this and fails typecheck instead.
 */

const SOURCE_DIRECTORY = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Test files are scanned by nothing here, because webpack builds none of them.
 *
 * The exclusion is not tidiness. The first version of this file scanned them,
 * and the first thing it failed on was ITSELF: the comment below quotes the two
 * import forms it matches, and quoting an import is indistinguishable from
 * writing one to a regular expression. Narrowing the scan to the files the
 * bundler actually reads is both the correct scope and the fix.
 */
const EXCLUDED_FILE_SUFFIXES = [".test.ts", ".test.tsx"];

/**
 * Matches the two forms the source uses — a `from` clause and a call to
 * `import` — rather than any quoted string, so that a path named in prose is not
 * mistaken for a dependency.
 */
const THREE_SUBPATH_IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["'](three\/[^"']+)["']/g;

/**
 * The floor that stops this passing vacuously.
 *
 * A scanner that finds nothing asserts nothing, and it would go on asserting
 * nothing through every refactor of the folder layout. Three is the count at the
 * time of writing — two build subpaths (`three/webgpu`, `three/tsl`) and the
 * addons beside them — and the number only has to stay a floor, so adding
 * imports never touches it.
 */
const MINIMUM_EXPECTED_SUBPATH_IMPORTS = 3;

function collectSourceFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      collected.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (EXCLUDED_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) {
      continue;
    }
    if (SOURCE_FILE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      collected.push(entryPath);
    }
  }
  return collected;
}

function collectThreeSubpathImports(): Map<string, string[]> {
  const importersBySpecifier = new Map<string, string[]>();
  for (const sourceFile of collectSourceFiles(SOURCE_DIRECTORY)) {
    const contents = readFileSync(sourceFile, "utf8");
    for (const match of contents.matchAll(THREE_SUBPATH_IMPORT_PATTERN)) {
      const specifier = match[1];
      const importers = importersBySpecifier.get(specifier) ?? [];
      importers.push(sourceFile);
      importersBySpecifier.set(specifier, importers);
    }
  }
  return importersBySpecifier;
}

const importersBySpecifier = collectThreeSubpathImports();
const resolveFromSource = createRequire(import.meta.url);

describe("three subpath imports", () => {
  it("finds the subpath imports in the source tree", () => {
    expect(importersBySpecifier.size).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_SUBPATH_IMPORTS);
  });

  for (const [specifier, importers] of importersBySpecifier) {
    it(`resolves ${specifier}`, () => {
      const relativeImporters = importers.map((importer) => importer.slice(SOURCE_DIRECTORY.length));
      const failureExplanation =
        `${specifier} does not resolve against the installed three, and webpack will fail the ` +
        `build of every page that reaches ${relativeImporters.join(", ")} — including pages that ` +
        "never execute the import. Either the installed three is older than the code expects " +
        "(a dev container with a stale node_modules volume does this), or a three upgrade moved " +
        "the file: three/addons maps to examples/jsm, which carries no stability promise.";
      expect(() => resolveFromSource.resolve(specifier), failureExplanation).not.toThrow();
    });
  }
});
