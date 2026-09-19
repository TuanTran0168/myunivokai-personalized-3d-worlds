import { expect, test, type Page } from "@playwright/test";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";

/**
 * WHICH RENDERER AN ORDINARY VISITOR ACTUALLY GETS, WITH NOTHING CONFIGURED.
 *
 * Every other spec in this directory pins a renderer through the parity
 * harness, because every other spec is comparing renderers. **This one pins
 * nothing**, which makes it the only automated check of the decision the
 * rollout added: with `NEXT_PUBLIC_NODE_RENDERER` unset — which is what
 * production reads, since the variable is set nowhere in this repository — the
 * app now builds a `WebGPURenderer` where the browser has a real WebGPU
 * adapter, and the classic `WebGLRenderer` where it does not.
 *
 * # The expectation is derived, not hardcoded per project
 *
 * The suite runs the same file on three projects with two very different
 * graphics stacks: `desktop` and `mobile` pin SwiftShader, which has no WebGPU
 * at all, and `webgpu` runs the real driver. Writing "expect webgpu on the
 * webgpu project" would turn a policy test into a restatement of the config.
 *
 * Instead the page is asked what WebGPU it has, through `navigator.gpu`
 * directly rather than through anything the app exports, and the expected
 * renderer is derived from that answer. The two sides are then independent: one
 * is the browser's own report, the other is what the app chose after making the
 * same call for itself. **On SwiftShader this asserts the veto, and on the real
 * driver it asserts the rollout** — the two halves of the same policy, each
 * checked on the machine that can actually exercise it.
 *
 * # What is asserted, and why it is the telemetry payload
 *
 * `graphicsBackend` on the client-render report, because it is the field the
 * owner will read after release to see the split, and because
 * `reportClientRender.ts` is explicit that it is **asked of the renderer, never
 * of the build flag** — a `WebGPURenderer` whose `requestDevice()` was refused
 * reports `webgl2`, not `webgpu`. So this measures what DREW, which is the only
 * thing worth asserting: a rollout that selected the node renderer and then
 * silently fell back would pass a check on the selection and fail this one.
 *
 * # What this does NOT check
 *
 * The kill switch and the `every-visitor` rollout, because `NEXT_PUBLIC_*` is
 * inlined by Next at BUILD time and this suite builds the app once. Changing
 * either would mean a second production build per assertion, for a value whose
 * parsing is already covered by `rendererSelection.test.ts`. Saying so here is
 * cheaper than a spec that appears to cover them and does not.
 */

const CLIENT_RENDER_REPORT_PATH = "/api/telemetry/render";

/** The classic renderer. What every visitor got before the rollout. */
const BACKEND_WEBGL = "webgl";
/** `WebGPURenderer` on the backend the rollout exists to reach. */
const BACKEND_WEBGPU = "webgpu";
/** `WebGPURenderer` on its WebGL2 fallback — the 13.6 s forest, and a failure here. */
const BACKEND_WEBGL2 = "webgl2";

const SCENE_READY_TIMEOUT_MILLISECONDS = 120_000;
const ROLLOUT_TIMEOUT_MILLISECONDS = 180_000;

/**
 * Markers that identify a CPU rasteriser, mirroring `webgpuSupport.ts`.
 *
 * Deliberately a SECOND copy rather than an import: this list is the test's
 * independent opinion of what a software adapter looks like, and importing the
 * app's would make the assertion agree with the code by construction.
 */
const SOFTWARE_ADAPTER_MARKERS = ["swiftshader", "lavapipe", "llvmpipe", "warp", "basic render", "software"];

const ROLLOUT_FIXTURES = [
  // The forest first, because it is the fixture the veto exists for: §26 Phase
  // 13 measured 13593 ms of blocked main thread on the node renderer's WebGL2
  // backend against 3596 ms classic. A `webgl2` answer on this row is the
  // regression the rollout was designed to make unreachable.
  { name: "forest", worldId: natureWorld.world.id, family: "nature" },
  { name: "universe", worldId: universeWorld.world.id, family: undefined }
] as const;

type ClientRenderReportWindow = Window & {
  __clientRenderReports?: { graphicsBackend?: string; outcome?: string }[];
};

