import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY COMMITTED .GLB IS CHECKED AGAINST THE EXTENSION LIST OF THE THREE.JS
 * THAT HAS TO READ IT, BECAUSE THE FAILURE MODE IS SILENT AND LOOKS LIKE A
 * STYLE CHOICE.
 *
 * `animal-bear.glb` and `animal-boar.glb` put 100% of their surfacing inside
 * `KHR_materials_pbrSpecularGlossiness`, an extension `three@0.185.1` does not
 * implement at all. `GLTFLoader.js:534-536` only `console.warn`s an unknown
 * REQUIRED extension — it does not refuse the file — so both models loaded,
 * both fell through to the metallic-roughness defaults
 * (`GLTFLoader.js:3586-3587`: metalness 1, roughness 1, base colour white), and
 * both rendered as white chrome animals in a forest for as long as they have
 * been committed. Nobody reported it as a bug because a mirror-finish bear
 * looks deliberate if you have never seen the model it was meant to be.
 *
 * # Why this reads three's own source instead of listing the extensions here
 *
 * A hardcoded list is a second copy of someone else's decision, and it goes
 * stale in the direction that hurts: three ADDS extensions, so a stale list
 * fails a model that is actually fine, gets weakened, and stops catching
 * anything. `nodeMaterials.test.ts` makes the same argument for the same
 * reason. Reading `EXTENSIONS` out of the installed `GLTFLoader.js` means a
 * three.js upgrade that drops support fails here rather than on a screenshot.
 *
 * # What this does NOT check
 *
 * Whether the pixels are good. A model can satisfy every assertion here and
 * still be the wrong tree. This is the mechanical half — the half that was
 * wrong for two files and that no amount of looking at the forest was going to
 * attribute correctly.
 */

const APPLICATION_DIRECTORY = process.cwd();
const MODEL_DIRECTORIES = ["public/assets", "public/models"];
const GLTF_LOADER_PATH = "node_modules/three/examples/jsm/loaders/GLTFLoader.js";

/** glTF binary container constants, from the glTF 2.0 specification §4.4.3. */
const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_BYTE_LENGTH = 12;
const GLB_CHUNK_HEADER_BYTE_LENGTH = 8;

/**
 * `KHR_binary_glTF` is in three's map but is a glTF-1.0-era marker that a glTF
 * 2.0 `.glb` never declares, so it is not expected to appear in any file here.
 * It stays in the accepted set because this list is three's, not ours.
 */
function supportedExtensionNames(): Set<string> {
  const loaderSource = readFileSync(join(APPLICATION_DIRECTORY, GLTF_LOADER_PATH), "utf8");
  const declaration = loaderSource.match(/const EXTENSIONS = \{([\s\S]*?)\};/);
  if (!declaration) {
    throw new Error(
      "could not find `const EXTENSIONS = {` in GLTFLoader.js — three.js moved it, and this test is now asserting " +
        "nothing. Find the new shape before weakening this."
    );
  }
  const names = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  expect(names.length, "three's EXTENSIONS map parsed to nothing").toBeGreaterThan(10);
  return new Set(names);
}

function findModelFiles(directory: string): string[] {
  const absolute = join(APPLICATION_DIRECTORY, directory);
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry);
      if (statSync(entryPath).isDirectory()) {
        walk(entryPath);
      } else if (entry.endsWith(".glb") || entry.endsWith(".gltf")) {
        found.push(entryPath);
      }
    }
  };
  walk(absolute);
  return found;
}

function readGlbDocument(filePath: string): Record<string, unknown> {
  const bytes = readFileSync(filePath);
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${filePath} does not start with the glTF magic header`);
  }
  const jsonByteLength = bytes.readUInt32LE(GLB_HEADER_BYTE_LENGTH);
  const jsonStart = GLB_HEADER_BYTE_LENGTH + GLB_CHUNK_HEADER_BYTE_LENGTH;
  return JSON.parse(bytes.subarray(jsonStart, jsonStart + jsonByteLength).toString("utf8"));
}

const modelFiles = MODEL_DIRECTORIES.flatMap(findModelFiles);

describe("committed 3D models", () => {
  it("finds the models at all, so an empty sweep cannot pass as a clean one", () => {
    expect(modelFiles.length).toBeGreaterThan(50);
  });

  it("requires no glTF extension that the installed three.js cannot read", () => {
    const supported = supportedExtensionNames();
    const unreadable: string[] = [];
    for (const filePath of modelFiles) {
      const document = readGlbDocument(filePath);
      const required = (document.extensionsRequired as string[] | undefined) ?? [];
      for (const extensionName of required) {
        if (!supported.has(extensionName)) {
          unreadable.push(`${filePath.replace(APPLICATION_DIRECTORY, "")} requires ${extensionName}`);
        }
      }
    }
    // A required extension three cannot read does not throw: the loader warns
    // and the material silently becomes white chrome. Convert the model
    // instead — `scripts/convertSpecularGlossinessModels.mjs` is the worked
    // example for the specular-glossiness case.
    expect(unreadable, "models requiring an extension three.js does not implement").toEqual([]);
  });

  it("leaves no material with nothing for three's metallic-roughness path to read", () => {
    const surfaceless: string[] = [];
    for (const filePath of modelFiles) {
      const document = readGlbDocument(filePath);
      const materials = (document.materials as Record<string, unknown>[] | undefined) ?? [];
      materials.forEach((material, index) => {
        const metallicRoughness = material.pbrMetallicRoughness as Record<string, unknown> | undefined;
        const hasMetallicRoughness = metallicRoughness !== undefined && Object.keys(metallicRoughness).length > 0;
        // An empty `pbrMetallicRoughness` is legal glTF and means "take the
        // defaults" — white, fully metallic, fully rough. That is a legitimate
        // thing to want and a catastrophic thing to get by accident, so it only
        // counts as a defect when the material ALSO carries an extension that
        // was supposed to be doing the surfacing instead.
        const extensions = material.extensions as Record<string, unknown> | undefined;
        const surfacingExtensions = Object.keys(extensions ?? {}).filter((name) => name.includes("materials"));
        if (!hasMetallicRoughness && surfacingExtensions.length > 0) {
          surfaceless.push(
            `${filePath.replace(APPLICATION_DIRECTORY, "")}#${material.name ?? index} surfaces only through ` +
              surfacingExtensions.join(", ")
          );
        }
      });
    }
    expect(surfaceless, "materials whose surfacing lives only in an extension").toEqual([]);
  });

  it("has the two converted animals surfacing as dielectrics with their committed textures", () => {
    // The specific assertion for the specific fix, so that a future
    // re-export that loses it fails here by name rather than as a statistic.
    for (const modelName of ["animal-bear.glb", "animal-boar.glb"]) {
      const filePath = modelFiles.find((candidate) => candidate.endsWith(modelName));
      expect(filePath, `${modelName} is missing`).toBeDefined();
      const document = readGlbDocument(filePath as string);
      const materials = (document.materials as Record<string, unknown>[] | undefined) ?? [];
      expect(materials.length, `${modelName} has no materials`).toBeGreaterThan(0);
      for (const material of materials) {
        const metallicRoughness = material.pbrMetallicRoughness as Record<string, unknown>;
        expect(metallicRoughness.metallicFactor, `${modelName} material is metallic`).toBe(0);
        expect(metallicRoughness.baseColorTexture, `${modelName} material lost its diffuse image`).toBeDefined();
      }
    }
  });
});
