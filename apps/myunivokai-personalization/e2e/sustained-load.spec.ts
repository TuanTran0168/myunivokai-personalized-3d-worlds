import { expect, test, type Page } from "@playwright/test";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";
import oceanSurfaceWorld from "./fixtures/ocean-surface-world.json";

/**
 * WHAT A FRAME COSTS ONCE THE SCENE HAS SETTLED, ON EACH RENDERER.
 *
 * Stage 1 of `agent-system/plans/frontend/webgpu-graphics-upgrade-roadmap.md`,
 * and the plan puts it first because every graphics upgrade below it makes a
 * frame-time claim that cannot otherwise be checked. This project has measured
 * visual parity to a hundredth of a grey level and the cost of a first mount to
 * the millisecond, and has never once measured what a frame costs after the
 * scene arrives.
 *
 * `first-mount-cost.spec.ts` is its sibling and answers the other question: how
 * long the tab is frozen before anything is drawn. A change can improve one and
 * ruin the other — §26 Phase 13 is exactly that shape — so the two are separate
 * files with separate numbers rather than one table nobody can read.
 *
 * # What the numbers are
 *
 * Milliseconds per frame, at a fixed sixty-per-second timeline, after sixty
 * warm-up frames are stepped and discarded. **Percentiles, not a mean**: the
 * repo's bar is a FLOOR — 60 fps, quality-first, never lowered for weaker
 * hardware — and a floor is broken by the worst frames. A scene whose mean is
 * 9 ms and whose p99 is 40 ms stutters, and its mean says it does not.
 *
 * # What these numbers are NOT
 *
 * **Not a frame rate.** A stepped loop cannot tell you the browser sustained
 * anything; it tells you what each frame cost when it was asked for. Nothing
 * here is called fps for that reason.
 *
 * **Not a gate.** The assertion below is a SMOKE ceiling, wide enough that only
 * a catastrophe trips it, for the same reason `first-mount-cost.spec.ts` gives:
 * this runs a production build behind a Playwright driver with a browser
 * recording traces, and a real 60 fps claim is measured on the bare machine.
 * The printed percentiles are the deliverable; the assertion only stops a
 * collapse from being reported as a pass.
 *
 * **One machine.** RTX 4060 Laptop under ANGLE/D3D11, one run per cell.
 *
 * # Reading the three legs against each other, which is the trap
 *
 * The per-frame number is the cost of the `advance()` call, which is the work
 * the CPU does to build and submit the frame. On the WebGPU backend the GPU
 * then works asynchronously, so its column is nearer to pure submission cost
 * than the other two — the queue drain at the end is what catches whatever had
 * piled up behind it, and it is printed rather than folded in.
 *
 * So the comparison this file is FOR is a fixture against ITSELF, on the SAME
 * leg, before and after a change. Reading across the three legs is a second,
 * weaker question, and `last frame drew` is here so that it can be asked at
 * all: two legs that cost different milliseconds while issuing the same draw
 * calls over the same triangles were asked for the same work.
 *
 * Run it with `--project=webgpu`: the two SwiftShader projects have no WebGPU
 * and would time the software rasteriser, which is about ten times slower and
 * would report every scene as broken.
 */

const HARNESS_READY_TIMEOUT_MILLISECONDS = 60_000;
const SCENE_ARRIVAL_MILLISECONDS = 2_500;
const MEASUREMENT_TIMEOUT_MILLISECONDS = 300_000;

/**
 * Wide enough that scheduling noise cannot reach it, and narrow enough that a
 * frame budget blown by an order of magnitude cannot pass. A 60 fps frame is
 * 16.7 ms; this is twelve of them.
 */
const SUSTAINED_SMOKE_CEILING_MILLISECONDS = 200;

const RENDERERS = ["webgl", "webgpu-forcewebgl", "webgpu"] as const;

const FIXTURES = [
  { name: "universe-world", worldId: universeWorld.world.id, family: "", oceanWorld: oceanShallowWorld },
  { name: "forest-world", worldId: natureWorld.world.id, family: "nature", oceanWorld: oceanShallowWorld },
  { name: "ocean-shallow", worldId: oceanShallowWorld.world.id, family: "ocean", oceanWorld: oceanShallowWorld },
  { name: "ocean-surface", worldId: oceanSurfaceWorld.world.id, family: "ocean", oceanWorld: oceanSurfaceWorld }
] as const;

type SustainedReport = {
  frameCount: number;
  medianMilliseconds: number;
  ninetyFifthPercentileMilliseconds: number;
  ninetyNinthPercentileMilliseconds: number;
  worstMilliseconds: number;
  meanMilliseconds: number;
  framesOverBudget: number;
  totalMilliseconds: number;
  drainMilliseconds: number;
  lastFrameDrawCalls: number;
  lastFrameTriangles: number;
};

type ParityHarnessWindow = Window & {
  __parityHarness?: {
    backend: string;
    measureSustainedFrames: () => Promise<SustainedReport>;
  };
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

for (const fixture of FIXTURES) {
  for (const renderer of RENDERERS) {
    test(`${fixture.name} on ${renderer}: what a settled frame costs`, async ({ page }) => {
      test.setTimeout(MEASUREMENT_TIMEOUT_MILLISECONDS);

      await serveWorldFixtures(page, fixture.oceanWorld);
      const familyParameter = fixture.family ? `family=${fixture.family}&` : "";
      await page.goto(`/worlds/${fixture.worldId}?${familyParameter}parityRenderer=${renderer}`);

      // Twice, for the reason `scene-parity.spec.ts` documents at length: the
      // routed fixture arriving remounts the whole <Canvas>, so a harness seen
      // before the wait belongs to a registration that no longer exists.
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });
      await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });

      const backend = await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.backend);
      const report = await page.evaluate(
        async () => await (window as ParityHarnessWindow).__parityHarness!.measureSustainedFrames()
      );

      console.log(
        `${fixture.name} · ${renderer} (${backend})\n` +
          `    per frame, ms       p50 ${report.medianMilliseconds.toFixed(2)}` +
          `  p95 ${report.ninetyFifthPercentileMilliseconds.toFixed(2)}` +
          `  p99 ${report.ninetyNinthPercentileMilliseconds.toFixed(2)}` +
          `  worst ${report.worstMilliseconds.toFixed(2)}\n` +
          `    mean                ${report.meanMilliseconds.toFixed(2)} ms over ${report.frameCount} frames\n` +
          `    over 16.7 ms        ${report.framesOverBudget} frames` +
          ` (${((report.framesOverBudget / Math.max(1, report.frameCount)) * 100).toFixed(1)}%)\n` +
          `    last frame drew     ${report.lastFrameDrawCalls} calls, ${report.lastFrameTriangles} triangles\n` +
          `    queue drain at end  ${report.drainMilliseconds.toFixed(1)} ms`
      );

      expect(report.frameCount, "no frames were timed, so nothing here is a measurement").toBeGreaterThan(0);
      expect(
        report.medianMilliseconds,
        "the median frame cost enough that something collapsed rather than regressed"
      ).toBeLessThan(SUSTAINED_SMOKE_CEILING_MILLISECONDS);
    });
  }
}
