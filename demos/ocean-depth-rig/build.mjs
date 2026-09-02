/**
 * Inlines three.js and the scene into ONE self-contained HTML file.
 *
 * Why a build step at all, when the demo is only two source files: three.js is
 * 1.3 MB and belongs to the app's node_modules, not to git. This script splices
 * it in at build time so the output opens from the filesystem with no server,
 * no network and no CDN — which is the whole point of a demo you can hand to
 * someone.
 *
 *   node demos/ocean-depth-rig/build.mjs
 *   -> demos/ocean-depth-rig/dist/ocean-depth-rig.html   (gitignored)
 *
 * three.cjs is used rather than three.module.js because it is CommonJS and
 * self-contained: wrapped in a closure that supplies `module`/`exports` it
 * becomes a classic script with no imports to resolve. three.module.js imports
 * from three.core.js, which cannot be concatenated because the two files mangle
 * their internal names independently.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const modulesPath = resolve(repoRoot, "apps/myunivokai-personalization/node_modules/three");
const threePath = resolve(modulesPath, "build/three.cjs");
const loaderPath = resolve(modulesPath, "examples/jsm/loaders/GLTFLoader.js");
const utilsPath = resolve(modulesPath, "examples/jsm/utils/BufferGeometryUtils.js");
const assetsPath = resolve(repoRoot, "apps/myunivokai-personalization/public/assets/ocean/models");
const outDir = resolve(here, "dist");
const outFile = resolve(outDir, "ocean-depth-rig.html");

// The four animals big enough to be looked at. Small schools stay procedural on
// purpose: a thousand instances of a detailed mesh is the cost the whole
// vertex-animation approach exists to avoid, and at two pixels across nobody can
// tell. These are the CC0 GLBs the real renderer will use, byte for byte.
const MODELS = {
  shark: "fauna-shark.glb",
  dolphin: "fauna-dolphin.glb",
  whale: "fauna-whale.glb",
  manta: "fauna-manta-ray.glb",
  goblinShark: "fauna-goblin-shark.glb",
  swordfish: "fauna-swordfish.glb",
  lionfish: "fauna-lionfish.glb",
  butterflyfish: "fauna-butterfly-fish.glb",
  turbot: "fauna-turbot.glb",
  blobfish: "fauna-blobfish.glb"
  // fauna-piranha.glb is deliberately unused: piranhas are freshwater.
  // fauna-black-lionfish.glb is a colour variant of the lionfish.
};

const [three, loaderSource, utilsSource, shell, scene] = await Promise.all([
  readFile(threePath, "utf8").catch(() => {
    throw new Error(`three.cjs not found at ${threePath}. Run npm install in apps/myunivokai-personalization first.`);
  }),
  readFile(loaderPath, "utf8"),
  readFile(utilsPath, "utf8"),
  readFile(resolve(here, "shell.html"), "utf8"),
  readFile(resolve(here, "ocean-scene.js"), "utf8")
]);

for (const token of ["/*__THREE_CJS__*/", "/*__OCEAN_SCENE__*/", "/*__GLTF_LOADER__*/", "/*__MODELS__*/"]) {
  if (!shell.includes(token)) {
    throw new Error(`shell.html is missing its ${token} placeholder.`);
  }
}

/**
 * GLTFLoader is an ES module whose only dependencies are three itself and one
 * helper. Turning it into a classic script is therefore mechanical: replace its
 * import block with a destructure off the global THREE, inline the one helper,
 * and turn its export into a global. No bundler, and nothing is patched --
 * every line of the loader is the shipped line.
 */
function toClassicScript(loader, utils) {
  const importEnd = loader.indexOf("} from 'three';");
  if (importEnd < 0) throw new Error("GLTFLoader.js: could not find its three import block.");
  const names = loader
    .slice(loader.indexOf("{") + 1, importEnd)
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const helperStart = utils.indexOf("function toTrianglesDrawMode(");
  if (helperStart < 0) throw new Error("BufferGeometryUtils.js: toTrianglesDrawMode not found.");
  const helperEnd = utils.indexOf("\n}\n", helperStart) + 3;
  const helper = utils.slice(helperStart, helperEnd);
  const helperNames = ["TrianglesDrawMode", "TriangleFanDrawMode", "TriangleStripDrawMode"];

  let body = loader.slice(loader.indexOf("';", importEnd) + 2);
  body = body.replace("import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js';", "");
  body = body.replace("export { GLTFLoader };", "window.GLTFLoader = GLTFLoader;");
  if (!body.includes("window.GLTFLoader")) throw new Error("GLTFLoader.js: export not rewritten.");

  const wanted = [...new Set([...names, ...helperNames])].join(", ");
  return `(function(){\nconst { ${wanted} } = window.THREE;\n${helper}\n${body}\n})();`;
}

// The replacements MUST use function replacers. three.cjs contains `$&`-style
// sequences, and String.replace treats those as substitution patterns in a
// string replacement: one of them expanded to "everything after the match",
// which spliced the rest of shell.html — including its closing </script> — into
// the middle of three.js. The page then died with "Invalid or unexpected token"
// and THREE was never defined.
// Models travel as base64 in the page, because the whole point of this output
// is that it opens from the filesystem with no server: a fetch() of a .glb from
// a file:// URL is blocked, and a data: URL is not.
const modelEntries = await Promise.all(
  Object.entries(MODELS).map(async ([key, file]) => {
    const bytes = await readFile(resolve(assetsPath, file));
    return `  ${key}: "data:model/gltf-binary;base64,${bytes.toString("base64")}"`;
  })
);
const modelBlock = `window.__OCEAN_MODELS = {\n${modelEntries.join(",\n")}\n};`;

const html = shell
  .replace("/*__THREE_CJS__*/", () => three)
  .replace("/*__GLTF_LOADER__*/", () => toClassicScript(loaderSource, utilsSource))
  .replace("/*__MODELS__*/", () => modelBlock)
  .replace("/*__OCEAN_SCENE__*/", () => scene);

await mkdir(outDir, { recursive: true });
await writeFile(outFile, html, "utf8");

const megabytes = (Buffer.byteLength(html, "utf8") / 1024 / 1024).toFixed(2);
console.log(`wrote ${outFile} (${megabytes} MB) — open it directly in a browser`);
