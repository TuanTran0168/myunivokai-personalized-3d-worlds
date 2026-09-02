/**
 * Measures the built rig instead of looking at it.
 *
 *   node demos/ocean-depth-rig/build.mjs
 *   node demos/ocean-depth-rig/measure.mjs
 *
 * Why this exists: no frame in this study has ever been seen on real GPU
 * hardware — every screenshot was taken under swiftshader, in a headless
 * browser, by an agent that cannot be trusted to say "that looks nice". Three
 * separate rounds of this prototype were tuned by eye and three separate rounds
 * shipped a fault the eye had already looked straight past: a frame clipped to
 * white, a frame crushed to black, a seabed that was a flat slab of one colour.
 * All three are trivial to detect with numbers.
 *
 * For each preset it reports, over the rendered frame and over its top and
 * bottom thirds:
 *
 *   luma    mean relative luminance. Daylight wants 0.3–0.6; an abyss wants
 *           0.15–0.30. Outside those, something is wrong.
 *   blown   percentage of pixels at 250+ in any channel. Over about 2% means
 *           the tone map is being asked to hold more than it can, which is what
 *           "choi loa" — glare — actually is, numerically.
 *   crush   percentage at 8 or below. Anything material here is image thrown
 *           away, and it is how "khong the nhin duoc" measured.
 *   sat     mean HSV saturation. Below about 0.10 the frame is grey, whatever
 *           its palette claims. Water reflecting a hazy sky lands here honestly;
 *           water that has lost its colour to a bleached highlight does too, and
 *           the difference is visible in `luma`.
 *   detail  mean local contrast x100. This is the flat-slab detector: a mean
 *           luminance cannot tell a lit seabed from a painted one, and this can.
 *           Under about 0.5 in a region that should hold objects means the
 *           region holds none.
 *
 * It also checks each real model's declared orientation against its measured
 * cross-section profile, because an animal swimming backwards is an obvious bug
 * that nothing in a still frame reveals.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
// Playwright belongs to the web app, and ESM resolves bare specifiers from the
// importing file, not from the working directory. createRequire moves the
// resolution base to the app instead of vendoring anything here.
const appRequire = createRequire(
  pathToFileURL(resolve(repoRoot, "apps/myunivokai-personalization/package.json"))
);
const { chromium } = appRequire("@playwright/test");

const target = resolve(here, "dist/ocean-depth-rig.html");

function decodePng(buffer) {
  let offset = 8;
  let width = 0, height = 0, colorType = 6;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]; pos += 1;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}

function stats(image, x0, x1, y0, y1) {
  const { width, channels, pixels } = image;
  const lumaAt = (x, y) => {
    const o = (y * width + x) * channels;
    return (0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255;
  };
  let n = 0, sum = 0, blown = 0, crushed = 0, sat = 0, detail = 0;
  let r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * width + x) * channels;
      const pr = pixels[o], pg = pixels[o + 1], pb = pixels[o + 2];
      const luma = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
      if (x + 3 < x1 && y + 3 < y1) {
        detail += Math.abs(lumaAt(x + 3, y) - luma) + Math.abs(lumaAt(x, y + 3) - luma);
      }
      const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
      sum += luma; r += pr; g += pg; b += pb;
      sat += max === 0 ? 0 : (max - min) / max;
      if (max >= 250) blown += 1;
      if (max <= 8) crushed += 1;
      n += 1;
    }
  }
  const channelHex = (value) => Math.round(value / n).toString(16).padStart(2, "0");
  return {
    luma: (sum / n).toFixed(3),
    blown: ((blown / n) * 100).toFixed(1) + "%",
    crush: ((crushed / n) * 100).toFixed(1) + "%",
    sat: (sat / n).toFixed(2),
    detail: ((detail / n) * 100).toFixed(2),
    mean: "#" + channelHex(r) + channelHex(g) + channelHex(b)
  };
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
let failures = 0;
page.on("pageerror", (error) => { failures += 1; console.log("PAGE ERROR:", error.message); });
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    console.log(message.type().toUpperCase() + ":", message.text().slice(0, 400));
  }
});

await page.goto(pathToFileURL(target).href);
await page.waitForFunction(() => window.__oceanStudyReady === true, { timeout: 60000 });
await page.waitForFunction(() => window.__oceanModelsLoaded !== undefined, { timeout: 60000 });

const models = await page.evaluate(() => ({
  state: window.__oceanModelsLoaded,
  report: window.__oceanModelReport || null
}));
console.log("real models:", models.state);
if (models.report) {
  for (const [name, entry] of Object.entries(models.report)) {
    const verdict = entry.head.agrees ? "orientation agrees" : "ORIENTATION MISMATCH";
    if (!entry.head.agrees) failures += 1;
    console.log("  " + name.padEnd(9) + entry.triangles + " triangles, " + verdict);
  }
}

const presets = ["Above water", "Golden hour", "Reef", "Open water", "Twilight", "Abyssal plain"];
console.log("");
console.log("preset          | region | luma  | blown | crush | sat  | detail | mean");
for (const label of presets) {
  await page.evaluate((text) => {
    [...document.querySelectorAll("[data-viewer]")]
      .find((button) => button.textContent.startsWith(text)).click();
  }, label);
  await page.waitForTimeout(2600);
  const image = decodePng(await page.screenshot());
  // The rail owns the left 19.5rem of the page; only the frame is measured.
  const x0 = 320;
  const rows = [
    ["all", 0, image.height],
    ["top", 0, Math.floor(image.height / 3)],
    ["bot", Math.floor((2 * image.height) / 3), image.height]
  ];
  for (const [region, y0, y1] of rows) {
    const s = stats(image, x0, image.width, y0, y1);
    console.log(
      label.padEnd(15) + " | " + region.padEnd(6) + " | " + s.luma.padEnd(5) + " | " +
      s.blown.padEnd(5) + " | " + s.crush.padEnd(5) + " | " + s.sat.padEnd(4) + " | " +
      s.detail.padEnd(6) + " | " + s.mean
    );
  }
}

await browser.close();
if (failures > 0) {
  console.log("\n" + failures + " problem(s) reported above.");
  process.exit(1);
}
