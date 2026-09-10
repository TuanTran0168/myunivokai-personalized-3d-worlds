/**
 * Runs the built page on real GPU hardware and grades its own claims.
 *
 *   node demos/webgpu-node-path/build.mjs
 *   node demos/webgpu-node-path/measure.mjs
 *
 * THE LAUNCH LINE IS NOT A PREFERENCE, it is Phase 0's finding (§19.7 of
 * agent-system/research/webgpu-full-migration-feasibility-2026.md): on this
 * project's Windows / RTX 4060 target a hardware WebGPU frame needs BOTH
 * `channel: "chromium"` — because Playwright's default `headless: true`
 * launches `chromium_headless_shell`, a different binary with no GPU access at
 * all — AND `--disable-dawn-features=use_dxc`, because the pinned Chromium
 * enumerates the adapter and then fails `requestDevice()` on `dxil.dll` with
 * Windows error 87. Take either away and every probe measures SwiftShader or
 * the WebGL fallback, and the page still says PASSED.
 *
 * THREE LOADS, NOT ONE, and that is also a measurement rather than a habit.
 * Each backend gets its own document, because with both renderers alive in one
 * page the second one's environment probes threw from inside the FIRST one's
 * backend. The third load runs both together purely to report whether isolating
 * them changed any verdict — a Phase 4 harness has to make the same choice, and
 * this is the evidence for it.
 *
 * It also grades one thing the page cannot see. A WGSL compile failure is
 * reported by Dawn at browser level: three does not throw, nothing reaches the
 * page's console, and the draw is silently dropped. Only the process driving
 * the browser can observe it, so the pointUV verdict is completed here.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
// Playwright belongs to the web app, and ESM resolves bare specifiers from the
// importing file rather than from the working directory.
const appRequire = createRequire(pathToFileURL(resolve(repoRoot, "apps/myunivokai-personalization/package.json")));
const { chromium } = appRequire("@playwright/test");

const builtPage = resolve(here, "dist/webgpu-node-path.html");

const FULL_CHROMIUM_CHANNEL = "chromium";
const DISABLE_DXC_ARGUMENT = "--disable-dawn-features=use_dxc";
const PROBE_TIMEOUT_MILLISECONDS = 180_000;
const BACKEND_WEBGPU = "WebGPU";

const ISOLATED_WEBGPU_LOAD = { label: "WebGPU alone", query: "webgpu", graded: true };
const ISOLATED_WEBGL_LOAD = { label: "forceWebGL alone", query: "forcewebgl", graded: true };
const COMBINED_LOAD = { label: "both in one document", query: "webgpu,forcewebgl", graded: false };
const PAGE_LOADS = [ISOLATED_WEBGPU_LOAD, ISOLATED_WEBGL_LOAD, COMBINED_LOAD];

// The WGSL identifier that cannot exist, emitted by PointUVNode on every
// builder. Its presence in the browser log during the WebGPU load is the other
// half of the pointUV verdict.
const WGSL_POINT_COORD_FRAGMENT = "gl_PointCoord";

await access(builtPage).catch(() => {
  throw new Error(`${builtPage} not found. Run: node demos/webgpu-node-path/build.mjs`);
});

const browser = await chromium.launch({
  channel: FULL_CHROMIUM_CHANNEL,
  headless: true,
  args: [DISABLE_DXC_ARGUMENT]
});

async function runPageLoad(pageLoad) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const browserMessages = [];
  page.on("console", (message) => {
    // Warnings included deliberately: Dawn's shader-compilation failures arrive
    // as warnings, not errors, and they are the only trace such a failure
    // leaves anywhere.
    if (message.type() === "error" || message.type() === "warning") {
      browserMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));

  await page.goto(`${pathToFileURL(builtPage).href}?backends=${pageLoad.query}`);
  const environment = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    hasNavigatorGpu: "gpu" in navigator
  }));
  await page.waitForFunction(() => window.__WEBGPU_NODE_PATH_DONE === true, undefined, {
    timeout: PROBE_TIMEOUT_MILLISECONDS
  });
  const payload = await page.evaluate(() => window.__WEBGPU_NODE_PATH_RESULTS);
  await page.close();
  return { ...pageLoad, ...payload, environment, browserMessages };
}

const completedLoads = [];
for (const pageLoad of PAGE_LOADS) {
  completedLoads.push(await runPageLoad(pageLoad));
}
await browser.close();

const firstEnvironment = completedLoads[0].environment;
console.log(
  `page origin      file:// · secure context ${firstEnvironment.isSecureContext} · navigator.gpu ${firstEnvironment.hasNavigatorGpu}`
);
console.log("");

const PROBE_NAME_COLUMN_WIDTH = 30;
const VERDICT_COLUMN_WIDTH = 7;
let failingClaims = 0;

function claimKey(result, claim) {
  return `${result.backendName} · ${result.name} · ${claim.label}`;
}

for (const load of completedLoads.filter((load) => load.graded)) {
  console.log(`── ${load.label} ${"─".repeat(Math.max(0, 96 - load.label.length))}`);
  for (const result of load.results) {
    for (const claim of result.claims) {
      if (!claim.ok) failingClaims += 1;
      console.log(`  ${result.name.padEnd(PROBE_NAME_COLUMN_WIDTH)} ${(claim.ok ? "holds" : "FAILS").padEnd(VERDICT_COLUMN_WIDTH)} ${claim.label}`);
      console.log(`  ${" ".repeat(PROBE_NAME_COLUMN_WIDTH + VERDICT_COLUMN_WIDTH + 2)} ${claim.detail}`);
    }
    const metricEntries = Object.entries(result.metrics ?? {});
    if (metricEntries.length > 0) {
      console.log(`  ${" ".repeat(PROBE_NAME_COLUMN_WIDTH)} metrics ${metricEntries.map(([key, value]) => `${key}=${value}`).join("  ")}`);
    }
    console.log("");
  }
}

// The Phase 0 guard, applied one level up: if the WebGPU load did not land on
// the WebGPU backend, every WebGPU row above is a WebGL row wearing the wrong
// label, and the whole run is worthless rather than merely partial.
const webGpuLoad = completedLoads.find((load) => load === ISOLATED_WEBGPU_LOAD || load.query === ISOLATED_WEBGPU_LOAD.query);
const webGpuInitialisation = webGpuLoad?.results?.find(
  (result) => result.backendName === BACKEND_WEBGPU && result.name === "renderer-init"
);
const landedOnWebGpu = webGpuInitialisation?.claims?.every((claim) => claim.ok) === true;
if (!landedOnWebGpu) {
  console.log("FAULT  the WebGPU load did not land on the WebGPU backend, so its rows measure the fallback.");
  failingClaims += 1;
}

// The half of the pointUV verdict the page cannot reach.
const webGpuWgslFailure = (webGpuLoad?.browserMessages ?? []).find((message) => message.includes(WGSL_POINT_COORD_FRAGMENT));
console.log("── what only the browser could see " + "─".repeat(62));
console.log(
  webGpuWgslFailure
    ? `  holds   the WGSL compile failure IS reported, but only at browser level\n          ${webGpuWgslFailure.replace(/\s+/g, " ").slice(0, 180)}`
    : "  FAILS   no browser-level WGSL error naming gl_PointCoord was logged during the WebGPU load"
);
if (!webGpuWgslFailure) failingClaims += 1;
console.log("");

// Cross-backend comparison. Each page load knows one backend, so this is the
// only place the two can be put side by side — and side by side is the whole
// point: the migration's promise is that the fallback is indistinguishable, and
// these are the first numbers this project has for that.
const webGlLoad = completedLoads.find((load) => load.query === ISOLATED_WEBGL_LOAD.query);
function metricFor(load, probeName, metricName) {
  const result = load?.results?.find((entry) => entry.name === probeName);
  return result?.metrics?.[metricName];
}
console.log("── the two backends, side by side " + "─".repeat(63));
const comparisons = [
  {
    label: "first frame, 24 fresh pipelines",
    probe: "first-mount-pipeline-latency",
    metric: "firstFrameMilliseconds",
    unit: "ms"
  },
  {
    label: "longest main-thread block",
    probe: "first-mount-pipeline-latency",
    metric: "longestMainThreadGapMilliseconds",
    unit: "ms"
  },
  { label: "renderer init", probe: "renderer-init", metric: "initializationMilliseconds", unit: "ms" },
  { label: "read-back row 0 is the", probe: "render-target-color-pipeline", metric: "renderTargetRowZeroIs", unit: "" },
  {
    label: "warm reflection centroid x",
    probe: "environment-cube-camera-portal",
    metric: "warmHighlightCentroidX",
    unit: ""
  },
  {
    label: "warm reflection centroid y",
    probe: "environment-cube-camera-portal",
    metric: "warmHighlightCentroidY",
    unit: ""
  }
];
for (const comparison of comparisons) {
  const onWebGpu = metricFor(webGpuLoad, comparison.probe, comparison.metric);
  const onWebGl = metricFor(webGlLoad, comparison.probe, comparison.metric);
  console.log(
    `  ${comparison.label.padEnd(34)} WebGPU ${String(onWebGpu).padEnd(12)} forceWebGL ${String(onWebGl)}${comparison.unit}`
  );
}

// The one comparison that is a PASS/FAIL rather than a number: a fallback whose
// reflections land somewhere else is not a fallback, it is a second look.
const centroidOnWebGpu = {
  x: metricFor(webGpuLoad, "environment-cube-camera-portal", "warmHighlightCentroidX"),
  y: metricFor(webGpuLoad, "environment-cube-camera-portal", "warmHighlightCentroidY")
};
const centroidOnWebGl = {
  x: metricFor(webGlLoad, "environment-cube-camera-portal", "warmHighlightCentroidX"),
  y: metricFor(webGlLoad, "environment-cube-camera-portal", "warmHighlightCentroidY")
};
const MAXIMUM_ACCEPTABLE_CENTROID_DRIFT = 0.05;
const centroidDrift = Math.hypot(centroidOnWebGpu.x - centroidOnWebGl.x, centroidOnWebGpu.y - centroidOnWebGl.y);
const centroidsAgree = Number.isFinite(centroidDrift) && centroidDrift <= MAXIMUM_ACCEPTABLE_CENTROID_DRIFT;
console.log(
  centroidsAgree
    ? `  holds   the cube-camera reflection lands in the same place on both backends (drift ${centroidDrift.toFixed(3)})`
    : `  FINDING the cube-camera reflection lands in a DIFFERENT place on the two backends (drift ${centroidDrift.toFixed(3)} of frame diagonal)`
);
console.log("");

// Isolation: does running both renderers in one document change any verdict?
const isolatedVerdicts = new Map();
for (const load of completedLoads.filter((load) => load.graded)) {
  for (const result of load.results) {
    for (const claim of result.claims) isolatedVerdicts.set(claimKey(result, claim), claim);
  }
}
const combinedLoad = completedLoads.find((load) => !load.graded);
const contaminatedClaims = [];
for (const result of combinedLoad?.results ?? []) {
  for (const claim of result.claims) {
    const isolated = isolatedVerdicts.get(claimKey(result, claim));
    if (isolated && isolated.ok !== claim.ok) {
      contaminatedClaims.push({ key: claimKey(result, claim), isolated: isolated.ok, combined: claim.ok, detail: claim.detail });
    }
  }
}
console.log("── isolation: two renderers in one document " + "─".repeat(53));
if (contaminatedClaims.length === 0) {
  console.log("  no verdict changed, so the two renderers do not contaminate each other on this machine");
} else {
  console.log(`  ${contaminatedClaims.length} verdict(s) changed when both renderers shared a document:`);
  for (const entry of contaminatedClaims) {
    console.log(`    ${entry.key}`);
    console.log(`      alone ${entry.isolated ? "holds" : "FAILS"} · together ${entry.combined ? "holds" : "FAILS"} — ${entry.detail.slice(0, 160)}`);
  }
}
console.log("");

for (const load of completedLoads) {
  const pageErrors = load.consoleErrors ?? [];
  if (pageErrors.length > 0) {
    console.log(`console output during "${load.label}" (${pageErrors.length}):`);
    for (const message of pageErrors.slice(0, 12)) console.log(`  ${message.replace(/\s+/g, " ").slice(0, 200)}`);
    console.log("");
  }
}

const gradedClaimCount = completedLoads
  .filter((load) => load.graded)
  .reduce((total, load) => total + load.results.reduce((count, result) => count + result.claims.length, 0), 0);

console.log(
  failingClaims === 0
    ? `OK  every one of ${gradedClaimCount} graded claims holds`
    : `FAULT  ${failingClaims} of ${gradedClaimCount} graded claims do not hold`
);
process.exit(failingClaims === 0 ? 0 : 1);
