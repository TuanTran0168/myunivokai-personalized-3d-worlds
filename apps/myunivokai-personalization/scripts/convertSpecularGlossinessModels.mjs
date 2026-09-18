#!/usr/bin/env node
/**
 * REWRITES A GLB'S MATERIALS OUT OF `KHR_materials_pbrSpecularGlossiness`,
 * BECAUSE THREE.JS CANNOT READ THAT EXTENSION AND FAILS SILENTLY WHEN IT MEETS
 * ONE.
 *
 * # The defect this exists to remove
 *
 * `animal-bear.glb` and `animal-boar.glb` put 100% of their surfacing inside
 * `KHR_materials_pbrSpecularGlossiness` and leave `pbrMetallicRoughness` as an
 * empty object. `three@0.185.1` ships **no** specular-glossiness plugin —
 * `grep -c pbrSpecularGlossiness node_modules/three/examples/jsm/loaders/GLTFLoader.js`
 * returns 0 — so those materials fall through to the metallic-roughness
 * defaults at `GLTFLoader.js:3586-3587`: `metalness = 1.0`, `roughness = 1.0`,
 * base colour white.
 *
 * A white, fully metallic, fully rough animal is a mirror ball. That is what
 * two of the forest's eight ground animals have been rendering as, on both
 * renderer paths, for as long as the models have been committed. Nothing
 * reported it because `GLTFLoader.js:534-536` only `console.warn`s an unknown
 * REQUIRED extension — it does not refuse the file — and the diffuse images are
 * inside the GLB, so nothing 404s either.
 *
 * # Why a committed script rather than a one-off edit
 *
 * The .glb files are the deliverable and they are binary. A script is the only
 * form in which the change can be reviewed, argued with, and re-run when a
 * model is replaced — and the next model downloaded from the same source will
 * have the same problem, because specular-glossiness is what a decade of asset
 * pipelines exported.
 *
 * Idempotent: a file with no `KHR_materials_pbrSpecularGlossiness` is reported
 * and left untouched, byte for byte.
 *
 * # The conversion, and why it is exact for these two files
 *
 * The general spec-gloss to metal-rough conversion is lossy, because a
 * spec-gloss material can describe a coloured specular reflectance that
 * metal-rough cannot. **These two files do not use that freedom**: every
 * material has `specularFactor: [0, 0, 0]`, which is a purely diffuse surface.
 * For that case the mapping is exact:
 *
 *     baseColorFactor  <- diffuseFactor
 *     baseColorTexture <- diffuseTexture
 *     metallicFactor   <- 0            (specular is black: nothing is metal)
 *     roughnessFactor  <- 1 - glossinessFactor
 *
 * The script REFUSES to convert a material with a non-black `specularFactor`
 * rather than approximating it, because an approximation committed into a
 * binary asset is a lie that cannot be spotted later.
 *
 * Usage:  node scripts/convertSpecularGlossinessModels.mjs [--check]
 *         --check reports what would change and writes nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const APPLICATION_DIRECTORY = join(SCRIPT_DIRECTORY, "..");

/** The files this script is for. Listed rather than globbed: a conversion that
 * silently picks up a new file is a conversion nobody reviewed. */
const MODELS_TO_CONVERT = [
  "public/assets/nature/models/animal-bear.glb",
  "public/assets/nature/models/animal-boar.glb"
];

const SPECULAR_GLOSSINESS_EXTENSION_NAME = "KHR_materials_pbrSpecularGlossiness";

/** glTF binary container constants, from the glTF 2.0 specification §4.4.3. */
const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_BYTE_LENGTH = 12;
const GLB_CHUNK_HEADER_BYTE_LENGTH = 8;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BINARY = 0x004e4942;
const GLB_CHUNK_ALIGNMENT_BYTES = 4;
/** JSON chunks are padded with spaces, binary chunks with zeroes. §4.4.3.2-3. */
const JSON_PADDING_BYTE = 0x20;
const BINARY_PADDING_BYTE = 0x00;

/** A glossiness of 1 is a mirror, so roughness is its complement. */
const FULL_GLOSSINESS = 1;
/** A surface whose specular reflectance is black reflects nothing: not a metal. */
const NON_METALLIC = 0;

function readGlb(fileBytes) {
  if (fileBytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("not a GLB: magic header does not read 'glTF'");
  }
  const chunks = [];
  let offset = GLB_HEADER_BYTE_LENGTH;
  while (offset < fileBytes.length) {
    const chunkByteLength = fileBytes.readUInt32LE(offset);
    const chunkType = fileBytes.readUInt32LE(offset + 4);
    const chunkStart = offset + GLB_CHUNK_HEADER_BYTE_LENGTH;
    chunks.push({ type: chunkType, bytes: fileBytes.subarray(chunkStart, chunkStart + chunkByteLength) });
    offset = chunkStart + chunkByteLength;
  }
  const jsonChunk = chunks.find((chunk) => chunk.type === GLB_CHUNK_TYPE_JSON);
  const binaryChunk = chunks.find((chunk) => chunk.type === GLB_CHUNK_TYPE_BINARY);
  if (!jsonChunk) {
    throw new Error("not a GLB: no JSON chunk");
  }
  return { document: JSON.parse(jsonChunk.bytes.toString("utf8")), binaryBytes: binaryChunk?.bytes ?? null };
}

