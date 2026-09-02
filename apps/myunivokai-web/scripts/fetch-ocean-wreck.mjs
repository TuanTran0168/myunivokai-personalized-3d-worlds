/**
 * Fetch and decimate the ocean family's one loaded seabed prop.
 *
 * Committed because the OUTPUT is committed, and a binary in a repository with
 * no recipe beside it is a binary nobody can ever regenerate. Run it only to
 * re-derive the asset — the app never calls it, and CI never runs it.
 *
 *   node scripts/fetch-ocean-wreck.mjs
 *
 * Needs `SKETCHFAB_API_TOKEN` in `apps/myunivokai-web/.env.local.secret`, which
 * is gitignored and stays that way. The token is a read credential for the
 * Download API; nothing here writes to Sketchfab.
 *
 * WHY THIS MODEL. `Stern Of SS Rifle` is the only CC0 wreck on Sketchfab — the
 * whole catalogue is in `agent-system/evolution/ocean-seabed-props-research.md`
 * — and CC0 is what makes committing it legitimate: no attribution obligation,
 * no redistribution restriction. It is a Scottish Maritime Museum photoscan of
 * a real pre-fabricated screw steamer, which is the point: the man-made detail
 * a seeded generator cannot invent.
 *
 * WHY EACH STEP. Measured 2026-09-02, in this order, on this model:
 *
 *   raw                              14.54 MB   250 k triangles
 *   simplify --ratio 0.02             3.43 MB    11 k triangles
 *   resize 512                        1.39 MB
 *   prune --keep-attributes false     1.39 MB    (drops the unused second UV)
 *   quantize                          1.01 MB    (KHR_mesh_quantization)
 *   jpeg, normalTexture only        608.66 KB    (a 493 KB PNG normal map)
 *
 * The last step is the biggest single win and the least obvious one: the base
 * colour arrived as a 60 KB JPEG and the normal map as a 493 KB PNG, so nine
 * tenths of the remaining texture budget was one lossless normal map for a prop
 * seen at 2.6 m through abyssal water.
 *
 * `--ratio 0.02` rather than the 0.01 the research estimated. At 11 k triangles
 * the stern's plate seams and its broken edge still read; the budget it costs
 * over 5 k is 150 KB, and this prop only ever appears when the rarity lottery
 * hits.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Sketchfab model uid for `Stern Of SS Rifle`, CC0, Scottish Maritime Museum. */
const MODEL_UID = "a985cbd68bd54063a838abd95f401174";
const EXPECTED_LICENCE = "cc0";
const SECRET_FILE = ".env.local.secret";
const TOKEN_KEY = "SKETCHFAB_API_TOKEN";
const OUTPUT_PATH = "public/assets/ocean/models/prop-shipwreck-stern.glb";
/** The CLI is not a dependency of the app; it is fetched for this run only. */
const GLTF_TRANSFORM_PACKAGE = "@gltf-transform/cli@4";
const SIMPLIFY_RATIO = "0.02";
const SIMPLIFY_ERROR = "0.01";
const TEXTURE_SIZE = "512";
const NORMAL_MAP_JPEG_QUALITY = "88";

function readToken() {
  const secrets = readFileSync(SECRET_FILE, "utf8");
  for (const line of secrets.split(/\r?\n/)) {
    const [key, ...rest] = line.split("=");
    if (key.trim() === TOKEN_KEY) {
      return rest.join("=").trim().replace(/^"|"$/g, "");
    }
  }
  throw new Error(`${TOKEN_KEY} is not in ${SECRET_FILE}`);
}

async function sketchfab(path, token) {
  const response = await fetch(`https://api.sketchfab.com/v3/${path}`, {
    headers: { Authorization: `Token ${token}` }
  });
  if (!response.ok) {
    throw new Error(`sketchfab ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function gltfTransform(command, input, output, extraArguments = []) {
  execFileSync(
    "npx",
    ["--yes", GLTF_TRANSFORM_PACKAGE, command, input, output, ...extraArguments],
    { stdio: "inherit", shell: true }
  );
}

const token = readToken();

// The licence is re-checked on every run rather than trusted from the research
// note: a model's licence can be changed by its owner, and committing a file we
// are no longer allowed to redistribute is the one failure here that matters
// off this machine.
const model = await sketchfab(`models/${MODEL_UID}`, token);
const licence = model.license?.slug;
if (licence !== EXPECTED_LICENCE) {
  throw new Error(
    `"${model.name}" is now licensed ${licence ?? "unknown"}, not ${EXPECTED_LICENCE}. Stopping: this pipeline commits its output.`
  );
}
console.log(`"${model.name}" by ${model.user?.displayName} — ${model.license?.label}`);

const download = await sketchfab(`models/${MODEL_UID}/download`, token);
if (!download.glb?.url) {
  throw new Error("the download response carries no glb url");
}

const workspace = mkdtempSync(join(tmpdir(), "ocean-wreck-"));
try {
  const raw = join(workspace, "raw.glb");
  const glbResponse = await fetch(download.glb.url);
  if (!glbResponse.ok) {
    throw new Error(`glb download: HTTP ${glbResponse.status}`);
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(raw, Buffer.from(await glbResponse.arrayBuffer()));

  const simplified = join(workspace, "simplified.glb");
  const resized = join(workspace, "resized.glb");
  const pruned = join(workspace, "pruned.glb");
  const quantized = join(workspace, "quantized.glb");
  const compressed = join(workspace, "compressed.glb");

  gltfTransform("simplify", raw, simplified, ["--ratio", SIMPLIFY_RATIO, "--error", SIMPLIFY_ERROR]);
  gltfTransform("resize", simplified, resized, ["--width", TEXTURE_SIZE, "--height", TEXTURE_SIZE]);
  gltfTransform("prune", resized, pruned, ["--keep-attributes", "false"]);
  gltfTransform("quantize", pruned, quantized);
  // `--formats "*"` is required, not cosmetic: the flag names the INPUT formats
  // to consider, and the normal map is a PNG. Without it the command reports
  // success and changes nothing.
  gltfTransform("jpeg", quantized, compressed, [
    "--formats",
    "*",
    "--slots",
    "normalTexture",
    "--quality",
    NORMAL_MAP_JPEG_QUALITY
  ]);

  copyFileSync(compressed, OUTPUT_PATH);
  console.log(`wrote ${OUTPUT_PATH}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
