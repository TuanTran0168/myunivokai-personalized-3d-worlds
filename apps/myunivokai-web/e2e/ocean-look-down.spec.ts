import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Reported: orbiting the camera in an ocean world fills the frame with a pale
 * layer that reads as staring into the sun. Turning the camera in seawater has
 * to show seawater.
 *
 * This drives the real preview and MEASURES the frame, because the fault is
 * invisible to every other kind of test here and an eye is the thing that
 * already missed one of these — the god-ray layer once clipped 100% of a reef's
 * pixels to white while the camera happened to point away from it.
 *
 * The cause was the backdrop dome: it was the one underwater layer not subject
 * to the medium, so it painted its gradient at full strength however much water
 * was in front of it. Bisected by hiding one layer at a time and re-measuring;
 * with the dome hidden the same frame measured 0.16 luma and 0.84 saturation
 * against 0.55 and 0.07 with it.
 */

const SHOT_DIRECTORY = "e2e/shots/ocean-look-down";
// Far enough to reach the polar limit in either direction. The first attempt at
// this used 260 and never left the band where the fault does not show.
const ORBIT_DRAG_PIXELS = 900;
// A frame the tone map has pushed to the top of its range with nothing left in
// it. Seawater is never this pale and never this grey.
//
// The floor is 0.18 rather than something tighter because an abyss is legitimately
// close to black, and saturation is a noisy measure down there — it measured 0.25
// after the fix and 0.05 before it, so the gap is what carries the test, not the
// threshold's precision. The luma ceiling is the other half of the same claim.
const MINIMUM_FRAME_SATURATION = 0.18;
const MAXIMUM_FRAME_LUMA = 0.45;

function shotDirectory(): string {
  mkdirSync(SHOT_DIRECTORY, { recursive: true });
  return SHOT_DIRECTORY;
}

type FrameStatistics = {
  meanLuma: number;
  blownPercentage: number;
  meanSaturation: number;
};

/** Reads the canvas back and reduces it to the three numbers that matter. */
async function measureFrame(page: Page): Promise<FrameStatistics> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("no canvas on the page");
    }
    const scratch = document.createElement("canvas");
    scratch.width = Math.min(480, canvas.width);
    scratch.height = Math.min(300, canvas.height);
    const context = scratch.getContext("2d");
    if (!context) {
      throw new Error("no 2d context for the readback");
    }
    context.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

    let lumaTotal = 0;
    let saturationTotal = 0;
    let blownCount = 0;
    const pixelCount = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      lumaTotal += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      saturationTotal += maximum === 0 ? 0 : (maximum - minimum) / maximum;
      if (data[index] >= 250 || data[index + 1] >= 250 || data[index + 2] >= 250) {
        blownCount++;
      }
    }
    return {
      meanLuma: lumaTotal / pixelCount,
      blownPercentage: (blownCount / pixelCount) * 100,
      meanSaturation: saturationTotal / pixelCount
    };
  });
}

async function openOceanPreview(page: Page, moodLabel: RegExp): Promise<void> {
  await page.goto("/");
  await page.locator(".rail-scroll").waitFor();
  await page.getByRole("button", { name: /ocean/i }).first().click();
  await page.locator(".world-loader-ground").waitFor({ state: "detached", timeout: 60_000 });
  await page.locator("[data-form-section='mood']").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: moodLabel }).click();
  // The preview rebuild is debounced, then the scene has to draw a frame.
  await page.waitForTimeout(2500);
}

/**
 * Drags on the canvas until the orbit hits its polar limit.
 *
 * `directionSign` is the MOUSE direction, not the view direction: OrbitControls
 * moves the camera around its target, so dragging down lowers the camera and
 * the view ends up pointing at the surface.
 */
async function orbitToPolarLimit(page: Page, directionSign: 1 | -1): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box to drag on");
  }
  const centreX = box.x + box.width * 0.7;
  const centreY = box.y + box.height * 0.5;
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  // Several steps: OrbitControls integrates movement, and one jump can be
  // swallowed as a click.
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(centreX, centreY + (directionSign * ORBIT_DRAG_PIXELS * step) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

test.describe("turning the camera in an ocean world", () => {
  // Both ends of the family's one axis, and both ends of the orbit. The fault
  // was reported on a reef and reproduced in the abyss too, which is what ruled
  // out the camera crossing the waterline: at 900 m it cannot reach it.
  for (const world of [
    { name: "Reef Crest", moodLabel: /reef crest/i },
    { name: "The Abyss", moodLabel: /the abyss/i }
  ]) {
    for (const orbit of [
      { name: "one way", sign: 1 as const },
      { name: "the other", sign: -1 as const }
    ]) {
      test(`${world.name}, orbiting ${orbit.name}: shows seawater, not a wall of light`, async ({ page }) => {
        test.skip(test.info().project.name !== "desktop", "one viewport is enough for a render fault");
        await openOceanPreview(page, world.moodLabel);
        await orbitToPolarLimit(page, orbit.sign);

        const frame = await measureFrame(page);
        const slug = `${world.name}-${orbit.name}`.toLowerCase().replace(/[^a-z]+/g, "-");
        await page.screenshot({ path: `${shotDirectory()}/${slug}.png` });
        console.log(`${world.name} ${orbit.name}`.padEnd(30), JSON.stringify(frame));

        expect(frame.meanSaturation, "the frame has lost its colour to a pale layer").toBeGreaterThan(
          MINIMUM_FRAME_SATURATION
        );
        expect(frame.meanLuma, "the frame is a wall of light").toBeLessThan(MAXIMUM_FRAME_LUMA);
      });
    }
  }
});
