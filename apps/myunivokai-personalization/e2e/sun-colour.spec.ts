import { test, expect, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { inflatePng } from "./parityMetrics.mjs";
import universeWorld from "./fixtures/universe-world.json";

/**
 * THE STAR IS LIT — AND IT IS STILL THE RIGHT COLOUR.
 *
 * `star-is-lit.spec.ts` answers the first half, with a floor of 60 of 255, and
 * it was written for a defect that took the star to near black. A floor that
 * low cannot see a star that merely FADED: the owner reported the sun looking
 * washed out beside an earlier build, and the star measured 195 at the time —
 * three times the floor, and a comfortable pass.
 *
 * **THAT REPORT TURNED OUT NOT TO BE A RENDERING FAULT AT ALL** — the two
 * frames were two different stars, because the create form's preview seed
 * includes the nickname and signing in autofills it (see
 * `previewSeedFromInputs` in `src/lib/scene.ts`). This file is what the chase
 * left behind rather than a fix for it: the chase took a day precisely because
 * nothing here could answer "has the star's colour moved?" with a number, and
 * the reference sets were read as if they could.
 *
 * So this measures what the suite could not: **the colour, not the brightness.**
 * Saturation is the number that moved, and it is the right one to hold, because
 * the failure it guards against is a star drifting toward white — which is what
 * every accident in a colour pipeline does. Clipping, a missing decode, a
 * doubled encode and an over-eager tone curve all pull a saturated orange toward
 * grey, and none of them make it dark.
 *
 * THE CLOCK IS PINNED, through §26 Phase 4's harness, and that is not optional.
 * The committed reference sets under `e2e/reference/` are photographed with the
 * animation phase free, deliberately — which is fine for comparing them BY EYE
 * for content, and useless for comparing a number between two of them. This
 * renders one exact phase, so two runs differ only by the code between them.
 *
 * `parityRenderer=webgl` is today's renderer: the variable under test is the
 * app, not the backend.
 */

const PINNED_SECONDS = 6;
const SCENE_ARRIVAL_MILLISECONDS = 20_000;
const SUN_MEASUREMENT_TIMEOUT_MILLISECONDS = 600_000;

/**
 * The sun is found rather than assumed.
 *
 * A hard-coded box breaks the moment a fixture's camera moves, and this file is
 * meant to outlive this fixture. The brightest pixel in the middle of a universe
 * frame is the star — nothing else in the scene is close — and the measurement
 * box is grown around it, over everything above a luminance floor, which is the
 * disc and its corona rather than the starfield behind them.
 */
const CENTRAL_REGION_INSET = 0.25;
const SUN_BOX_HALF_WIDTH = 90;
const SUN_LUMINANCE_FLOOR = 60;

/**
 * The floors, and where they come from — which is NOT `e2e/reference/`.
 *
 * The first version of this file took its numbers from the committed reference
 * sets, which measure this star's saturation at 0.550, 0.599 and 0.321 across
 * three dependency stacks. Read as a series that looks like a collapse, and it
 * was read that way. It is not one: those shots are photographed with the
 * animation phase FREE, exactly as `e2e/reference/README.md` says, and that
 * README also says what to do with them — "compare these by eye, for content".
 * A number taken off them carries the camera and the phase along with the code.
 *
 * The A/B settles it. The same fixture, the same pinned phase, one variable:
 *
 *     three 0.185.1   saturation 0.380   peak 205
 *     three 0.171.0   saturation 0.381   peak 205
 *
 * Fifteen releases of three move this star by **0.001 of 1.0**. The apparent
 * collapse in the reference series was the free phase, and the upgrade commit's
 * own conclusion stands.
 *
 * So the floors come from those two measurements and nothing else. 0.30 sits
 * below both with room for the phase to breathe, and far above a star that has
 * actually gone white, which is the failure being guarded. 180 of 255 does the
 * same for the peak. Both are floors, not targets: a more saturated star passes.
 */
const SUN_MINIMUM_SATURATION = 0.3;
const SUN_MINIMUM_PEAK_LUMINANCE = 180;

type SunColour = {
  red: number;
  green: number;
  blue: number;
  saturation: number;
  peakLuminance: number;
  measuredPixels: number;
};

function luminanceAt(pixels: Buffer, offset: number): number {
  return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
}

function measureSunColour(frame: { width: number; height: number; pixels: Buffer }): SunColour {
  const { width, height, pixels } = frame;
  const searchLeft = Math.floor(width * CENTRAL_REGION_INSET);
  const searchRight = Math.ceil(width * (1 - CENTRAL_REGION_INSET));
  const searchTop = Math.floor(height * CENTRAL_REGION_INSET);
  const searchBottom = Math.ceil(height * (1 - CENTRAL_REGION_INSET));

  let peakLuminance = -1;
  let peakX = 0;
  let peakY = 0;
  for (let y = searchTop; y < searchBottom; y += 1) {
    for (let x = searchLeft; x < searchRight; x += 1) {
      const luminance = luminanceAt(pixels, (y * width + x) * 4);
      if (luminance > peakLuminance) {
        peakLuminance = luminance;
        peakX = x;
        peakY = y;
      }
    }
  }

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let measuredPixels = 0;
  for (let y = peakY - SUN_BOX_HALF_WIDTH; y <= peakY + SUN_BOX_HALF_WIDTH; y += 1) {
    for (let x = peakX - SUN_BOX_HALF_WIDTH; x <= peakX + SUN_BOX_HALF_WIDTH; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const offset = (y * width + x) * 4;
      if (luminanceAt(pixels, offset) < SUN_LUMINANCE_FLOOR) continue;
      redTotal += pixels[offset];
      greenTotal += pixels[offset + 1];
      blueTotal += pixels[offset + 2];
      measuredPixels += 1;
    }
  }

  const red = redTotal / measuredPixels;
  const green = greenTotal / measuredPixels;
  const blue = blueTotal / measuredPixels;
  const highestChannel = Math.max(red, green, blue);
  const lowestChannel = Math.min(red, green, blue);

  return {
    red,
    green,
    blue,
    saturation: highestChannel === 0 ? 0 : (highestChannel - lowestChannel) / highestChannel,
    peakLuminance,
    measuredPixels
  };
}

async function photographPinnedUniverse(page: Page): Promise<Buffer> {
  await page.route("**/api/universe/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(universeWorld) });
  });
  await page.goto(`/worlds/${universeWorld.world.id}?parityRenderer=webgl&paritySeconds=${PINNED_SECONDS}`);
  await page.waitForFunction(() => "__parityHarness" in window, undefined, { timeout: 120_000 });
  await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
  await page.evaluate(async () => {
    const harness = (window as unknown as { __parityHarness: { advanceToPinnedTime: () => Promise<void> } })
      .__parityHarness;
    await harness.advanceToPinnedTime();
  });
  await expect(page.locator("canvas[data-engine]")).toBeVisible({ timeout: 60_000 });
  return page.screenshot({ animations: "disabled" });
}

