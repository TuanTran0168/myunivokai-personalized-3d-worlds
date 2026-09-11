import { test, expect, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import universeWorld from "./fixtures/universe-world.json";
import natureWorld from "./fixtures/nature-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";
// A plain-ESM helper with a hand-written .d.mts beside it, the same shape
// `frameMetrics.mjs` uses: it stays JavaScript so it can be run under bare node
// alongside measure.mjs, and the declaration file keeps this a typed boundary.
import {
  BLANK_FRAME_LUMINANCE_DEVIATION,
  compareFrames,
  CROSS_BACKEND_TOLERANCE,
  describeComparison,
  inflatePng,
  luminanceStandardDeviation,
  SAME_RENDERER_TOLERANCE,
  toleranceBreaches
} from "./parityMetrics.mjs";

/**
 * THE THREE-WAY PARITY HARNESS.
 *
 * `scene-baseline.spec.ts` photographs scenes for a person to look at and
 * asserts nothing, for two stated reasons: WebGL output differs across GPUs, and
 * the animation phase is not pinned. Both are real, and §23.2 of
 * agent-system/research/webgpu-full-migration-feasibility-2026.md answers them
 * rather than arguing with them:
 *
 *   ONE MACHINE, ONE DRIVER. The comparison is between renderers, not between
 *   laptops, so the GPU objection does not apply to it.
 *
 *   ONE PINNED MOMENT. `?paritySeconds=` drives R3F's manual frameloop through a
 *   fixed sequence of timestamps, so every run reaches the same phase. That is
 *   what makes a pixel comparison mean something here and not there.
 *
 * The three renders, on the same fixture, viewport and pinned time:
 *
 *   WebGLRenderer                      today's baseline
 *   WebGPURenderer (WebGPU)            the migration's target
 *   WebGPURenderer (forceWebGL: true)  the fallback ~20% of users would land on
 *
 * STABILITY IS ASSERTED BEFORE PARITY, and that order is the point. The first
 * test renders one backend twice and requires the two frames to agree inside
 * SAME_RENDERER_TOLERANCE. If that fails, every later number is this harness
 * measuring its own noise, and Phase 4's acceptance criterion in §26 is exactly
 * this: "the harness reproduces today's WebGL output against itself within
 * tolerance — i.e. it is stable before it is trusted."
 *
 * THE BACKEND IS VERIFIED, NEVER ASSUMED. `WebGPURenderer.init()` rejecting
 * falls back to WebGL silently and by design — Phase 0 found the pinned browser
 * doing precisely that — so a run that skipped this check would photograph the
 * WebGL path three times and report perfect agreement. Every render asserts the
 * backend it actually got.
 *
 * WHAT THIS DOES NOT DO. It does not run in CI (no GPU there, and this project
 * has no Playwright in CI at all), it does not replace looking at the frames,
 * and it says nothing about any machine other than the one it ran on. A
 * perceptual metric cannot tell you the sea stopped reading as water.
 */

const FIXTURES = {
  universe: { world: universeWorld, path: "**/api/universe/**" },
  nature: { world: natureWorld, path: "**/api/nature/**" }
} as const;

/**
 * Three fixtures rather than the baseline suite's seven, and one per family.
 *
 * The point here is the RENDERER, and every extra fixture multiplies by three
 * renders plus a repeat. These three carry between them everything the migration
 * was least sure of: the universe's additive layers and its `toneMapped={false}`
 * emitters, the forest's `<Environment>` PMREM lighting and its patched foliage
 * shader, and the ocean's four hand-written shaders and its composer bypass.
 */
const PARITY_FIXTURES = [
  { name: "universe-world", worldId: universeWorld.world.id, family: undefined, oceanWorld: undefined },
  { name: "forest-world", worldId: natureWorld.world.id, family: "nature", oceanWorld: undefined },
  { name: "ocean-shallow", worldId: oceanShallowWorld.world.id, family: "ocean", oceanWorld: oceanShallowWorld }
] as const;

const PARITY_RENDERERS = [
  { query: "webgl", expectedBackend: "WebGLRenderer" },
  { query: "webgpu", expectedBackend: "WebGPUBackend/webgpu-coords" },
  { query: "webgpu-forcewebgl", expectedBackend: "WebGLBackend/webgl-coords" }
] as const;

/**
 * The failures that are the MIGRATION's, not the harness's — each named, each
 * with the line it comes from, and each tolerated as "blocked" rather than
 * thrown.
 *
 * This list is the ledger. A leg that dies of something on it is a known cost of
 * the current version; a leg that dies of anything else is a new fault and takes
 * the test down with the browser's own words attached. Adding an entry here is
 * therefore a deliberate admission, not a way to quieten a red test — and every
 * entry has to be removable by a named phase.
 */
const KNOWN_WEBGPU_BLOCKERS: readonly { fragment: string; name: string }[] = [
  {
    // postprocessing/build/index.js:990-994, and again at :1183. The chain
    // cannot be CONSTRUCTED against a WebGPURenderer: EffectComposer reads
    // `renderer.getContext().getContextAttributes().alpha`, and
    // WebGPURenderer.getContext() returns a GPUCanvasContext. Removed by Phase 5
    // (replace the chain with three's own RenderPipeline + TSL).
    fragment: "getContextAttributes is not a function",
    name: "postprocessing's EffectComposer cannot take a WebGPURenderer (setRenderer, build/index.js:994) — Phase 5"
  },
  {
    // The forest's `forceWebGL` leg, during the pinned frames. UNLIKE THE ENTRY
    // ABOVE, THIS ONE IS NOT LOCATED: the message is all there is so far, thrown
    // from inside `advanceToPinnedTime`, on the forest and not on the universe
    // or the ocean.
    //
    // Recorded rather than left red because it is reproducible and it is the
    // migration's, not the harness's — the same three legs work on two other
    // fixtures. Its shape resembles what Phase 1 found in `Nodes.delete`
    // (`three.webgpu.js:27796`), which dereferences a cache entry with no guard
    // and throws when a render object is disposed before it was ever built; the
    // forest is the fixture that mounts and disposes the most (drei
    // `<Environment>`, 51 material sites, GLTF variants). **That is a
    // resemblance, not a diagnosis**, and the entry says so on purpose. Whoever
    // takes Phase 6 should locate it before porting the forest.
    fragment: "Cannot read properties of undefined (reading 'get')",
    name: "forest on the node path throws mid-frame, cause NOT located — Phase 6 should find it before porting the forest"
  }
];

/**
 * THE DIVERGENCE LEDGER: what the backends measurably disagree by TODAY, and
 * which phase closes each entry.
 *
 * These are not tolerances, they are recorded debts. A comparison is allowed to
 * be no worse than its entry — so the suite is green while the gap stands, goes
 * red the moment the gap widens, and goes red again when a phase closes it and
 * the entry needs deleting. A ratchet in both directions, which is the only way
 * a known gap stays known.
 *
 * Safe as a ratchet because the harness's own noise is ZERO: the stability gate
 * measures mean 0.00 between two runs of the same renderer at the same pinned
 * time. The headroom below is for a driver update, not for jitter.
 *
 * WHAT THE NUMBERS SAY, and it is the most useful thing Phase 4 produced:
 *
 *   ocean-shallow  WebGPU against forceWebGL   mean  0.02   0.23% differing
 *   ocean-shallow  WebGPU against WebGL        mean 57.02  98.21% differing
 *   ocean-shallow  forceWebGL against WebGL    mean 57.02  98.21% differing
 *
 * The two NEW backends agree with each other to 0.02 of 255 and both disagree
 * with today's renderer by 57. So the WebGL2 fallback is faithful to the WebGPU
 * path — §28.3 item 1's fallback half, answered — and the whole gap is the node
 * path rendering this scene differently from the classic renderer, which is what
 * the ocean's four raw GLSL `ShaderMaterial`s not being node materials looks
 * like from the outside. The gap is the PORT (Phases 6-8), not the backend.
 */
const DIVERGENCE_HEADROOM = 1.1;

const KNOWN_BACKEND_DIVERGENCE: readonly {
  fixture: string;
  comparison: string;
  meanAbsoluteError: number;
  worstBlockError: number;
  differingFraction: number;
  closedBy: string;
}[] = [
  {
    fixture: "universe-world",
    comparison: "forceWebGL against WebGL",
    meanAbsoluteError: 25.71,
    worstBlockError: 185.18,
    differingFraction: 0.9773,
    closedBy: "Phases 6-8 (the nine shaders become node materials)"
  },
  {
    fixture: "ocean-shallow",
    comparison: "WebGPU against WebGL",
    meanAbsoluteError: 57.02,
    worstBlockError: 150.77,
    differingFraction: 0.9821,
    closedBy: "Phases 6-8 (the ocean's four raw GLSL shaders become TSL)"
  },
  {
    fixture: "ocean-shallow",
    comparison: "forceWebGL against WebGL",
    meanAbsoluteError: 57.02,
    worstBlockError: 151.2,
    differingFraction: 0.9821,
    closedBy: "Phases 6-8 (the ocean's four raw GLSL shaders become TSL)"
  }
];

/**
 * The tolerance a comparison is held to: its recorded debt if it has one,
 * otherwise the cross-backend tolerance — which is what a ported scene is
 * expected to meet.
 */
function toleranceFor(fixtureName: string, comparisonName: string) {
  const recorded = KNOWN_BACKEND_DIVERGENCE.find(
    (entry) => entry.fixture === fixtureName && entry.comparison === comparisonName
  );
  if (!recorded) return { tolerance: CROSS_BACKEND_TOLERANCE, recorded: null };
  return {
    tolerance: {
      meanAbsoluteError: recorded.meanAbsoluteError * DIVERGENCE_HEADROOM,
      worstBlockError: recorded.worstBlockError * DIVERGENCE_HEADROOM,
      differingFraction: Math.min(1, recorded.differingFraction * DIVERGENCE_HEADROOM)
    },
    recorded
  };
}

/**
 * Where the pinned clock stops.
 *
 * Late enough that the intro camera move has settled — `cameraIntro.ts` runs a
 * cinematic entry and a settle after it — and early enough that sixty steps of
 * 0.1 s each are a delta the scene's motion was authored for.
 */
const PINNED_SECONDS = 6;

/** Long enough for the lazy renderer chunk, the GLTF models and the PMREM bake. */
const HARNESS_READY_TIMEOUT_MILLISECONDS = 90_000;

/**
 * How long the scene is given to arrive before the clock is pinned.
 *
 * Not a settle time — with `frameloop="never"` nothing is moving. It is the
 * routed fixture, the lazy renderer chunk, the GLTF models and the environment
 * bake, all of which resolve on the network and through Suspense rather than
 * through the render loop.
 */
const SCENE_ARRIVAL_MILLISECONDS = 8_000;

type ParityHarnessWindow = Window & {
  __parityHarness?: {
    backend: string;
    requestedRenderer: string;
    pinnedSeconds: number;
    stepCount: number;
    advanceToPinnedTime: () => Promise<void>;
  };
};

/**
 * Collects everything the BROWSER says, which is more than the page says.
 *
 * Phase 1 measured that a WGSL compilation failure reaches neither an exception
 * nor the page's own `console`: Dawn rejects the shader module, Chrome logs it at
 * browser level as a warning, three carries on, and the draw is silently dropped
 * (§30.3). Only the process driving the browser can see it — so a harness that
 * did not collect this would report "the harness never appeared" and hide the
 * sentence that says why.
 *
 * Warnings included for exactly that reason.
 */
function collectBrowserMessages(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
  return messages;
}

async function waitForHarness(page: Page, browserMessages: string[], stage: string) {
  try {
    await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
      timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
    });
  } catch (error) {
    // Re-thrown with what the browser said, because "the harness never appeared"
    // on its own is the least informative possible description of a renderer
    // that failed to initialise.
    const recent = browserMessages.slice(-12).map((message) => message.replace(/\s+/g, " ").slice(0, 300));
    const said = recent.length > 0 ? recent.map((message) => `  ${message}`).join("\n") : "  (nothing)";
    throw new Error(`the parity harness never appeared (${stage}). The browser said:\n${said}`);
  }
}

