/**
 * Ask one question, in every browser mode this repository could plausibly use:
 * does a headless Chromium on this machine get a REAL WebGPU adapter?
 *
 * This is Phase 0 of
 * agent-system/research/webgpu-full-migration-feasibility-2026.md, and it gates
 * every phase after it. The reasoning is short: a WebGPU migration whose visual
 * parity cannot be photographed is a redesign wearing a migration's clothes.
 * Everything in `e2e/` exists because nothing else in this repo can see the
 * canvas — so if the harness cannot reach WebGPU, the new renderer is invisible
 * to the only instrument that would catch it rendering the wrong thing.
 *
 * Two independent reasons it might not, and this probe separates them instead
 * of guessing:
 *
 *   1. FLAGS. playwright.config.ts pins `--use-angle=swiftshader` at the
 *      top-level `use.launchOptions`, so both the `desktop` and `mobile`
 *      projects inherit it. SwiftShader is a software GL implementation; it is
 *      not a WebGPU implementation at all.
 *   2. MODE. Since Playwright 1.49 `headless: true` launches
 *      `chromium_headless_shell`, a smaller binary than the full Chromium that
 *      `channel: "chromium"` selects. They are different builds, and GPU
 *      support is exactly the kind of thing a stripped build strips.
 *
 * A flags problem is a two-line fix in a new Playwright project. A mode problem
 * needs a different binary. Blaming the wrong one costs a day, so the matrix
 * below varies them separately and prints what each combination actually got.
 *
 * No WebGPU-enabling flag is passed anywhere on purpose. WebGPU has shipped on
 * Windows Chrome since 113; passing `--enable-unsafe-webgpu` would measure a
 * browser nobody runs and hide the answer we came for.
 *
 * The report is a hardware string, not a boolean. `adapter.info.description`
 * distinguishing an RTX 4060 from a software rasteriser is the actual Phase 0
 * validation criterion, and `isFallbackAdapter` is checked separately because a
 * fallback adapter answers `requestAdapter()` successfully while being the
 * thing we are trying to avoid.
 *
 * Usage:  node e2e/webgpu-adapter-probe.mjs
 *         node e2e/webgpu-adapter-probe.mjs --headed   (adds a visible window)
 *
 * Needs no dev server: the page is served by fulfilling the route, over https,
 * because WebGPU requires a secure context and this keeps the probe independent
 * of `npm run build`.
 */
import { chromium } from "@playwright/test";

/**
 * An https origin that intentionally does not resolve. Route fulfilment happens
 * before DNS, so nothing leaves the machine, while the page still gets an https
 * origin — and therefore `isSecureContext === true`, which WebGPU requires.
 */
const PROBE_ORIGIN = "https://webgpu-adapter-probe.myunivokai.test";
const PROBE_URL = `${PROBE_ORIGIN}/probe`;

/**
 * The shape of the origin the screenshot suite actually loads — plain http on a
 * loopback address, `SHOOT_PORT` defaulting to 41300 in playwright.config.ts.
 * Checked separately because WebGPU requires a secure context and the whole
 * harness would be disqualified by an insecure one. The spec calls loopback
 * "potentially trustworthy", which should make this fine; a claim that cheap to
 * verify should not be left as a should.
 */
const HARNESS_ORIGIN_SHAPE = "http://127.0.0.1:41300/world/probe";
const PROBE_PAGE_BODY =
  "<!doctype html><meta charset=\"utf-8\"><title>WebGPU adapter probe</title><body></body>";

/** Copied verbatim from playwright.config.ts so this measures the real harness. */
const SUITE_SWIFTSHADER_ARGUMENTS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-lcd-text",
  "--force-device-scale-factor=1",
];

/** ANGLE on D3D11 — the backend this project's WebGL measurements were taken on. */
const ANGLE_D3D11_ARGUMENTS = ["--use-gl=angle", "--use-angle=d3d11"];

/**
 * Dawn compiles WGSL to HLSL and then needs a shader compiler. `use_dxc` picks
 * DXC, which loads `dxil.dll` and `dxcompiler.dll` at runtime; disabling it
 * falls back to FXC, which is built in. Worth measuring because Playwright's
 * bundled Chromium ships both DLLs and Dawn still refuses to open them.
 */
