/**
 * Checks the claims ocean-color-by-depth.html makes.
 *
 * A demo is judged on a picture and the thing that produced it is the least
 * reliable judge of it, so every claim the page makes in words is a number
 * here. It reads the PAGE, pulls the model block out of it and evaluates that,
 * so what is measured is what the page draws — there is no second copy of the
 * physics to drift.
 *
 *   node demos/ocean-color-by-depth/measure.mjs
 *
 * Exits non-zero on the first failed claim.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_PATH = fileURLToPath(new URL("./ocean-color-by-depth.html", import.meta.url));
const GOLDEN_DIRECTORY = fileURLToPath(
  new URL("../../services/ocean-service/internal/services/testdata/", import.meta.url)
);

const MODEL_BLOCK_PATTERN = /<script id="ocean-colour-model">([\s\S]*?)<\/script>/;

function loadModelFromThePage() {
  const page = readFileSync(PAGE_PATH, "utf8");
  const match = page.match(MODEL_BLOCK_PATTERN);
  if (!match) {
    throw new Error("the page has no <script id=\"ocean-colour-model\"> block to measure");
  }
  const build = new Function(`${match[1]}\nreturn OceanColourModel;`);
  return build();
}

const model = loadModelFromThePage();

let failures = 0;
function claim(description, verdict, evidence) {
  const mark = verdict ? "ok  " : "FAIL";
  console.log(`${mark}  ${description}\n      ${evidence}`);
  if (!verdict) failures += 1;
}

// --- 1. the pure-water half is not tuned to anything -------------------------
//
// The whole page rests on this. If the uncalibrated published data reproduces
// the two constants ocean-service arrived at independently, the model is
// measuring the same ocean the service is.
{
  const attenuationAt475 = model.pureAttenuationAt475();
  // 550 nm is sample index 15 on the 400 nm / 10 nm grid.
  const attenuationAt550 = model.pureSeawaterAttenuation(15);
  const SERVICE_PURE_KD_BLUE = 0.016;
  const SERVICE_PURE_KD_GREEN = 0.065;
  const blueError = Math.abs(attenuationAt475 - SERVICE_PURE_KD_BLUE) / SERVICE_PURE_KD_BLUE;
  const greenError = Math.abs(attenuationAt550 - SERVICE_PURE_KD_GREEN) / SERVICE_PURE_KD_GREEN;
  claim(
    "Pope & Fry plus Morel scattering reproduces ocean_water_optics.go's own two constants",
    blueError < 0.05 && greenError < 0.10,
    `Kd(475) = ${attenuationAt475.toFixed(4)} against 0.016 (${(blueError * 100).toFixed(1)} %), ` +
      `Kd(550) = ${attenuationAt550.toFixed(4)} against 0.065 (${(greenError * 100).toFixed(1)} %)`
  );
}

// --- 2. the shipped column really is what the service emits ------------------
//
// The page puts "shipped" next to "computed", which is only worth looking at if
// the shipped side is genuinely the service's output and not a sketch of it.
// Checked against the committed goldens, byte for byte.
{
  const goldenFiles = readdirSync(GOLDEN_DIRECTORY).filter(
    (name) => name.startsWith("ocean-golden-") && name.endsWith(".json")
  );
  const mismatches = [];
  let compared = 0;
  for (const fileName of goldenFiles) {
    const golden = JSON.parse(readFileSync(`${GOLDEN_DIRECTORY}${fileName}`, "utf8"));
    const depthMetres = golden?.depth?.metres;
    const shippedFogColor = golden?.water?.fogColor;
    if (typeof depthMetres !== "number" || typeof shippedFogColor !== "string") continue;
    // Above the waterline the service is not on this curve at all.
    if (depthMetres < 0) continue;
    compared += 1;
    const mirrored = model.shippedFogColour(depthMetres);
    if (mirrored !== shippedFogColor.toUpperCase()) {
      mismatches.push(`${fileName} at ${depthMetres} m: page ${mirrored}, golden ${shippedFogColor}`);
    }
  }
  claim(
    "the page's mirror of DepthAt() reproduces every committed golden fixture exactly",
    compared > 0 && mismatches.length === 0,
    compared === 0
      ? "no submerged goldens found to compare against"
      : `${compared} fixtures compared, ${mismatches.length} mismatched${mismatches.length ? `: ${mismatches[0]}` : ""}`
  );
}

// --- 3. the finding the page leads with ---------------------------------------
//
// The headline claim: clarity changes the colour of the sea, and the shipped
// model cannot express that because it never sees the water type.
{
  const DEPTH_METRES = 20;
  function hueOf(hex) {
    const linear = model.hexToLinearSrgb(hex);
    const red = linear.red;
    const green = linear.green;
    const blue = linear.blue;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum === minimum) return 0;
    const range = maximum - minimum;
    let hue;
    if (maximum === red) hue = ((green - blue) / range) % 6;
    else if (maximum === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    return ((hue * 60) % 360 + 360) % 360;
  }

  const clearHue = hueOf(model.waterColourAt("I", DEPTH_METRES).asTheEyeReadsIt);
  const turbidHue = hueOf(model.waterColourAt("3C", DEPTH_METRES).asTheEyeReadsIt);
  const separation = Math.abs(clearHue - turbidHue);
  claim(
    "the computed sea moves from blue to green as the water turns coastal",
    separation > 25 && turbidHue < clearHue,
    `at ${DEPTH_METRES} m: Jerlov I hue ${clearHue.toFixed(0)}°, 3C hue ${turbidHue.toFixed(0)}°, ` +
      `${separation.toFixed(0)}° apart`
  );

  const shippedColours = new Set(
    model.WATER_TYPES.map(() => model.shippedFogColour(DEPTH_METRES))
  );
  claim(
    "the shipped sea does not move at all, because DepthAt() never sees the water type",
    shippedColours.size === 1,
    `all ten water types ship ${[...shippedColours].join(", ")} at ${DEPTH_METRES} m`
  );
}

// --- 4. red dies first, in every sea this family can make --------------------
//
// The one thing everybody knows about underwater colour.
//
// It is stated over the seven types the ocean family can actually roll rather
// than over all ten, because in a harbour it stops being true: at 5C and worse
// the CDOM load kills BLUE faster than pure water kills red, which is exactly
// why estuary water is brown. The model reproduces that, the first version of
// this claim did not allow for it, and the model was right. The next claim is
// the general statement that covers both.
{
  const RED_INDEX = 25; // 650 nm
  const BLUE_INDEX = 7; // 470 nm
  const GREEN_INDEX = 15; // 550 nm
  const inPlay = model.WATER_TYPES.filter((waterType) => waterType.inPlay);
  const offenders = [];
  let checked = 0;
  for (const waterType of inPlay) {
    for (const depth of [1, 5, 10, 30, 100]) {
      const spectrum = model.downwellingSpectrum(waterType.name, depth);
      const surface = model.downwellingSpectrum(waterType.name, 0);
      const redSurvival = spectrum[RED_INDEX] / surface[RED_INDEX];
      const greenSurvival = spectrum[GREEN_INDEX] / surface[GREEN_INDEX];
      const blueSurvival = spectrum[BLUE_INDEX] / surface[BLUE_INDEX];
      checked += 1;
      if (!(redSurvival < greenSurvival && redSurvival < blueSurvival)) {
        offenders.push(`${waterType.name} at ${depth} m`);
      }
    }
  }
  claim(
    "red survives least, at every depth, in every water type this family can roll",
    offenders.length === 0,
    offenders.length === 0
      ? `${checked} combinations checked, none inverted`
      : `inverted at ${offenders.slice(0, 3).join(", ")}`
  );
}

// --- 4b. the mechanism behind every colour on the page -----------------------
//
// The window the sea leaves open WALKS toward longer wavelengths as the water
// turns coastal. That single fact is why the open ocean is blue, a shelf sea is
// green and a harbour is brown, and it is the reason a colour picked for one of
// them is wrong in the others.
{
  function bestSurvivingWavelength(waterTypeName) {
    const attenuation = model.attenuationSpectrum(waterTypeName);
    let bestIndex = 0;
    for (let index = 1; index < model.WAVELENGTH_COUNT; index += 1) {
      if (attenuation[index] < attenuation[bestIndex]) bestIndex = index;
    }
    return model.wavelengthAt(bestIndex);
  }
  const walk = model.WATER_TYPES.map((waterType) => ({
    name: waterType.name,
    nanometres: bestSurvivingWavelength(waterType.name)
  }));
  let monotone = true;
  for (let index = 1; index < walk.length; index += 1) {
    if (walk[index].nanometres < walk[index - 1].nanometres) monotone = false;
  }
  claim(
    "the wavelength the sea lets through walks toward the red as the water turns coastal",
    monotone && walk[walk.length - 1].nanometres > walk[0].nanometres,
    walk.map((step) => `${step.name} ${step.nanometres}`).join(" → ") + " nm"
  );
}

// --- 5. the euphotic depths land where oceanography puts them ----------------
//
// An independent check on the turbidity half, which is the assumed part. The
// depth at which 1 % of surface PAR is left is a measured quantity with
// published ranges, and the model was not fitted to it.
{
  const EXPECTED = [
    { name: "I", low: 90, high: 220, source: "clearest open ocean" },
    { name: "III", low: 25, high: 70, source: "shelf water" },
    { name: "9C", low: 0.5, high: 6, source: "estuary" }
  ];
  const readings = EXPECTED.map((expectation) => {
    const depth = model.depthForParFraction(expectation.name, 0.01);
    return { ...expectation, depth, inRange: depth >= expectation.low && depth <= expectation.high };
  });
  claim(
    "the 1 % light depth falls in the published range for clear, shelf and estuary water",
    readings.every((reading) => reading.inRange),
    readings
      .map((reading) => `${reading.name} ${reading.depth.toFixed(0)} m (${reading.low}-${reading.high})`)
      .join(", ")
  );
}

// --- 6. a colour picked at the surface comes back unchanged ------------------
//
// The reflectance reconstruction is solved rather than fitted, so the surface
// round-trip has to be exact or the tool is showing a shift that is partly its
// own arithmetic.
{
  const PROBES = ["#C0392B", "#D8BE93", "#3F6B37", "#D9D3C4", "#D2A63C", "#C68B62", "#FFFFFF"];
  const MAXIMUM_ROUND_TRIP_BYTES = 2;
  const worst = PROBES.map((hex) => {
    const returned = model.objectColourAt(hex, "I", 0, 0);
    const distance = [1, 3, 5].map((offset) =>
      Math.abs(parseInt(hex.slice(offset, offset + 2), 16) - parseInt(returned.slice(offset, offset + 2), 16))
    );
    return { hex, returned, error: Math.max(...distance) };
  }).sort((left, right) => right.error - left.error)[0];
  claim(
    "a colour at zero depth and zero distance comes back as itself",
    worst.error <= MAXIMUM_ROUND_TRIP_BYTES,
    `worst probe ${worst.hex} returned ${worst.returned}, ${worst.error} of 255 out`
  );
}

console.log("");
if (failures > 0) {
  console.error(`${failures} claim(s) failed.`);
  process.exit(1);
}
console.log("All claims hold.");