async function serveWorldFixtures(page: Page) {
  const routes = [
    ["**/api/nature/**", natureWorld],
    ["**/api/universe/**", universeWorld],
    ["**/api/ocean/**", oceanShallowWorld]
  ] as const;
  for (const [path, world] of routes) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

/**
 * Captures the client-render report in the page rather than on the wire.
 *
 * `reportClientRender` prefers `navigator.sendBeacon`, and a beacon carrying a
 * `Blob` is not something Playwright's request interception reads back
 * reliably. Wrapping both transports in the page is deterministic, needs no
 * gateway listening on the other end, and still reads the exact object the app
 * would have sent.
 */
async function captureClientRenderReports(page: Page) {
  await page.addInitScript((reportPath: string) => {
    const reportWindow = window as ClientRenderReportWindow;
    reportWindow.__clientRenderReports = [];
    const record = (body: unknown) => {
      if (typeof body !== "string") {
        return;
      }
      try {
        reportWindow.__clientRenderReports!.push(JSON.parse(body));
      } catch {
        // A body that is not the report is not this test's business.
      }
    };

    const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalSendBeacon) {
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        if (String(url).includes(reportPath)) {
          if (data instanceof Blob) {
            void data.text().then(record);
          } else {
            record(data);
          }
          return true;
        }
        return originalSendBeacon(url, data);
      };
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (requested.includes(reportPath)) {
        record(init?.body);
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      return originalFetch(input, init);
    };
  }, CLIENT_RENDER_REPORT_PATH);
}

/**
 * What WebGPU this browser has, asked by the test itself.
 *
 * Stops at the adapter for the same reason `webgpuSupport.ts` does — a second
 * live `GPUDevice` on the page would be a cost with no buyer — and treats an
 * adapter that describes itself as nothing as hardware, which is the app's
 * stance and the one this assertion has to share or it would fail on a browser
 * with privacy redaction rather than on a defect.
 */
async function browserHasHardwareWebGPU(page: Page, softwareMarkers: readonly string[]): Promise<boolean> {
  return page.evaluate(async (markers) => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      return false;
    }
    try {
      const adapter = (await gpu.requestAdapter()) as { info?: Record<string, string> } | null;
      if (!adapter) {
        return false;
      }
      const described = Object.values(adapter.info ?? {})
        .filter((field) => typeof field === "string")
        .join(" ")
        .toLowerCase();
      return !markers.some((marker) => described.includes(marker));
    } catch {
      return false;
    }
  }, softwareMarkers);
}

for (const fixture of ROLLOUT_FIXTURES) {
  test(`${fixture.name}: an unconfigured build picks the renderer this browser can actually run`, async ({
    page
  }, testInfo) => {
    test.setTimeout(ROLLOUT_TIMEOUT_MILLISECONDS);

    await captureClientRenderReports(page);
    await serveWorldFixtures(page);

    const familyParameter = fixture.family ? `?family=${fixture.family}` : "";
    // NO `parityRenderer`. That absence is the whole test.
    await page.goto(`/worlds/${fixture.worldId}${familyParameter}`);

    const hasHardwareWebGPU = await browserHasHardwareWebGPU(page, SOFTWARE_ADAPTER_MARKERS);
    const expectedBackend = hasHardwareWebGPU ? BACKEND_WEBGPU : BACKEND_WEBGL;

    await page.waitForFunction(
      () => ((window as ClientRenderReportWindow).__clientRenderReports?.length ?? 0) > 0,
      undefined,
      { timeout: SCENE_READY_TIMEOUT_MILLISECONDS }
    );

    const reports = await page.evaluate(() => (window as ClientRenderReportWindow).__clientRenderReports ?? []);
    const reportedBackend = reports[0]?.graphicsBackend;

    console.log(
      `${testInfo.project.name} · ${fixture.name}: ` +
        `hardware WebGPU ${hasHardwareWebGPU} → expected ${expectedBackend}, drew ${reportedBackend}`
    );

    /**
     * **THE REGRESSION THE ROLLOUT EXISTS TO MAKE UNREACHABLE**, asserted before
     * the equality so that a failure names the right thing. `webgl2` means a
     * `WebGPURenderer` went to its WebGL2 backend on an ordinary visit, which is
     * the configuration measured at four times the classic renderer's blocked
     * first mount on this very fixture.
     */
    expect(
      reportedBackend,
      "an ordinary visit must never land on the node renderer's WebGL2 backend"
    ).not.toBe(BACKEND_WEBGL2);

    expect(reportedBackend).toBe(expectedBackend);
  });
}