const DISABLE_DXC_ARGUMENTS = ["--disable-dawn-features=use_dxc"];

const PLAYWRIGHT_DEFAULT_HEADLESS_BINARY = undefined;
const FULL_CHROMIUM_CHANNEL = "chromium";
const INSTALLED_CHROME_CHANNEL = "chrome";
const INSTALLED_EDGE_CHANNEL = "msedge";

const PROBE_TARGETS = [
  {
    name: "headless shell · suite's SwiftShader flags",
    intent: "exactly what `npm run shoot` runs today",
    channel: PLAYWRIGHT_DEFAULT_HEADLESS_BINARY,
    headless: true,
    args: SUITE_SWIFTSHADER_ARGUMENTS,
  },
  {
    name: "headless shell · no flags",
    intent: "isolates the flags from the binary",
    channel: PLAYWRIGHT_DEFAULT_HEADLESS_BINARY,
    headless: true,
    args: [],
  },
  {
    name: "full Chromium headless · no flags",
    intent: "the cheapest possible fix if the shell is the problem",
    channel: FULL_CHROMIUM_CHANNEL,
    headless: true,
    args: [],
  },
  {
    name: "full Chromium headless · ANGLE/D3D11",
    intent: "matches the WebGL backend the perf baseline was measured on",
    channel: FULL_CHROMIUM_CHANNEL,
    headless: true,
    args: ANGLE_D3D11_ARGUMENTS,
  },
  {
    name: "full Chromium headless · SwiftShader flags",
    intent: "does the SwiftShader pin also blind a full browser?",
    channel: FULL_CHROMIUM_CHANNEL,
    headless: true,
    args: SUITE_SWIFTSHADER_ARGUMENTS,
  },
  {
    name: "full Chromium headless · DXC disabled",
    intent: "keeps the pinned browser and routes around the dxil.dll failure",
    channel: FULL_CHROMIUM_CHANNEL,
    headless: true,
    args: DISABLE_DXC_ARGUMENTS,
  },
  {
    name: "installed Chrome headless · no flags",
    intent: "the browser real users run, if the bundled build cannot be fixed",
    channel: INSTALLED_CHROME_CHANNEL,
    headless: true,
    args: [],
  },
  {
    name: "installed Edge headless · no flags",
    intent: "second opinion on whether the failure is the build or the machine",
    channel: INSTALLED_EDGE_CHANNEL,
    headless: true,
    args: [],
  },
];

const HEADED_PROBE_TARGET = {
  name: "full Chromium headed · no flags",
  intent: "the control: if this fails, the machine cannot do it at all",
  channel: FULL_CHROMIUM_CHANNEL,
  headless: false,
  args: [],
};

const NOT_AVAILABLE = "—";

/**
 * Runs inside the page. Returns data only — every failure is captured as a
 * string rather than thrown, because "requestDevice rejected with X" is a
 * result, not an error in the probe.
 */
