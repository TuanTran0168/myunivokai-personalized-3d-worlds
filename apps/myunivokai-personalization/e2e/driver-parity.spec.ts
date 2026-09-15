import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { compareBlockMeans, describeBlockComparison, inflatePng } from "./parityMetrics.mjs";
import universeWorld from "./fixtures/universe-world.json";
import natureWorld from "./fixtures/nature-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";

/**
 * THE SAME CODE ON TWO DRIVERS, WHICH NOTHING HERE HAD EVER COMPARED.
 *
 * §23.2's harness compares RENDERERS on one driver. The screenshot suite compares
 * COMMITS on one driver. Both pin SwiftShader — deliberately, because the value
 * of a before/after image is that two runs differ only by the code between them.
 * Nothing compared one driver against another, and that gap hid a bug for the
 * app's whole life: the universe's star rendered as a black disc on an RTX 4060
 * and correctly on SwiftShader, because a NaN fragment is resolved differently by
 * each, and every committed baseline is SwiftShader (see `star-is-lit.spec.ts`
 * and `NonNegativeColour.tsx`).
 *
 * That failure has a SHAPE this comparison is good at: a NaN or an out-of-range
 * value ruins a REGION and leaves the rest of the frame alone, which is what
 * `worstBlockError` was built to catch. Legitimate driver differences —
 * antialiasing patterns, texture filtering, dither — are small and spread out.
 *
 * HOW IT WORKS ACROSS PROJECTS. Playwright runs projects in declaration order
 * with one worker, so `desktop` (SwiftShader) always runs before `webgpu` (the
 * real GPU). The SwiftShader pass WRITES each frame; the real-GPU pass READS it
 * back and compares. Run the `webgpu` project alone and there is nothing to
 * compare against, and the test says so rather than passing quietly.
 *
 * NOT IN CI. No GPU there, and this project runs no Playwright in CI
 * (`agent-system/rules/ci-quality-gates.md`).
 */

const SOFTWARE_DRIVER_PROJECT = "desktop";
const REAL_DRIVER_PROJECT = "webgpu";
const DRIVER_FRAME_DIRECTORY = join("test-results", "driver-frames");
const SCENE_ARRIVAL_MILLISECONDS = 20_000;

/**
 * THE CLOCK IS PINNED, AND WITHOUT THAT THIS COMPARISON MEANS NOTHING.
 *
 * The first version let each driver render freely for eight seconds and compared
 * the results: mean block 7.30 to 26.67, worst block 101.99 to 159.38. Almost all
 * of that was the ANIMATION PHASE. SwiftShader renders this app at a fraction of
 * the RTX 4060's rate, so after the same wall-clock wait the two frames hold
 * planets in different places, and a planet that has moved is a region whose
 * brightness changed — the exact signature this file is looking for.
 *
 * §26 Phase 4's harness exists to remove that variable: `frameloop="never"` plus
 * a fixed list of timestamps reproduces one exact phase on any machine at any
 * speed. It is reached here with `parityRenderer=webgl`, which is today's
 * renderer — the point is to vary the DRIVER and nothing else.
 */
const PINNED_SECONDS = 6;

/**
 * THE FIRST TOLERANCE HERE WAS THE HARNESS'S CROSS-BACKEND ONE, AND IT WAS THE
 * WRONG INSTRUMENT RATHER THAN THE WRONG NUMBER.
 *
 * Two drivers were assumed to differ no more than two graphics APIs do. Measured,
 * they differ far more, on frames that look identical: per-pixel mean 9.75 to
 * 30.02 and worst 16x16 block 95.49 to 158.86 between SwiftShader and an
 * RTX 4060 across this app's three families. That is antialiasing coverage,
 * anisotropic filtering, dither and shadow-map precision — high-frequency, and
 * invisible.
 *
 * Widening a per-pixel tolerance until that passes would have left nothing able
 * to fail. So the measurement changed instead: `compareBlockMeans` averages each
 * block before comparing, which cancels exactly that noise and preserves exactly
 * the failure this file exists for — a REGION whose brightness changed. And the
 * clock is pinned, which removed the far larger variable of the two.
 *
 * The numbers below are stated, not fitted. 40 of 255 in one block is a quarter
 * of the range: a difference that large over a 16x16 area is not filtering, it is
 * a different image. 8 for the frame-wide mean allows every block to sit at a
 * small honest offset without any single one being wrong.
 */
