import { test, expect, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { clippedChannelFraction, inflatePng, CLIPPED_CHANNEL_BYTE } from "./parityMetrics.mjs";
import universeWorld from "./fixtures/universe-world.json";
import natureWorld from "./fixtures/nature-world.json";

/**
 * THE GUARD THE TONE-CURVE FIX DID NOT COME WITH.
 *
 * §26 Phase 2 of agent-system/research/webgpu-full-migration-feasibility-2026.md
 * gave the three composer families the tone curve their canvas had always asked
 * for, and measured the result once, by hand, into a commit message: 10.1% of
 * the universe world's canvas band sat at 250+ in some channel before the fix,
 * 0.0% after. Nothing in the repository asserts it.
 *
 * That gap is not hypothetical. The pre-fix baseline images — a sun rendered as
 * a black disc with only its hottest granulation surviving — were COMMITTED and
 * reviewed by eye, on both the world page and the create page, and passed.
 * `scene-baseline.spec.ts` asks its reader to compare "by eye for CONTENT",
 * which is the right policy and still let this through, because a reviewer who
 * has never seen the correct frame has nothing to compare against.
 *
 * So the property gets a number. This suite renders the two families that mount
 * the composer plus the create form's live preview, and fails if the frame is
 * clipping. It is the test that would have caught the original bug, and it is
 * pointed at the family whose look depends on it most: the universe, where the
 * sun is the one object deliberately rendered above 1.0.
 *
 * NOT IN CI. There is no GPU there and this project runs no Playwright in CI
 * (`agent-system/rules/ci-quality-gates.md`); it runs beside the other shoots.
 */

/**
 * The ceiling, stated before measuring, per `parityMetrics.mjs`'s own rule that
 * a tolerance chosen after seeing the result is not a test.
 *
 * 1% of the canvas. Phase 2 measured 10.1% clipped before the fix and 0.0%
 * after, so this fails the bug by an order of magnitude and passes the fix with
 * the whole margin to spare. It is deliberately NOT zero: a star sprite core and
 * a specular pinpoint are meant to reach white, and a scene is allowed a
 * handful of them.
 *
 * Measured against a production build once the ceiling was fixed — universe
 * 0.19%, forest 0.09%, create preview 0.00% — and again with `<ToneMapping>`
 * removed from the chain to prove the guard can fail: universe 2.31%, create
 * preview 2.67%, both red.
 *
 * THE FOREST DOES NOT CARRY THIS GUARD, and knowing that matters more than its
 * number: it measures 0.09% either way, because a forest at midday holds almost
 * nothing above 1.0 in linear space. The universe does — a sun, binary suns,
 * star cores, additive nebula layers, seven `toneMapped={false}` sites — and the
 * create preview is the universe seen closer. The forest case stays because a
 * family that starts clipping is worth knowing about, not because it is the
 * sensitive one.
 */
const CLIPPED_FRACTION_CEILING = 0.01;

const SCENE_RENDER_MILLISECONDS = 6_000;

type ClippingFixture = {
  name: string;
  path: string;
  world: unknown;
  route: string;
};

const FIXTURES: ClippingFixture[] = [
  {
    name: "universe world",
    path: `/worlds/${universeWorld.world.id}`,
    world: universeWorld,
    route: "**/api/universe/**"
  },
  {
    name: "forest world",
    path: `/worlds/${natureWorld.world.id}?family=nature`,
    world: natureWorld,
    route: "**/api/nature/**"
  }
];

async function measureClippedFraction(page: Page): Promise<number> {
  const sceneCanvas = page.locator("canvas[data-engine]");
  // `canvas[data-engine]` for the reason Phase 4 recorded: `locator("canvas")`
  // also matches WorldTransition's warp overlay, which is what is left on the
  // page when the failure boundary has removed the scene, and an overlay
  // measures as beautifully unclipped.
  await expect(sceneCanvas).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  const screenshot = await sceneCanvas.screenshot({ animations: "disabled" });
  return clippedChannelFraction(inflatePng(screenshot, inflateSync));
}

test.describe("highlight clipping", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.name} keeps its highlights`, async ({ page }) => {
      await page.route(fixture.route, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fixture.world)
        });
      });
      await page.goto(fixture.path);
      const clippedFraction = await measureClippedFraction(page);
      console.log(
        `${fixture.name}: ${(clippedFraction * 100).toFixed(2)}% of canvas pixels at ${CLIPPED_CHANNEL_BYTE}+`
      );
      expect(
        clippedFraction,
        `${(clippedFraction * 100).toFixed(2)}% of the frame is clipped. A tone curve that stopped being ` +
          "applied is the failure this measures — see sceneToneMapping.ts."
      ).toBeLessThan(CLIPPED_FRACTION_CEILING);
    });
  }

  // The create form's preview is its own case and not a duplicate: it builds its
  // scene client-side from form inputs rather than from a stored config, so it
  // reaches the renderer down a different path, and it is the first 3D frame
  // most visitors ever see.
  test("create form live preview keeps its highlights", async ({ page }) => {
    await page.goto("/");
    await page.locator(".rail-scroll").waitFor();
    const clippedFraction = await measureClippedFraction(page);
    console.log(`create preview: ${(clippedFraction * 100).toFixed(2)}% of canvas pixels at ${CLIPPED_CHANNEL_BYTE}+`);
    expect(clippedFraction).toBeLessThan(CLIPPED_FRACTION_CEILING);
  });
});