async function collectAdapterFacts() {
  const facts = {
    isSecureContext: window.isSecureContext,
    hasNavigatorGpu: Boolean(navigator.gpu),
    webglRenderer: null,
    preferredCanvasFormat: null,
    wgslLanguageFeatureCount: null,
    defaultAdapter: null,
    highPerformanceAdapter: null,
    compatibilityAdapter: null,
    device: null,
    canvasClear: null,
  };

  const probeCanvas = document.createElement("canvas");
  const webglContext =
    probeCanvas.getContext("webgl2") ?? probeCanvas.getContext("webgl");
  if (webglContext) {
    const debugRendererInfo = webglContext.getExtension("WEBGL_debug_renderer_info");
    facts.webglRenderer = debugRendererInfo
      ? webglContext.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)
      : webglContext.getParameter(webglContext.RENDERER);
  }

  if (!navigator.gpu) return facts;

  facts.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat?.() ?? null;
  facts.wgslLanguageFeatureCount = navigator.gpu.wgslLanguageFeatures?.size ?? null;

  async function describeAdapter(options) {
    const startedAt = performance.now();
    let adapter = null;
    try {
      adapter = await navigator.gpu.requestAdapter(options);
    } catch (error) {
      return { error: String(error) };
    }
    const elapsedMilliseconds = Math.round(performance.now() - startedAt);
    if (!adapter) return { resolvedNull: true, elapsedMilliseconds };
    const adapterInfo = adapter.info ?? {};
    return {
      elapsedMilliseconds,
      vendor: adapterInfo.vendor ?? null,
      architecture: adapterInfo.architecture ?? null,
      device: adapterInfo.device ?? null,
      description: adapterInfo.description ?? null,
      // Moved onto `info` by the spec; the old top-level property is read too
      // so an older Chromium still answers.
      isFallbackAdapter:
        adapterInfo.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
      featureCount: adapter.features?.size ?? null,
      // The names, not just the count: a workaround that costs two features is
      // only assessable once you know which two.
      featureNames: adapter.features ? [...adapter.features].sort() : null,
      maxTextureDimension2D: adapter.limits?.maxTextureDimension2D ?? null,
      maxBufferSize: adapter.limits?.maxBufferSize ?? null,
      maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? null,
      maxComputeWorkgroupsPerDimension:
        adapter.limits?.maxComputeWorkgroupsPerDimension ?? null,
      hasTimestampQuery: adapter.features?.has("timestamp-query") ?? null,
      hasTextureCompressionBc: adapter.features?.has("texture-compression-bc") ?? null,
      hasFloat32Filterable: adapter.features?.has("float32-filterable") ?? null,
      adapterHandle: adapter,
    };
  }

  const defaultAdapterFacts = await describeAdapter(undefined);
  const defaultAdapter = defaultAdapterFacts.adapterHandle ?? null;
  delete defaultAdapterFacts.adapterHandle;
  facts.defaultAdapter = defaultAdapterFacts;

  const highPerformanceFacts = await describeAdapter({ powerPreference: "high-performance" });
  delete highPerformanceFacts.adapterHandle;
  facts.highPerformanceAdapter = highPerformanceFacts;

  // `featureLevel: "compatibility"` is the spec's opt-in to older hardware. It
  // matters here because it is one of the two things that could widen the ~20%
  // of users the report expects to land on the WebGL2 fallback.
  const compatibilityFacts = await describeAdapter({ featureLevel: "compatibility" });
  delete compatibilityFacts.adapterHandle;
  facts.compatibilityAdapter = compatibilityFacts;

  if (!defaultAdapter) return facts;

  let device = null;
  const deviceStartedAt = performance.now();
  try {
    device = await defaultAdapter.requestDevice();
    facts.device = {
      elapsedMilliseconds: Math.round(performance.now() - deviceStartedAt),
      featureCount: device.features?.size ?? null,
      maxTextureDimension2D: device.limits?.maxTextureDimension2D ?? null,
      lost: false,
    };
    device.lost.then(() => {
      if (facts.device) facts.device.lost = true;
    });
  } catch (error) {
    facts.device = { error: String(error) };
    return facts;
  }

  // The end-to-end check: configure a real canvas context, clear it, and wait
  // for the queue. This is the difference between "an adapter exists" and "this
  // browser can actually put a WebGPU frame together" — which is what a
  // renderer swap needs.
  try {
    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = 64;
    renderCanvas.height = 64;
    const webgpuContext = renderCanvas.getContext("webgpu");
    if (!webgpuContext) {
      facts.canvasClear = { error: "getContext(\"webgpu\") returned null" };
      return facts;
    }
    webgpuContext.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });
    const commandEncoder = device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: webgpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0.5, b: 1, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    facts.canvasClear = { ok: true };
  } catch (error) {
    facts.canvasClear = { error: String(error) };
  }

  return facts;
}

/**
 * Re-runs the probe on the harness's own origin shape, in one already-usable
 * launch mode, to confirm plain-http loopback is not the thing that disqualifies
 * it. Route-fulfilled like the main probe, so it needs no dev server.
 */
async function probeHarnessOriginShape(target) {
  const browser = await chromium.launch({
    channel: target.channel,
    headless: target.headless,
    args: target.args,
  });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: PROBE_PAGE_BODY }),
    );
    await page.goto(HARNESS_ORIGIN_SHAPE);
    return await page.evaluate(collectAdapterFacts);
  } finally {
    await browser.close();
  }
}

