import { test, expect } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { inflatePng, regionMeanLuminance } from "./parityMetrics.mjs";
import universeWorld from "./fixtures/universe-world.json";

/**
 * THE ONE ASSERTION IN THIS REPOSITORY THAT NEEDS THE REAL DRIVER.
 *
 * Every other screenshot here is taken on SwiftShader, deliberately: the value
 * of those images is that two runs differ only by the code between them, and a
 * GPU that schedules work differently under load breaks exactly that. That
 * pinning is right, and it has a cost nobody had priced — **a defect that only
 * the real driver produces is invisible to the entire visual suite.**
 *
 * One was. The owner reported the sun looking wrong; it rendered correctly in
 * every SwiftShader shot, including the committed baselines, and rendered as a
 * BLACK DISC on the RTX 4060 through ANGLE. The cause is in
 * `NonNegativeColour.tsx`: `postprocessing`'s hue-saturation pass clamps the top
 * of the range and not the bottom, a positive saturation drives the star's blue
 * channel negative because the star is the one object above 1.0 in linear space,
 * and the sRGB encode that follows takes `pow` of that negative — undefined in
 * GLSL, NaN in practice, and what a driver does with a NaN fragment is its own
 * business. NVIDIA draws black. SwiftShader does not.
 *
 * So this file asserts the property in the one place it can fail: **the star's
 * disc is lit.** It runs on the `webgpu` project, which is the real GPU, and on
 * `desktop`, which is not — the pair is the point, because a difference between
 * them is the signature of this whole class of bug.
 *
 * NOT IN CI. No GPU there, and this project runs no Playwright in CI
 * (`agent-system/rules/ci-quality-gates.md`).
 */

const SCENE_RENDER_MILLISECONDS = 7_000;

/**
 * The star's disc, in frame pixels, for THIS fixture at ITS stored camera.
 *
 * `universe-world.json` pins `camera.distance` to 8.94 and `fov` to 50, and the
 * viewport is 1440x900 in both projects that run this. That puts the sun's disc
 * around (720, 450) with a radius near 195 px, so this box sits comfortably
 * inside it — deliberately smaller than the disc, because the assertion is about
 * the surface being lit and not about where its edge falls.
 */
const STAR_DISC_REGION = { left: 660, top: 400, right: 780, bottom: 500 };

/**
 * The floor, stated before measuring.
 *
 * 60 of 255. A star is the brightest thing in its own sky and this box is inside
 * its disc, so a quarter-bright average is a floor no working star approaches and
 * no broken one clears: with the NaN bug the region is nearly black, because only
 * the hottest granules survive.
 */
const STAR_DISC_MINIMUM_MEAN_LUMINANCE = 60;

test("the universe's star is lit", async ({ page }) => {
  await page.route("**/api/universe/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(universeWorld) });
  });
  await page.goto(`/worlds/${universeWorld.world.id}`);
  await expect(page.locator("canvas[data-engine]")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });

  const screenshot = await page.screenshot({ animations: "disabled" });
  const meanLuminance = regionMeanLuminance(inflatePng(screenshot, inflateSync), STAR_DISC_REGION);

  console.log(`star disc mean luminance: ${meanLuminance.toFixed(1)} of 255`);
  expect(
    meanLuminance,
    `The star's disc averages ${meanLuminance.toFixed(1)} of 255, under the floor of ` +
      `${STAR_DISC_MINIMUM_MEAN_LUMINANCE}. On the real GPU that means NaN fragments — read ` +
      "NonNegativeColour.tsx. If this passes on `desktop` and fails on `webgpu`, it is a driver-only " +
      "defect and no committed screenshot will show it."
  ).toBeGreaterThan(STAR_DISC_MINIMUM_MEAN_LUMINANCE);
});
