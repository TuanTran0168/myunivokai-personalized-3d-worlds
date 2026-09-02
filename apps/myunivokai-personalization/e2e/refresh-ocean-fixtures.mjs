/**
 * Re-splice the ocean e2e fixtures from the Go golden configs.
 *
 * The baseline shots exist to catch a renderer regression, which only works if
 * the config they render is the config the backend actually emits. Hand-editing
 * a fixture to try a look is how a baseline stops measuring the product — so
 * every ocean fixture is generated from `ocean-service`'s own golden output and
 * only the world envelope (ids, titles, slugs) is local.
 *
 * The five map one-to-one onto the create form's four DEPTH & MOOD options, with
 * the above-water option sampled twice because its sun band spans a golden hour
 * and a midday sea and those are different photographs.
 *
 *   node e2e/refresh-ocean-fixtures.mjs
 *
 * Run it after any change to the ocean config builder, then re-shoot the
 * baselines. It rewrites `config` and `seed` in place and touches nothing else.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GOLDEN_DIR = fileURLToPath(
  new URL("../../../services/ocean-service/internal/services/testdata/", import.meta.url),
);
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

// fixture name -> golden name. The mood in the comment is the create-form option
// the golden case is built with, which is now also the depth it lands at.
const SOURCES = [
  ["ocean-surface", "surface-golden-hour"], // focused    Glass Shallows, low sun
  ["ocean-daylight", "surface-daylight"], // focused    Glass Shallows, high sun
  ["ocean-shallow", "energetic"], // energetic  Reef Crest
  ["ocean-twilight", "dreamy"], // dreamy     Mesophotic Current
  ["ocean-abyss", "reflective"], // reflective The Abyss
];

for (const [fixtureName, goldenName] of SOURCES) {
  const goldenPath = `${GOLDEN_DIR}ocean-golden-${goldenName}.json`;
  const fixturePath = `${FIXTURE_DIR}${fixtureName}-world.json`;
  const config = JSON.parse(readFileSync(goldenPath, "utf8"));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  const variant = fixture.variants?.[0];
  if (!variant) throw new Error(`${fixturePath} has no variant to update`);
  variant.config = config;
  variant.seed = config.seed ?? variant.seed;

  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  const depth = config.depth?.metres ?? 0;
  const where = depth < 0 ? `${(-depth).toFixed(2)} m up` : `${depth.toFixed(2)} m down`;
  const sunDegrees = ((config.lighting?.surfaceElevationRadians ?? 0) * 180) / Math.PI;
  console.log(
    `${fixtureName.padEnd(15)} <- ${goldenName.padEnd(20)} ${where.padStart(12)}` +
      ` | sun ${sunDegrees.toFixed(1)}deg | bearing ${(((config.lighting?.surfaceAzimuthRadians ?? 0) * 180) / Math.PI).toFixed(0)}deg` +
      ` | ${config.water?.jerlovWaterType} | floor ${config.depth?.seafloorMetres} m`,
  );
}