async function probeTarget(target) {
  let browser = null;
  try {
    browser = await chromium.launch({
      channel: target.channel,
      headless: target.headless,
      args: target.args,
    });
  } catch (error) {
    return { target, launchError: String(error) };
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: PROBE_PAGE_BODY }),
    );
    await page.goto(PROBE_URL);
    const facts = await page.evaluate(collectAdapterFacts);
    return { target, browserVersion: browser.version(), facts };
  } catch (error) {
    return { target, probeError: String(error) };
  } finally {
    await browser.close();
  }
}

function formatAdapter(adapterFacts) {
  if (!adapterFacts) return NOT_AVAILABLE;
  if (adapterFacts.error) return `error: ${adapterFacts.error}`;
  if (adapterFacts.resolvedNull) {
    return `resolved null after ${adapterFacts.elapsedMilliseconds} ms`;
  }
  const identity =
    adapterFacts.description ||
    [adapterFacts.vendor, adapterFacts.architecture, adapterFacts.device]
      .filter(Boolean)
      .join(" / ") ||
    "(no identifying fields)";
  const fallbackNote =
    adapterFacts.isFallbackAdapter === true
      ? " [FALLBACK ADAPTER]"
      : adapterFacts.isFallbackAdapter === null
        ? " [isFallbackAdapter unreported]"
        : "";
  return `${identity}${fallbackNote} · ${adapterFacts.elapsedMilliseconds} ms`;
}

function reportResult(result) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(result.target.name);
  console.log(`  why: ${result.target.intent}`);
  console.log(
    `  launch: channel=${result.target.channel ?? "(playwright default)"}` +
      ` headless=${result.target.headless} args=${result.target.args.length > 0 ? result.target.args.join(" ") : "(none)"}`,
  );

  if (result.launchError) {
    console.log(`  LAUNCH FAILED: ${result.launchError.split("\n")[0]}`);
    return;
  }
  if (result.probeError) {
    console.log(`  PROBE FAILED: ${result.probeError.split("\n")[0]}`);
    return;
  }

  const { facts } = result;
  console.log(`  chromium: ${result.browserVersion}`);
  console.log(`  secure context: ${facts.isSecureContext}`);
  console.log(`  WebGL renderer: ${facts.webglRenderer ?? "no WebGL context at all"}`);
  console.log(`  navigator.gpu: ${facts.hasNavigatorGpu ? "present" : "ABSENT"}`);
  if (!facts.hasNavigatorGpu) return;

  console.log(`  preferred canvas format: ${facts.preferredCanvasFormat ?? NOT_AVAILABLE}`);
  console.log(`  wgsl language features: ${facts.wgslLanguageFeatureCount ?? NOT_AVAILABLE}`);
  console.log(`  adapter (default):          ${formatAdapter(facts.defaultAdapter)}`);
  console.log(`  adapter (high-performance): ${formatAdapter(facts.highPerformanceAdapter)}`);
  console.log(`  adapter (compatibility):    ${formatAdapter(facts.compatibilityAdapter)}`);

  const adapter = facts.defaultAdapter;
  if (adapter && !adapter.error && !adapter.resolvedNull) {
    console.log(
      `  adapter limits: maxTextureDimension2D=${adapter.maxTextureDimension2D}` +
        ` maxBufferSize=${adapter.maxBufferSize}` +
        ` maxStorageBufferBindingSize=${adapter.maxStorageBufferBindingSize}` +
        ` maxComputeWorkgroupsPerDimension=${adapter.maxComputeWorkgroupsPerDimension}`,
    );
    console.log(
      `  adapter features: ${adapter.featureCount}` +
        ` (timestamp-query=${adapter.hasTimestampQuery}` +
        ` texture-compression-bc=${adapter.hasTextureCompressionBc}` +
        ` float32-filterable=${adapter.hasFloat32Filterable})`,
    );
    console.log(`    ${(adapter.featureNames ?? []).join(", ")}`);
  }

  if (facts.device?.error) {
    console.log(`  requestDevice: FAILED — ${facts.device.error}`);
  } else if (facts.device) {
    console.log(
      `  requestDevice: ok in ${facts.device.elapsedMilliseconds} ms` +
        ` (features=${facts.device.featureCount}, lost=${facts.device.lost})`,
    );
  }

  if (facts.canvasClear?.ok) {
    console.log("  canvas clear + queue drain: ok — this browser can present a WebGPU frame");
  } else if (facts.canvasClear?.error) {
    console.log(`  canvas clear + queue drain: FAILED — ${facts.canvasClear.error}`);
  }
}

