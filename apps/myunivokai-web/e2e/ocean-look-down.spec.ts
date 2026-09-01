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

/**
 * MEASURED 2026-09-01, AND IT CHANGES WHAT THIS FILE IS WORTH: the gesture below
 * does not appear to move the camera at all.
 *
 * The camera-breach fix was disabled and this spec re-run as a control. It
 * passed, with numbers within noise of the fixed build (reef: 0.285 luma /
 * 0.632 saturation unfixed, 0.299 / 0.621 fixed). The committed screenshot from
 * the unfixed run settles why: it is the untouched RESTING framing — level, in
 * open water, at the resting distance — after a 900 px drag and twelve wheel
 * notches. In that world (`energetic`, 18.65 m deep, surface drawn) an
 * unclamped drag to the pole puts the lens at 24.4 m, six metres into the air.
 * The frame shows nothing of the sort, so the input never reached OrbitControls.
 *
 * So this file has never exercised the camera, which is why it stayed green
 * through the whole life of the bug it is named after. Until the input path is
 * fixed, treat a pass here as "the scene still renders", not as "the camera is
 * safe". The camera invariant is pinned in `oceanMath.test.ts` instead, where it
 * is checked across every world the generator can make, at every radius in the
 * envelope, without a GPU.
 *
 * The likely causes, in the order worth checking: `page.locator("canvas")
 * .first()` may not be the scene's canvas (and `measureFrame`'s own
 * `document.querySelector("canvas")` would then be reading the same wrong one),
 * or an overlay is taking the pointer at the drag point. Instrumenting the
 * camera height and asserting it directly is the fix — a threshold on frame
 * statistics cannot tell "the camera did not breach" from "the camera did not
 * move".
 */

const SHOT_DIRECTORY = "e2e/shots/ocean-look-down";
// Far enough to reach the polar limit in either direction. The first attempt at
// this used 260 and never left the band where the fault does not show.
const ORBIT_DRAG_PIXELS = 900;
// Enough wheel to be sitting on the distance limit rather than near it. The
// orbit starts at 20 m and tops out at 26, and OrbitControls dollies by a
// factor per notch, so a handful of generous notches is comfortably past it.
const ZOOM_OUT_WHEEL_STEPS = 12;
const ZOOM_OUT_WHEEL_PIXELS = 240;
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
 * `directionSign` is the MOUSE direction, not the view direction, and the
 * mapping is the opposite of the one written here for two rounds: OrbitControls
 * moves the camera AROUND its target, and its `rotateUp` SUBTRACTS from the
 * polar angle, which is measured down from +Y. So dragging the mouse DOWN
 * RAISES the camera and swings the view down onto the target from above.
 *
 * That inversion is not a pedantic correction. It is the whole mechanism of the
 * fault this file is named after: "turning the camera down" is the gesture that
 * walks the lens UP, and in a shallow world it walked it out of the sea.
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

/** Wheels the orbit out until it is against its distance limit. */
async function zoomToWidest(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("the canvas has no box to scroll on");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < ZOOM_OUT_WHEEL_STEPS; step++) {
    await page.mouse.wheel(0, ZOOM_OUT_WHEEL_PIXELS);
  }
  await page.waitForTimeout(600);
}

test.describe("turning the camera in an ocean world", () => {
  // Both ends of the family's one axis, and both ends of the orbit.
  //
  // The fault was reported on a reef and reproduced in the abyss too, and that
  // was read here as RULING OUT the camera crossing the waterline, on the
  // grounds that at 900 m it cannot reach it. The inference was wrong and it
  // cost two rounds of shader work: the same pale frame had two causes, and
  // fixing the abyss one (the backdrop dome, unfogged) left the reef one
  // standing. The reef's cause is geometric — the orbit lifts the lens out of
  // the water while the rig still believes it is submerged — and it is pinned
  // in oceanMath.test.ts, where it can be checked without a GPU. This file
  // keeps the abyss honest and confirms the reef on real pixels.
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
        // Zoomed OUT first, which is the condition the owner reported and the
        // one this file was missing: the lift a tilt buys is the orbit radius
        // times the cosine of the polar angle, so the same drag that is
        // harmless at the resting distance puts the lens through the surface at
        // the wide end. Dragging at the resting radius alone measured clean
        // frames while the bug was live.
        await zoomToWidest(page);
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