function padded(bytes, paddingByte) {
  const remainder = bytes.length % GLB_CHUNK_ALIGNMENT_BYTES;
  if (remainder === 0) {
    return bytes;
  }
  const padding = Buffer.alloc(GLB_CHUNK_ALIGNMENT_BYTES - remainder, paddingByte);
  return Buffer.concat([bytes, padding]);
}

function writeGlb(document, binaryBytes) {
  const jsonBytes = padded(Buffer.from(JSON.stringify(document), "utf8"), JSON_PADDING_BYTE);
  const chunks = [{ type: GLB_CHUNK_TYPE_JSON, bytes: jsonBytes }];
  if (binaryBytes) {
    chunks.push({ type: GLB_CHUNK_TYPE_BINARY, bytes: padded(binaryBytes, BINARY_PADDING_BYTE) });
  }
  const totalByteLength =
    GLB_HEADER_BYTE_LENGTH +
    chunks.reduce((total, chunk) => total + GLB_CHUNK_HEADER_BYTE_LENGTH + chunk.bytes.length, 0);
  const output = Buffer.alloc(totalByteLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalByteLength, 8);
  let offset = GLB_HEADER_BYTE_LENGTH;
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.bytes.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.bytes.copy(output, offset + GLB_CHUNK_HEADER_BYTE_LENGTH);
    offset += GLB_CHUNK_HEADER_BYTE_LENGTH + chunk.bytes.length;
  }
  return output;
}

function convertMaterial(material, materialLabel) {
  const specularGlossiness = material.extensions?.[SPECULAR_GLOSSINESS_EXTENSION_NAME];
  if (!specularGlossiness) {
    return null;
  }
  const specularFactor = specularGlossiness.specularFactor ?? [1, 1, 1];
  if (specularFactor.some((component) => component !== 0)) {
    throw new Error(
      `${materialLabel} has a non-black specularFactor [${specularFactor}], which metallic-roughness cannot ` +
        "express exactly. Convert it by hand and say in the commit what was approximated."
    );
  }
  const glossinessFactor = specularGlossiness.glossinessFactor ?? FULL_GLOSSINESS;
  const metallicRoughness = {
    baseColorFactor: specularGlossiness.diffuseFactor ?? [1, 1, 1, 1],
    metallicFactor: NON_METALLIC,
    roughnessFactor: FULL_GLOSSINESS - glossinessFactor
  };
  if (specularGlossiness.diffuseTexture) {
    metallicRoughness.baseColorTexture = specularGlossiness.diffuseTexture;
  }
  material.pbrMetallicRoughness = metallicRoughness;
  delete material.extensions[SPECULAR_GLOSSINESS_EXTENSION_NAME];
  if (Object.keys(material.extensions).length === 0) {
    delete material.extensions;
  }
  return {
    material: materialLabel,
    roughnessFactor: metallicRoughness.roughnessFactor,
    hasBaseColorTexture: Boolean(metallicRoughness.baseColorTexture)
  };
}

function withoutExtension(extensionList) {
  if (!extensionList) {
    return undefined;
  }
  const remaining = extensionList.filter((name) => name !== SPECULAR_GLOSSINESS_EXTENSION_NAME);
  return remaining.length > 0 ? remaining : undefined;
}

function convertModel(modelPath, writeChanges) {
  const absolutePath = join(APPLICATION_DIRECTORY, modelPath);
  const { document, binaryBytes } = readGlb(readFileSync(absolutePath));
  const converted = (document.materials ?? [])
    .map((material, index) => convertMaterial(material, `${modelPath}#${material.name ?? index}`))
    .filter(Boolean);
  if (converted.length === 0) {
    console.log(`unchanged  ${modelPath} — no ${SPECULAR_GLOSSINESS_EXTENSION_NAME} material`);
    return false;
  }
  document.extensionsUsed = withoutExtension(document.extensionsUsed);
  document.extensionsRequired = withoutExtension(document.extensionsRequired);
  if (!document.extensionsUsed) delete document.extensionsUsed;
  if (!document.extensionsRequired) delete document.extensionsRequired;
  for (const entry of converted) {
    console.log(
      `converted  ${entry.material} — metallic 0, roughness ${entry.roughnessFactor.toFixed(2)}` +
        `${entry.hasBaseColorTexture ? ", baseColorTexture restored" : ", factor only"}`
    );
  }
  if (writeChanges) {
    writeFileSync(absolutePath, writeGlb(document, binaryBytes));
    console.log(`written    ${modelPath}`);
  }
  return true;
}

const checkOnly = process.argv.includes("--check");
let anyConverted = false;
for (const modelPath of MODELS_TO_CONVERT) {
  anyConverted = convertModel(modelPath, !checkOnly) || anyConverted;
}
if (checkOnly && anyConverted) {
  console.error(
    `\n${relative(process.cwd(), fileURLToPath(import.meta.url))} --check: at least one model still carries ` +
      `${SPECULAR_GLOSSINESS_EXTENSION_NAME}. Run the script without --check.`
  );
  process.exit(1);
}
