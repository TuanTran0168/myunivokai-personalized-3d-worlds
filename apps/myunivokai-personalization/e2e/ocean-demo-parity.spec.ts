import { test, expect, type Page } from "@playwright/test";
import aboveWater from "./fixtures/demo-above-water-world.json";
import goldenHour from "./fixtures/demo-golden-hour-world.json";
import reef from "./fixtures/demo-reef-world.json";
import openWater from "./fixtures/demo-open-water-world.json";
import twilight from "./fixtures/demo-twilight-world.json";
import abyssalPlain from "./fixtures/demo-abyssal-plain-world.json";

/**
 * The app rendered against the prototype's own six views.
 *
 * The ocean rig was ported from demos/ocean-depth-rig, and after the port the
 * app still did not look like it. Every attempt to close that gap by eye failed
 * the same way: the app's own worlds are rolled from a seed, so no two shots
 * were comparable and "it looks washed out" could not be checked against
 * anything.
 *
 * These fixtures carry the prototype's six presets EXACTLY — the same viewer
 * depth, seabed depth, sun elevation, wind speed and Jerlov water type that
 * shell.html's buttons set. That makes the comparison a controlled one: the
 * scene parameters are identical, so any difference left in the image belongs to
 * the app — its post-processing chain, its camera framing, its shadow
 * configuration, its colour pipeline.
 *
 * Shot with the app's shots, measured by e2e/measure.mjs, and compared against
 * the prototype's own numbers. Nothing here asserts a pixel: the images and the
 * measurements are the artefact, and the point is that a person can put them
 * side by side.
 */
const DEMO_PRESETS = [
  { name: "demo-above-water", world: aboveWater },
  { name: "demo-golden-hour", world: goldenHour },
  { name: "demo-reef", world: reef },
  { name: "demo-open-water", world: openWater },
  { name: "demo-twilight", world: twilight },
  { name: "demo-abyssal-plain", world: abyssalPlain },
] as const;

const SCENE_RENDER_MILLISECONDS = 7_000;

async function photograph(page: Page, name: string, world: { world: { id: string } }) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.route("**/api/ocean/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
  });
  await page.goto(`/worlds/${world.world.id}?family=ocean`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.screenshot({
    path: `e2e/shots/${test.info().project.name}/${name}.png`,
    animations: "disabled",
  });
  expect(problems).toEqual([]);
}

for (const { name, world } of DEMO_PRESETS) {
  test(`demo parity: ${name}`, async ({ page }) => {
    await photograph(page, name, world);
  });
}
