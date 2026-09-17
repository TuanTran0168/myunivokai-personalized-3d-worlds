import { expect, test, type Page } from "@playwright/test";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";
import oceanSurfaceWorld from "./fixtures/ocean-surface-world.json";

/**
 * WHAT THE FIRST MOUNT COSTS ON EACH BACKEND, IN THE APP RATHER THAN IN A PROBE.
 *
 * §26 Phase 11. §24.1 is the best performance evidence this project has and it
 * is all from the classic renderer: a family switch to the forest blocks the
 * main thread for **2108 ms**, of which **1121 ms** is `texSubImage2D` uploading
 * 8K textures and most of the rest is `getProgramParameter` re-linking shader
 * programs. §24.2 then says the migration's whole performance case rests on one
 * of those three — pipeline compilation — and marks it UNVERIFIED on this
 * ANGLE/D3D11 target. §24.3 says the risk runs the other way too: this app has
 * many distinct materials, every one becomes a pipeline, and creation could be
 * WORSE rather than better.
 *
 * §30.4 answered half of it already, and honestly labelled which half: 24
 * synthetic materials on a bare page, `renderer.init()` at 77 ms against 11 ms.
 * That is the renderer, not the app. **This file measures the app** — the same
 * fixture, the same machine, the same driver, three renderers, with the two
 * numbers §24.1 is actually made of.
 *
 * # What is measured, and why these two
 *
 * **Blocked main-thread time**, from `longtask` entries, because that is the
 * unit §24.1 uses and the unit a visitor feels: a page that renders at 400 fps
 * after freezing for two seconds is the problem this app already has.
 *
 * **Time to the sixtieth frame**, because the pipelines are not all created
 * when the first frame appears. The harness drives exactly sixty fixed steps
 * (`PINNED_CLOCK_STEP_COUNT`), so every backend is asked for the same work in
 * the same order, and anything created lazily on first use has been created by
 * the end of it.
 *
 * # What this is NOT
 *
 * **It is not a 60 fps gate**, and nothing here should be read as one. The
 * repo's performance bar is measured on a real GPU with nothing else running;
 * this runs a production build behind a Playwright driver with a browser
 * recording traces. The ceiling asserted below is a SMOKE ceiling — wide enough
 * that only §24.3's failure mode, pipeline creation going pathological, can
 * trip it. The numbers it prints are the deliverable; the assertion only stops
 * a catastrophic regression from being reported as a pass.
 */

const PINNED_SECONDS = 6;

/** Wide enough that scheduling noise cannot reach it. See the header. */
const FIRST_MOUNT_SMOKE_CEILING_MILLISECONDS = 30_000;

const HARNESS_READY_TIMEOUT_MILLISECONDS = 60_000;
const SCENE_ARRIVAL_MILLISECONDS = 2_500;
const MEASUREMENT_TIMEOUT_MILLISECONDS = 240_000;

const RENDERERS = ["webgl", "webgpu-forcewebgl", "webgpu"] as const;

const FIXTURES = [
  { name: "universe-world", worldId: universeWorld.world.id, family: "", oceanWorld: oceanShallowWorld },
  { name: "forest-world", worldId: natureWorld.world.id, family: "nature", oceanWorld: oceanShallowWorld },
  { name: "ocean-shallow", worldId: oceanShallowWorld.world.id, family: "ocean", oceanWorld: oceanShallowWorld },
  { name: "ocean-surface", worldId: oceanSurfaceWorld.world.id, family: "ocean", oceanWorld: oceanSurfaceWorld }
] as const;

type ParityHarnessWindow = Window & {
  __parityHarness?: { advanceToPinnedTime: () => Promise<void>; backend: string };
  __longTaskTotalMilliseconds?: number;
  __longTaskCount?: number;
};

async function serveWorldFixtures(page: Page, oceanWorld: unknown) {
  const routes = [
    ["**/api/nature/**", natureWorld],
    ["**/api/universe/**", universeWorld],
    ["**/api/ocean/**", oceanWorld]
  ] as const;
  for (const [path, world] of routes) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

/**
 * Installs the long-task recorder BEFORE any page script runs.
 *
 * `buffered: true` would replay entries the observer missed, but only those the
 * browser kept — and the expensive ones here happen during the very first
 * scripts. Installing first is the only way to be sure none is dropped, and
 * `addInitScript` is the one hook that runs earlier than the bundle.
 */
async function recordLongTasks(page: Page) {
  await page.addInitScript(() => {
    const target = window as ParityHarnessWindow;
    target.__longTaskTotalMilliseconds = 0;
    target.__longTaskCount = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          target.__longTaskTotalMilliseconds = (target.__longTaskTotalMilliseconds ?? 0) + entry.duration;
          target.__longTaskCount = (target.__longTaskCount ?? 0) + 1;
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // A browser without the long-task entry type reports zero rather than
      // failing the run. The two wall-clock numbers still measure something.
    }
  });
}

for (const fixture of FIXTURES) {
  for (const renderer of RENDERERS) {
    test(`${fixture.name} on ${renderer}: what the first mount costs`, async ({ page }) => {
      test.setTimeout(MEASUREMENT_TIMEOUT_MILLISECONDS);

      await recordLongTasks(page);
      await serveWorldFixtures(page, fixture.oceanWorld);

      const familyParameter = fixture.family ? `family=${fixture.family}&` : "";
      const navigationStart = Date.now();
      await page.goto(
        `/worlds/${fixture.worldId}?${familyParameter}parityRenderer=${renderer}&paritySeconds=${PINNED_SECONDS}`
      );

      // Twice, for the reason `scene-parity.spec.ts` documents at length: the
      // routed fixture arriving remounts the whole <Canvas>, so a harness seen
      // before the wait belongs to a registration that no longer exists. The
      // SECOND registration is the one whose cost this is measuring.
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });
      await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });
      const readyMilliseconds = Date.now() - navigationStart - SCENE_ARRIVAL_MILLISECONDS;

      const blockedBeforeFrames = await page.evaluate(
        () => (window as ParityHarnessWindow).__longTaskTotalMilliseconds ?? 0
      );

      // THE SIXTY FRAMES, which is where any pipeline created on first use is
      // created. Timed inside the page so the measurement does not include the
      // driver round trip.
      const frameMilliseconds = await page.evaluate(async () => {
        const startedAt = performance.now();
        await (window as ParityHarnessWindow).__parityHarness!.advanceToPinnedTime();
        return performance.now() - startedAt;
      });

      const blockedTotal = await page.evaluate(
        () => (window as ParityHarnessWindow).__longTaskTotalMilliseconds ?? 0
      );
      const longTaskCount = await page.evaluate(() => (window as ParityHarnessWindow).__longTaskCount ?? 0);
      const backend = await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.backend);

      console.log(
        `${fixture.name} · ${renderer} (${backend})\n` +
          `    to first registration   ${readyMilliseconds.toFixed(0)} ms\n` +
          `    sixty pinned frames     ${frameMilliseconds.toFixed(0)} ms\n` +
          `    main thread blocked     ${blockedTotal.toFixed(0)} ms in ${longTaskCount} long tasks` +
          ` (${blockedBeforeFrames.toFixed(0)} ms of it before the frames)`
      );

      // The smoke ceiling, not a performance gate. See the header.
      expect(
        frameMilliseconds,
        "sixty pinned frames took long enough that pipeline creation is the suspect (§24.3)"
      ).toBeLessThan(FIRST_MOUNT_SMOKE_CEILING_MILLISECONDS);
    });
  }
}