const MAXIMUM_MEAN_BLOCK_DIFFERENCE = 8;
const MAXIMUM_WORST_BLOCK_DIFFERENCE = 40;

type DriverFixture = {
  name: string;
  world: unknown;
  route: string;
  path: string;
};

const FIXTURES: DriverFixture[] = [
  {
    name: "universe-world",
    world: universeWorld,
    route: "**/api/universe/**",
    path: `/worlds/${universeWorld.world.id}`
  },
  {
    name: "forest-world",
    world: natureWorld,
    route: "**/api/nature/**",
    path: `/worlds/${natureWorld.world.id}?family=nature`
  },
  {
    name: "ocean-shallow",
    world: oceanShallowWorld,
    route: "**/api/ocean/**",
    path: `/worlds/${oceanShallowWorld.world.id}?family=ocean`
  }
];

async function photograph(page: Page, fixture: DriverFixture): Promise<Buffer> {
  await page.route(fixture.route, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.world) });
  });
  const separator = fixture.path.includes("?") ? "&" : "?";
  await page.goto(`${fixture.path}${separator}parityRenderer=webgl&paritySeconds=${PINNED_SECONDS}`);
  await page.waitForFunction(() => "__parityHarness" in window, undefined, { timeout: 120_000 });
  // The lazy chunk, the models and the environment bake all resolve through
  // Suspense; pinning a clock over a half-loaded scene photographs the loader.
  await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
  await page.evaluate(async () => {
    const harness = (window as unknown as { __parityHarness: { advanceToPinnedTime: () => Promise<void> } })
      .__parityHarness;
    await harness.advanceToPinnedTime();
  });
  await expect(page.locator("canvas[data-engine]")).toBeVisible({ timeout: 60_000 });
  return page.screenshot({ animations: "disabled" });
}

/**
 * Ten minutes a test, against the suite's 120 s default.
 *
 * The pinned clock is sixty renders of a full scene, and on the SwiftShader
 * project those sixty are done in software: the forest alone needs more than two
 * minutes for its models and its sixty frames. The default timeout expired mid
 * advance, which reads exactly like a hung renderer and is not one.
 */
const DRIVER_COMPARISON_TIMEOUT_MILLISECONDS = 600_000;

for (const fixture of FIXTURES) {
  test(`${fixture.name} renders the same on both drivers`, async ({ page }, testInfo) => {
    test.setTimeout(DRIVER_COMPARISON_TIMEOUT_MILLISECONDS);
    const screenshot = await photograph(page, fixture);
    const framePath = join(DRIVER_FRAME_DIRECTORY, `${fixture.name}.png`);

    if (testInfo.project.name === SOFTWARE_DRIVER_PROJECT) {
      mkdirSync(DRIVER_FRAME_DIRECTORY, { recursive: true });
      writeFileSync(framePath, screenshot);
      console.log(`${fixture.name}: software-driver frame recorded`);
      return;
    }

    if (testInfo.project.name !== REAL_DRIVER_PROJECT) {
      return;
    }

    expect(
      existsSync(framePath),
      `No software-driver frame to compare against. This test records on the \`${SOFTWARE_DRIVER_PROJECT}\` ` +
        `project and compares on \`${REAL_DRIVER_PROJECT}\`, so run both: ` +
        "`npx playwright test e2e/driver-parity.spec.ts --project=desktop --project=webgpu`."
    ).toBe(true);

    const comparison = compareBlockMeans(
      inflatePng(readFileSync(framePath), inflateSync),
      inflatePng(screenshot, inflateSync)
    );
    console.log(`${fixture.name}: software against real driver — ${describeBlockComparison(comparison)}`);

    const failureExplanation =
      `${fixture.name} differs between drivers by ${describeBlockComparison(comparison)}. A whole 16x16 ` +
      "region whose brightness changed is the signature of a NaN or out-of-range fragment that one driver " +
      "forgives and the other does not — the class of bug NonNegativeColour.tsx documents, and the one " +
      "no committed screenshot can show, because they are all taken on the software driver.";

    expect(comparison.worstBlockDifference, failureExplanation).toBeLessThan(MAXIMUM_WORST_BLOCK_DIFFERENCE);
    expect(comparison.meanBlockDifference, failureExplanation).toBeLessThan(MAXIMUM_MEAN_BLOCK_DIFFERENCE);
  });
}