async function serveWorldFixtures(page: Page, oceanWorld?: unknown) {
  if (oceanWorld) {
    await page.route("**/api/ocean/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oceanWorld) });
    });
  }
  for (const { world, path } of Object.values(FIXTURES)) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

/**
 * Renders one fixture through one renderer at the pinned time and returns the
 * canvas as decoded pixels, plus the backend that actually drew it.
 */
async function photographParityFrame(
  page: Page,
  fixture: (typeof PARITY_FIXTURES)[number],
  renderer: (typeof PARITY_RENDERERS)[number]
) {
  const browserMessages = collectBrowserMessages(page);
  await serveWorldFixtures(page, fixture.oceanWorld);
  // `family` is not optional decoration. The world page picks which family
  // service to fetch from by query parameter, exactly as the gallery links to it
  // (`lib/worldRoutes.ts`, and `scene-baseline.spec.ts:123,156` do the same) —
  // so a URL without it fetches the DEFAULT family for every fixture.
  //
  // Omitting it made all three fixtures render the same universe world, and the
  // comparison duly reported mean 25.71, worst block 185.18 at 800,288 and
  // 97.73% differing for universe, forest AND ocean. Three scenes agreeing to
  // four decimal places is not a parity result, it is an identity: the fixtures
  // were never reaching the page.
  const familyParameter = fixture.family ? `family=${fixture.family}&` : "";
  await page.goto(
    `/worlds/${fixture.worldId}?${familyParameter}parityRenderer=${renderer.query}&paritySeconds=${PINNED_SECONDS}`
  );

  // The bridge appears only once the renderer exists, which for the WebGPU
  // renderers means only once `init()` has resolved — so waiting for it is also
  // waiting for the async pre-flight.
  await waitForHarness(page, browserMessages, "first mount");

  // Let the scene finish arriving before the clock is pinned: the lazy chunk,
  // the models and the environment bake all resolve through Suspense, and
  // pinning a clock over a half-loaded scene photographs the loader.
  await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);

  // WAIT AGAIN, and read the backend AFTER the wait rather than before it.
  //
  // `UniverseCanvas` remounts the entire <Canvas> when `canvasRemountKey`
  // changes, and that key is built from the scene's seed and camera framing — so
  // it changes the moment the routed fixture arrives, which is during the wait
  // above. Checking the harness before the wait and using it afterwards read a
  // registration that a remount had already replaced, and three tests failed on
  // `Cannot read properties of undefined`. Everything the harness is asked for
  // now happens on the far side of the remount.
  await waitForHarness(page, browserMessages, "after the scene arrived");
  const backend = await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.backend);

  // The Phase 0 guard. A silent fallback here would make every comparison below
  // a comparison of WebGL against itself, passing beautifully and proving
  // nothing.
  expect(backend, `${fixture.name} on ${renderer.query} landed on the wrong backend`).toBe(
    renderer.expectedBackend
  );

  await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.advanceToPinnedTime());

  // `canvas[data-engine]`, not `canvas`, and this is not a tidy-up.
  //
  // three stamps `data-engine="three.js rNNN"` on the canvas it owns. The world
  // page carries a SECOND canvas — WorldTransition's aria-hidden warp overlay —
  // and when a renderer fails, `WebGLFailureBoundary` removes the scene canvas
  // and leaves that one behind. A bare `locator("canvas").first()` then
  // photographs the overlay and the comparison still produces numbers.
  //
  // It produced numbers: universe-world and ocean-shallow came back with
  // BYTE-IDENTICAL statistics — mean 25.71, worst block 185.18 at the same
  // 800,288, 97.73% differing — for two completely different scenes. Two scenes
  // cannot agree to four decimal places, and that impossibility is the only
  // thing that revealed it. A parity harness that photographs the wrong element
  // is the same class of failure as Phase 0's silent fallback, one layer out.
  const sceneCanvas = page.locator("canvas[data-engine]");
  await expect(
    sceneCanvas,
    `${fixture.name} on ${renderer.query}: the scene canvas is gone, so the renderer failed after registering. ` +
      `The browser said: ${browserMessages.slice(-6).join(" | ").slice(0, 600)}`
  ).toHaveCount(1, { timeout: 10_000 });
  const screenshot = await sceneCanvas.screenshot({ animations: "disabled" });
  const frame = inflatePng(screenshot, inflateSync);

  // DID THIS LEG DRAW ANYTHING? Asked before any comparison, because a
  // comparison cannot tell.
  //
  // §26 Phase 5's node chain built its graph with a `null` centre node. three
  // logged `THREE.TSL: TypeError: Cannot read properties of null (reading
  // 'build')` — LOGGED, not thrown — `RenderPipeline` rendered an empty canvas,
  // and this harness reported the two new backends as byte-identical to 0.00.
  // Which was true. Two blank frames are identical, and the number was
  // published before anyone looked at the image.
  //
  // Phase 1 had already recorded the shape of this (§30.3: a WGSL compile
  // failure is invisible from inside the page and the draw is simply dropped).
  // What was missing was this line.
  const structure = luminanceStandardDeviation(frame);
  expect(
    structure,
    `${fixture.name} on ${renderer.query}: the canvas is BLANK — luminance deviation ` +
      `${structure.toFixed(2)}, floor ${BLANK_FRAME_LUMINANCE_DEVIATION}. The renderer reported success and ` +
      `drew nothing, so every comparison below would have compared one flat colour with another. ` +
      `The browser said: ${browserMessages.slice(-8).join(" | ").slice(0, 800)}`
  ).toBeGreaterThan(BLANK_FRAME_LUMINANCE_DEVIATION);

  return { frame, backend, screenshot, browserMessages, structure };
}

