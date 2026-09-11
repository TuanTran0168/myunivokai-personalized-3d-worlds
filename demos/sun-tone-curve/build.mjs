import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * SPLICE `toneCurves.mjs` INTO `shell.html`, SO THE PAGE OPENS FROM `file://`.
 *
 * `demos/README.md`: "No network at runtime. The built file must open from the
 * filesystem with no CDN, no fonts, no remote assets." A browser refuses an ES
 * module `import` over `file://` as a cross-origin request, so a demo that keeps
 * its maths in a separate module cannot both stay one source and open by double
 * click. Splicing resolves that the same way `webgpu-node-path/build.mjs` does.
 *
 * The alternative — pasting the curve maths into the page and keeping a second
 * copy in `measure.mjs` — is the failure this whole demo is about: a value
 * declared twice drifts, and nothing renders an error when the two copies stop
 * agreeing. One module, two consumers.
 */

const SPLICE_MARKER = "// @splice ./toneCurves.mjs";
const EXPORT_KEYWORD_PATTERN = /^export /gm;
const OUTPUT_DIRECTORY_NAME = "dist";
const OUTPUT_FILE_NAME = "sun-tone-curve.html";

const demoDirectory = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(resolve(demoDirectory, "shell.html"), "utf8");
const toneCurves = readFileSync(resolve(demoDirectory, "toneCurves.mjs"), "utf8");

if (!shell.includes(SPLICE_MARKER)) {
  console.error(`build: shell.html no longer contains "${SPLICE_MARKER}", so nothing would be inlined.`);
  process.exit(1);
}

// The module is all `export function` and `export const` at top level, so
// dropping the keyword makes every declaration a plain one in the page's own
// module scope. Anchored to line starts so an `export` inside a string or a
// comment is left alone.
const inlined = toneCurves.replace(EXPORT_KEYWORD_PATTERN, "");
const page = shell.replace(SPLICE_MARKER, inlined);

const outputDirectory = resolve(demoDirectory, OUTPUT_DIRECTORY_NAME);
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, OUTPUT_FILE_NAME);
writeFileSync(outputPath, page);

console.log(`build: wrote ${outputPath} (${page.length} bytes, no external references)`);