function isHardwareAdapter(facts) {
  const adapter = facts?.defaultAdapter;
  if (!facts?.hasNavigatorGpu || !adapter || adapter.error || adapter.resolvedNull) return false;
  if (adapter.isFallbackAdapter === true) return false;
  const identity = `${adapter.description ?? ""} ${adapter.vendor ?? ""} ${adapter.architecture ?? ""} ${adapter.device ?? ""}`;
  const looksLikeSoftware = /swiftshader|software|lavapipe|basic render|microsoft basic/i.test(identity);
  return !looksLikeSoftware;
}

/**
 * The gate, and it is deliberately stricter than "a hardware adapter exists".
 *
 * The first version of this script passed on the adapter alone, and on this
 * machine that was wrong in the most misleading way available: the RTX 4060 is
 * enumerated with 15 features and real limits, and then `requestDevice()`
 * rejects. An adapter that cannot become a device renders nothing, so a harness
 * built on that signal would have reported a working WebGPU path while
 * photographing an empty canvas — which is the exact failure mode
 * playwright.config.ts's own comments describe for the SwiftShader flag.
 */
function reachesWebGpuFrame(facts) {
  return isHardwareAdapter(facts) && facts?.canvasClear?.ok === true;
}

function describeStatus(result) {
  if (result.launchError) return "launch failed";
  if (result.probeError) return "probe failed";
  if (reachesWebGpuFrame(result.facts)) return "HARDWARE WebGPU, frame presented";
  if (isHardwareAdapter(result.facts)) {
    const reason =
      result.facts.device?.error ?? result.facts.canvasClear?.error ?? "unknown";
    return `hardware adapter but NO frame — ${reason.split("\n")[0]}`;
  }
  if (result.facts?.hasNavigatorGpu) return "navigator.gpu present, no hardware adapter";
  return "no WebGPU";
}

async function main() {
  const includeHeaded = process.argv.includes("--headed");
  const targets = includeHeaded ? [...PROBE_TARGETS, HEADED_PROBE_TARGET] : PROBE_TARGETS;

  console.log("WebGPU adapter probe — Phase 0 of the WebGPU-first migration feasibility report");
  console.log(`page: ${PROBE_URL} (route-fulfilled, https, no dev server)`);
  if (!includeHeaded) {
    console.log("pass --headed to add a visible-window control run");
  }

  const results = [];
  for (const target of targets) {
    const result = await probeTarget(target);
    reportResult(result);
    results.push(result);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("VERDICT — one row per launch mode\n");
  const nameColumnWidth = Math.max(...targets.map((target) => target.name.length));
  for (const result of results) {
    console.log(`  ${result.target.name.padEnd(nameColumnWidth)}  ${describeStatus(result)}`);
  }

  const usableModes = results.filter((result) => reachesWebGpuFrame(result.facts));
  console.log(
    `\nPhase 0 gate: ${usableModes.length > 0 ? "PASSED" : "FAILED"} — ${usableModes.length} of ${results.length} launch modes can present a hardware WebGPU frame`,
  );
  if (usableModes.length === 0) return;

  for (const mode of usableModes) {
    console.log(
      `  usable: ${mode.target.name} — channel=${mode.target.channel ?? "(playwright default)"}` +
        ` args=${mode.target.args.length > 0 ? mode.target.args.join(" ") : "(none)"}`,
    );
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`SECURE CONTEXT on the harness's own origin shape — ${HARNESS_ORIGIN_SHAPE}`);
  console.log(`  launch mode: ${usableModes[0].target.name}`);
  const harnessOriginFacts = await probeHarnessOriginShape(usableModes[0].target);
  console.log(`  isSecureContext: ${harnessOriginFacts.isSecureContext}`);
  console.log(`  navigator.gpu: ${harnessOriginFacts.hasNavigatorGpu ? "present" : "ABSENT"}`);
  console.log(`  adapter: ${formatAdapter(harnessOriginFacts.defaultAdapter)}`);
  console.log(
    `  frame presented: ${reachesWebGpuFrame(harnessOriginFacts) ? "yes" : `no — ${harnessOriginFacts.device?.error ?? harnessOriginFacts.canvasClear?.error ?? "unknown"}`}`,
  );
}

await main();
