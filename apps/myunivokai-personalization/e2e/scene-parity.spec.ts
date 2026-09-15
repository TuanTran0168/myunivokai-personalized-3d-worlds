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
  // REMOVED 2026-09-11, and what it was is worth keeping: an entry reading
  // "forest on the node path throws mid-frame, cause NOT located — Phase 6
  // should find it before porting the forest", matching
  // `Cannot read properties of undefined (reading 'get')`.
  //
  // Phase 6 went looking and found nothing left to catch.
  // `e2e/node-path-diagnostic.spec.ts` renders all three fixtures on both node
  // backends on the real GPU and keeps the STACKS this file deliberately drops:
  // zero throws, zero page errors, every leg reaching its pinned frame. Phase 5
  // had closed it — the forest mounted `PostEffects`, and `EffectComposer`
  // cannot be CONSTRUCTED against a node renderer — and the entry was written
  // before the node chain existed.
  //
  // **A LEDGER OF KNOWN FAILURES HAS TO BE RE-RUN, NOT READ.** This one outlived
  // its cause by a phase and read as a live blocker the whole time. The cost was
  // not the entry, it was that the forest produced NO parity number for as long
  // as it stood.
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
 * path — §28.3 item 1's fallback half, answered — and the gap is the node path
 * rendering this scene differently from the classic renderer. Phase 4 read that
 * as "the gap is the PORT (Phases 6-8), not the backend", because the ocean's
 * raw GLSL `ShaderMaterial`s are exactly what the node builder refuses.
 *
 * **CORRECTED, TWICE, AND THE SECOND TIME IS NOT A REFINEMENT OF THE FIRST.**
 *
 *   2026-09-11  The forest became the first family with no hand-written shader
 *               left and STILL differs by 19.49. A finished port is therefore
 *               not the same thing as a matching frame.
 *   2026-09-15  The universe became the second, and its gap did not move at all
 *               — 12.19 before the port, 12.22 after. Two families is no longer
 *               an anomaly, and "the gap is the port" cannot be repaired by
 *               narrowing it to the ocean.
 *
 * What the universe's entry below adds is that the residual has now been
 * measured rather than only named: same clock, same camera, same fifty objects
 * at the same world positions, and a frame that is systematically brighter in
 * the shadows and midtones. That is the POST CHAIN — two implementations of the
 * same six passes, pmndrs against three's TSL nodes — and no shader port closes
 * it. **So the ocean's 57.02 is no longer evidence for what the ocean's own six
 * shaders cost.** Some fraction of it is whatever the other two families are
 * made of; the rest is measurable only once those six are ported.
 *
 * The fallback half of Phase 4's claim survives both corrections intact, on
 * every fixture measured: 0.02 ocean, 0.45 universe, 1.24 forest between WebGPU
 * and forceWebGL.
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
  /**
   * **THE UNIVERSE IS THE SECOND FULLY PORTED FAMILY, AND ITS NUMBER DID NOT
   * MOVE.** Both entries below used to say they would be closed by Phase 8 —
   * "SizedStarPoints and NebulaCloudPoints become node materials". Phase 8 is
   * done: those two layers are node materials, the diagnostic prints zero
   * `THREE.NodeBuilder: Material "ShaderMaterial" is not compatible` for this
   * fixture (against six per node backend for the ocean), and the gap went from
   * 12.19 to 12.22. That is not the port failing. It is the SAME correction the
   * forest forced one entry down, arrived at from the other direction, and two
   * families agreeing is no longer a coincidence: §26's "the gap is the PORT
   * (Phases 6-8), not the backend" is wrong as a general claim.
   *
   * WHAT WAS ELIMINATED, by measurement rather than by argument. The harness now
   * reports the scene it is about to draw (`ParityHarnessBridge.readSceneState`),
   * and at the pinned moment all three backends agree on:
   *
   *   the clock          6.0000 on all three
   *   the camera         position and quaternion identical to four decimals
   *   the scene graph    50 drawn objects, world-position checksum 26.501
   *
   * So the renderers were handed the SAME arrangement of the SAME objects from
   * the SAME viewpoint. Two confident hypotheses died there — the camera rig's
   * intro, which integrates across frames, and a difference in orbital phase —
   * and neither survived the first read.
   *
   * WHAT IS LEFT, AND IT IS NOT IN THE SCENE. Sampling the same scanline out of
   * both frames, the node path sits systematically brighter in the shadows and
   * midtones ACROSS THE WHOLE FRAME, including the top edge far from the sun
   * (0.07 -> 0.10, 0.09 -> 0.14, 0.12 -> 0.19 of 1.0), while the saturated sun
   * core matches to 0.03. A global lift that spares the clipped highlights is
   * the signature of the POST CHAIN, and the two chains are two different
   * implementations of the same six passes: pmndrs' `EffectComposer` against
   * three's TSL nodes, bloom for bloom and vignette for vignette. Nothing a
   * shader port touches.
   *
   * NOT ESTABLISHED, and deliberately not guessed at: which pass, and by how
   * much. The experiment that would settle it is a run with post disabled on
   * both paths; it needs a lever the harness does not have yet, and inventing
   * one to confirm a hypothesis is how the last two died.
   */
  {
    fixture: "universe-world",
    comparison: "forceWebGL against WebGL",
    meanAbsoluteError: 12.03,
    worstBlockError: 204.74,
    differingFraction: 0.6086,
    closedBy: "the post chain, NOT a shader port — the universe has no GLSL left. See the block above."
  },
  // MEASURED FOR THE FIRST TIME 2026-09-11. This leg used to be tolerated as a
  // render failure rather than compared, and the universe's `WebGPU against
  // WebGL` was never recorded at all.
  {
    fixture: "universe-world",
    comparison: "WebGPU against WebGL",
    meanAbsoluteError: 12.22,
    worstBlockError: 205.48,
    differingFraction: 0.6109,
    closedBy: "the post chain, NOT a shader port — the universe has no GLSL left. See the block above."
  },
  /**
   * THE FOREST'S FIRST NUMBERS EVER, AND THEY ARE NOT A PORT DEBT.
   *
   * This fixture produced nothing until 2026-09-11, because a stale entry in
   * KNOWN_RENDER_FAILURES above tolerated its legs as failures. It now renders
   * on both node backends, and it is the FIRST FAMILY WITH NO HAND-WRITTEN
   * SHADER LEFT: its one `onBeforeCompile` patch became a `colorNode` in
   * `forest/forestFoliageMaterial.ts`, and nothing else in its tree is a
   * `ShaderMaterial`.
   *
   * **So 19.49 is what a FULLY PORTED family still differs by, and that is the
   * most interesting number in this list.** §26 says "the gap is the PORT
   * (Phases 6-8), not the backend". For the forest the port is done and 19.49
   * of gap remains, so that sentence is not the whole story. The candidates,
   * none of which is yet isolated and which are therefore named rather than
   * diagnosed:
   *
   *   - the forest's ambient occlusion, which is N8AO on the composer chain and
   *     three's GTAO on the node chain. §26 Phase 5 already marks this the one
   *     deliberate look change it hands to the owner's eye, and it is the only
   *     effect that applies to this family and not to the universe.
   *   - drei's `<Environment>` PMREM bake, which each renderer performs with its
   *     own pipeline.
   *   - three's own conversion of stock `MeshStandardMaterial`s to node
   *     materials, which is not a no-op and which nothing here has measured.
   *
   * The two node backends agree with each other to 1.24, so whatever this is,
   * it is not the WebGL2 fallback diverging from WebGPU.
   */
  {
    fixture: "forest-world",
    comparison: "WebGPU against WebGL",
    meanAbsoluteError: 19.49,
    worstBlockError: 72.31,
    differingFraction: 0.8757,
    closedBy: "the AO retune and the PMREM bake, NOT a shader port — the forest has no GLSL left"
  },
  {
    fixture: "forest-world",
    comparison: "forceWebGL against WebGL",
    meanAbsoluteError: 19.5,
    worstBlockError: 72.37,
    differingFraction: 0.8751,
    closedBy: "the AO retune and the PMREM bake, NOT a shader port — the forest has no GLSL left"
  },
  /**
   * **THE OCEAN IS PART PORTED, AND THIS ENTRY IS THE ONLY ONE THAT WILL MOVE
   * FOR MORE THAN ONE REASON.** Four of its six `ShaderMaterial`s — the jellyfish
   * bell, the bubble stream, marine snow and the backdrop dome — are node
   * materials as of 2026-09-15; the surface seen from below and the god rays are
   * not, and neither are its eight `onBeforeCompile` patches.
   *
   * So the number below is a MIXTURE, and reading it as "what the ocean's
   * shaders cost" is what the two entries above already had to be corrected
   * for. Some of it is the post chain, which the universe measured and which no
   * shader port closes.
   *
   * **THE PROGRESS SIGNAL FOR A PART-PORTED FAMILY IS NOT THIS NUMBER.**
   * `node-path-diagnostic.spec.ts` counts the node builder's refusals — one per
   * material still on the GLSL path — and prints it per backend. It went 6 -> 4
   * when the two drifters landed, 4 -> 3 with marine snow and 3 -> 2 with the
   * backdrop, which is exact, and it will reach 0 before this entry can be
   * deleted.
   *
   * **AND THE BACKDROP IS THE CASE THAT PROVES WHY THIS ENTRY IS NOT THE
   * SIGNAL.** Porting it moved the node frame by mean 0.00, with 0.00% of pixels
   * differing: the dome is entirely occluded from this fixture's camera, so a
   * real port of the largest surface in the scene is worth exactly nothing here.
   * A number that cannot see a finished port cannot be used to grade one.
   *
   * Why the number RISES as the port proceeds — 57.02, then 57.07, then 57.30 —
   * rather than falling. Before each step the node path drew those layers NOT AT
   * ALL, because the builder refused them. It now draws them, onto a water column
   * and a seabed that are still wrong, so an alpha-blended layer cannot cancel
   * against the classic frame however faithful it is. The difference map says the
   * same thing plainly: the flood is the god rays, the backdrop and the terrain
   * patches, and the drifters appear only as small rings at the RIGHT positions.
   *
   * So this entry will keep rising until the water is ported, and that is not a
   * regression. The refusal count is the number to watch until then.
   */
  {
    fixture: "ocean-shallow",
    comparison: "WebGPU against WebGL",
    meanAbsoluteError: 57.3,
    worstBlockError: 150.77,
    differingFraction: 0.9821,
    closedBy: "Phases 6-8 for PART of it — two shaders and eight patches remain — and the post chain for the rest"
  },
  {
    fixture: "ocean-shallow",
    comparison: "forceWebGL against WebGL",
    meanAbsoluteError: 57.3,
    worstBlockError: 151.2,
    differingFraction: 0.9821,
    closedBy: "Phases 6-8 for PART of it — two shaders and eight patches remain — and the post chain for the rest"
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