test.describe("scene parity across renderers", () => {
  /**
   * THE GATE. Nothing below this test means anything if it fails.
   *
   * Two renders of the same fixture through the same renderer at the same pinned
   * time. Whatever they disagree by is this harness's noise floor, and it has to
   * be small before a difference between backends can be called a difference at
   * all.
   */
  test("is stable against itself before it is trusted", async ({ page }) => {
    const fixture = PARITY_FIXTURES[0];
    const renderer = PARITY_RENDERERS[0];
    const first = await photographParityFrame(page, fixture, renderer);
    const second = await photographParityFrame(page, fixture, renderer);
    const comparison = compareFrames(first.frame, second.frame);
    const breaches = toleranceBreaches(comparison, SAME_RENDERER_TOLERANCE);
    console.log(`  stability ${fixture.name} ${renderer.query} twice: ${describeComparison(comparison)}`);
    expect(
      breaches,
      `the harness is not reproducible, so no parity number below is meaningful: ${breaches.join("; ")}`
    ).toEqual([]);
  });

  /**
   * THE SECOND GATE, and it exists because its absence produced a number.
   *
   * If two fixtures render the same scene, every comparison below is a
   * comparison of one scene against itself and passes or fails for reasons that
   * have nothing to do with a renderer. That is not hypothetical: without the
   * `family` query parameter the world page fetched the default family for all
   * three fixtures, and the suite reported mean 25.71, worst block 185.18 at
   * 800,288 and 97.73% differing for universe, forest and ocean alike —
   * identical to four decimal places, which is the only reason anyone noticed.
   *
   * So the fixtures now have to prove they are different scenes before their
   * parity numbers are read. A harness that cannot tell its own inputs apart is
   * worse than no harness, because it produces numbers.
   */
  test("the fixtures are actually different scenes", async ({ page }) => {
    const webglLeg = PARITY_RENDERERS[0];
    const frames = new Map<string, Awaited<ReturnType<typeof photographParityFrame>>>();
    for (const fixture of PARITY_FIXTURES) {
      frames.set(fixture.name, await photographParityFrame(page, fixture, webglLeg));
    }
    const identical: string[] = [];
    for (let leftIndex = 0; leftIndex < PARITY_FIXTURES.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < PARITY_FIXTURES.length; rightIndex += 1) {
        const leftName = PARITY_FIXTURES[leftIndex].name;
        const rightName = PARITY_FIXTURES[rightIndex].name;
        const comparison = compareFrames(frames.get(leftName)!.frame, frames.get(rightName)!.frame);
        console.log(`  distinctness ${leftName} against ${rightName}: ${describeComparison(comparison)}`);
        // Two different families must differ by far more than two backends do.
        if (comparison.meanAbsoluteError <= CROSS_BACKEND_TOLERANCE.meanAbsoluteError) {
          identical.push(`${leftName} and ${rightName} (mean ${comparison.meanAbsoluteError.toFixed(2)})`);
        }
      }
    }
    expect(
      identical,
      `these fixtures rendered the same scene, so no parity number is meaningful: ${identical.join("; ")}`
    ).toEqual([]);
  });

  for (const fixture of PARITY_FIXTURES) {
    /**
     * ONE TEST THAT ADAPTS TO THE TRUTH INSTEAD OF ENCODING A GUESS.
     *
     * The three-way comparison cannot run on this version, and the reason is
     * measured rather than assumed. `postprocessing@6.39.4`'s `EffectComposer`
     * calls `renderer.getContext().getContextAttributes().alpha` in
     * `setRenderer` (`build/index.js:990-994`, and again in `addPass` at
     * `:1183`). `WebGPURenderer.getContext()` returns a `GPUCanvasContext`,
     * which has no such method — so the chain cannot be CONSTRUCTED against a
     * WebGPU renderer, let alone rendered with. §11 of the feasibility report
     * reached the same conclusion by counting 878 WebGL-class references in the
     * library; this is the one line where it actually fails, and it fails before
     * a single frame.
     *
     * So instead of skipping, this test ASSERTS THE BLOCKER. Every leg is
     * attempted; a leg that dies of the known cause is recorded as blocked, and
     * a leg that dies of anything else fails the test with what the browser
     * said. The day Phase 5 replaces the chain, the WebGPU legs stop being
     * blocked, the comparison runs, and this test starts grading images without
     * anyone having to remember to re-enable it. A blocker asserted is a blocker
     * tracked; a test skipped is a blocker forgotten.
     */
    test(`${fixture.name} renders the same on all three backends`, async ({ page }, testInfo) => {
      const frames = new Map<string, Awaited<ReturnType<typeof photographParityFrame>>>();
      const blocked: string[] = [];

      for (const renderer of PARITY_RENDERERS) {
        try {
          const photographed = await photographParityFrame(page, fixture, renderer);
          frames.set(renderer.query, photographed);
          await testInfo.attach(`${fixture.name}-${renderer.query}`, {
            body: photographed.screenshot,
            contentType: "image/png"
          });
        } catch (error) {
          const reported = error instanceof Error ? error.message : String(error);
          const isKnownBlocker = KNOWN_WEBGPU_BLOCKERS.find((blocker) => reported.includes(blocker.fragment));
          if (!isKnownBlocker) throw error;
          blocked.push(`${renderer.query} — ${isKnownBlocker.name}`);
          console.log(`  ${fixture.name} · ${renderer.query}: BLOCKED, ${isKnownBlocker.name}`);
        }
      }

      const baseline = frames.get("webgl");
      expect(baseline, "the WebGL baseline itself did not render; nothing else can be compared").toBeDefined();

      // (2) vs (1) is the migration's question, (3) vs (1) is the fallback's,
      // and (2) vs (3) asks whether the two new backends at least agree with
      // each other — which is the one comparison that isolates the backends from
      // anything the app does differently under a node material.
      const comparisons = [
        ["WebGPU against WebGL", "webgpu", "webgl"],
        ["forceWebGL against WebGL", "webgpu-forcewebgl", "webgl"],
        ["WebGPU against forceWebGL", "webgpu", "webgpu-forcewebgl"]
      ] as const;

      const breachesByComparison: string[] = [];
      for (const [name, leftKey, rightKey] of comparisons) {
        const left = frames.get(leftKey);
        const right = frames.get(rightKey);
        if (!left || !right) continue;
        const comparison = compareFrames(left.frame, right.frame);
        const { tolerance, recorded } = toleranceFor(fixture.name, name);
        console.log(
          `  ${fixture.name} · ${name}: ${describeComparison(comparison)}` +
            (recorded ? `  [recorded debt, closed by ${recorded.closedBy}]` : "")
        );
        const breaches = toleranceBreaches(comparison, tolerance);
        if (breaches.length > 0) breachesByComparison.push(`${name} — ${breaches.join("; ")}`);
        // The other half of the ratchet: a debt that has been paid must be
        // deleted, or it silently licenses a regression back to it later.
        if (recorded && comparison.meanAbsoluteError < recorded.meanAbsoluteError * 0.5) {
          breachesByComparison.push(
            `${name} — the recorded divergence of ${recorded.meanAbsoluteError} has more than halved to ` +
              `${comparison.meanAbsoluteError.toFixed(2)}. Delete or lower its entry in KNOWN_BACKEND_DIVERGENCE.`
          );
        }
      }

      expect(breachesByComparison, breachesByComparison.join(" | ")).toEqual([]);

      // Recorded as a test annotation rather than only a log line, so the state
      // of the blocker travels with the report instead of scrolling past.
      if (blocked.length > 0) {
        testInfo.annotations.push({ type: "blocked", description: blocked.join("; ") });
      }
      // And the counterpart: when nothing is blocked any more, say so loudly.
      // This is the line that tells whoever lands Phase 5 that the harness is
      // now grading three images instead of one.
      expect(
        blocked.length,
        blocked.length === 0
          ? "every backend rendered — the three-way comparison is live"
          : `blocked legs: ${blocked.join("; ")}`
      ).toBeLessThanOrEqual(PARITY_RENDERERS.length - 1);
    });
  }
});
