/**
 * Inlines three.js's WebGPU build and the probe script into ONE self-contained
 * HTML file.
 *
 *   node demos/webgpu-node-path/build.mjs
 *   -> demos/webgpu-node-path/dist/webgpu-node-path.html   (gitignored)
 *   node demos/webgpu-node-path/measure.mjs                (checks its claims)
 *
 * Unlike `demos/ocean-depth-rig/build.mjs`, this one cannot use a CommonJS
 * bundle: three ships `three.cjs` for the WebGL renderer but there is **no
 * `three.webgpu.cjs`**. The WebGPU build exists only as an ES module, and it
 * imports from `./three.core.js`, which a `file://` page cannot resolve.
 *
 * So the assembly is:
 *
 *   1. `three.core.js` becomes a `data:text/javascript;base64,…` module URL,
 *      imported dynamically once. A data: URL module is fetched with no
 *      network and works from `file://`; three.core.js imports nothing itself,
 *      so it has no relative specifiers of its own to break.
 *   2. `three.webgpu.js`'s `import { … } from './three.core.js';` is rewritten
 *      into `const { … } = ThreeCore;` — a destructure of the module namespace,
 *      which is exactly what the import meant.
 *   3. Its `export { … } from './three.core.js';` re-export is dropped. It
 *      forwards names that `ThreeCore` already holds, and it is the second
 *      reference to the core bundle — the one that is easy to miss, because
 *      removing only the import leaves a page that still tries to fetch
 *      `three.core.js` off the filesystem and dies on CORS with no clue why.
 *   4. Its trailing `export { … };` is rewritten into
 *      `const ThreeWebGPU = { … };`. Both lists are plain identifier lists with
 *      no `x as y` renaming (asserted below), so an export list is a valid
 *      object-literal shorthand and the rewrite is mechanical.
 *
 * Nothing in three is patched: every line of the library is the shipped line,
 * with two statements re-spelled so a single file can hold both modules.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const threeBuildPath = resolve(repoRoot, "apps/myunivokai-personalization/node_modules/three/build");
const threeCorePath = resolve(threeBuildPath, "three.core.js");
const threeWebGpuPath = resolve(threeBuildPath, "three.webgpu.js");
const outputDirectory = resolve(here, "dist");
const outputFile = resolve(outputDirectory, "webgpu-node-path.html");

const CORE_IMPORT_SPECIFIER = "'./three.core.js'";
const CORE_NAMESPACE_IDENTIFIER = "ThreeCore";
const WEBGPU_NAMESPACE_IDENTIFIER = "ThreeWebGPU";
const CORE_MODULE_URL_PLACEHOLDER = "/*__THREE_CORE_MODULE_URL__*/";
const THREE_WEBGPU_PLACEHOLDER = "/*__THREE_WEBGPU__*/";
const PROBES_PLACEHOLDER = "/*__NODE_PATH_PROBES__*/";

const [threeCoreSource, threeWebGpuSource, shell, probes] = await Promise.all([
  readFile(threeCorePath, "utf8").catch(() => {
    throw new Error(`three.core.js not found at ${threeCorePath}. Run npm install in apps/myunivokai-personalization first.`);
  }),
  readFile(threeWebGpuPath, "utf8"),
  readFile(resolve(here, "shell.html"), "utf8"),
  readFile(resolve(here, "node-path-probes.js"), "utf8")
]);

for (const placeholder of [CORE_MODULE_URL_PLACEHOLDER, THREE_WEBGPU_PLACEHOLDER, PROBES_PLACEHOLDER]) {
  if (!shell.includes(placeholder)) {
    throw new Error(`shell.html is missing its ${placeholder} placeholder.`);
  }
}

/**
 * Turns `three.webgpu.js` into a statement sequence that can sit inside one
 * inline module alongside the probe script. Both rewrites are asserted rather
 * than assumed: a future three release that renames the core bundle or starts
 * using `x as y` in these lists must fail this build loudly instead of
 * producing a page whose THREE namespace is quietly half empty.
 */
function rewriteWebGpuModule(source) {
  const importLineMatch = source.match(/^import \{([^}]*)\} from '\.\/three\.core\.js';$/m);
  if (!importLineMatch) {
    throw new Error(`three.webgpu.js: could not find its ${CORE_IMPORT_SPECIFIER} import line.`);
  }
  const reExportLineMatch = source.match(/^export \{[^}]*\} from '\.\/three\.core\.js';$/m);
  if (!reExportLineMatch) {
    throw new Error(`three.webgpu.js: could not find its ${CORE_IMPORT_SPECIFIER} re-export line.`);
  }
  const exportLineMatch = source.match(/^export \{([^}]*)\};$/m);
  if (!exportLineMatch) {
    throw new Error("three.webgpu.js: could not find its trailing export list.");
  }
  for (const [label, list] of [["import", importLineMatch[1]], ["export", exportLineMatch[1]]]) {
    if (/\bas\b/.test(list)) {
      throw new Error(`three.webgpu.js: its ${label} list now uses \`x as y\`, which this build step cannot rewrite as a destructure.`);
    }
  }
  return source
    .replace(importLineMatch[0], () => `const {${importLineMatch[1]}} = ${CORE_NAMESPACE_IDENTIFIER};`)
    .replace(reExportLineMatch[0], () => `// core re-export dropped: ThreeCore already holds these names.`)
    .replace(exportLineMatch[0], () => `const ${WEBGPU_NAMESPACE_IDENTIFIER} = {${exportLineMatch[1]}};`);
}

const coreModuleUrl = `data:text/javascript;base64,${Buffer.from(threeCoreSource, "utf8").toString("base64")}`;

// Function replacers, not string ones: three's source contains `$&` sequences
// and String.replace treats those as substitution patterns, which once spliced
// the rest of the shell into the middle of the library. The same trap
// `demos/ocean-depth-rig/build.mjs` documents.
const html = shell
  .replace(CORE_MODULE_URL_PLACEHOLDER, () => JSON.stringify(coreModuleUrl))
  .replace(THREE_WEBGPU_PLACEHOLDER, () => rewriteWebGpuModule(threeWebGpuSource))
  .replace(PROBES_PLACEHOLDER, () => probes);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, html, "utf8");

const megabytes = (Buffer.byteLength(html, "utf8") / 1024 / 1024).toFixed(2);
console.log(`wrote ${outputFile} (${megabytes} MB) — open it directly in a browser, or run measure.mjs`);