test("the universe's star keeps its colour", async ({ page }) => {
  test.setTimeout(SUN_MEASUREMENT_TIMEOUT_MILLISECONDS);
  const screenshot = await photographPinnedUniverse(page);
  const sun = measureSunColour(inflatePng(screenshot, inflateSync));

  console.log(
    `star colour: rgb ${sun.red.toFixed(1)} ${sun.green.toFixed(1)} ${sun.blue.toFixed(1)} · ` +
      `saturation ${sun.saturation.toFixed(3)} · peak ${sun.peakLuminance.toFixed(0)} of 255 · ` +
      `${sun.measuredPixels} px`
  );

  const failureExplanation =
    `The star measures rgb ${sun.red.toFixed(1)} ${sun.green.toFixed(1)} ${sun.blue.toFixed(1)}, ` +
    `saturation ${sun.saturation.toFixed(3)}, peak ${sun.peakLuminance.toFixed(0)}. A star drifting ` +
    "toward white is what a broken colour pipeline produces — a clipped HDR range, a missing texture " +
    "decode, a doubled encode, a tone curve applied twice. It is NOT what a dark star looks like, so " +
    "star-is-lit.spec.ts will keep passing beside this failure.";

  expect(sun.saturation, failureExplanation).toBeGreaterThan(SUN_MINIMUM_SATURATION);
  expect(sun.peakLuminance, failureExplanation).toBeGreaterThan(SUN_MINIMUM_PEAK_LUMINANCE);
});
