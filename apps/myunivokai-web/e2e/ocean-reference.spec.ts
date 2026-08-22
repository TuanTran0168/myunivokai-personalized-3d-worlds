import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Photograph the PROTOTYPE, so "the app does not look like the demo" becomes a
 * comparison instead of an opinion.
 *
 * This is the instrument that was missing for this entire port. The prototype
 * lives in demos/ocean-depth-rig and builds to one self-contained HTML file; the
 * app's rig was written from its source. Every round of "still not like the
 * demo" was answered by tuning the app against a REMEMBERED design rather than
 * against the thing itself, which is exactly why it took so many rounds.
 *
 * Shot through the same browser, the same software GL, the same viewport and the
 * same settle time as e2e/ocean-demo-parity.spec.ts, then measured by the same
 * e2e/measure.mjs. Two rows of numbers for the same six views, and the
 * difference between them is the work left to do.
 *
 * Skipped rather than failed when the prototype has not been built: it is a
 * local reference, not a dependency of the app.
 */
const REFERENCE_HTML = resolve(
  process.cwd(),
  "../../demos/ocean-depth-rig/dist/ocean-depth-rig.html",
);

/**
 * Matches shell.html's preset buttons.
 *
 * Selected by `data-viewer` rather than by label, for two reasons. The label is
 * not usable — each button wraps a `<small>` caption, so its accessible name is
 * "Above water 22 m up / BF 6" and an exact-name lookup finds nothing. And the
 * viewer depth is the value that has to agree with the matching fixture in
 * ocean-demo-parity.spec.ts, so selecting on it makes the pairing between the
 * two suites explicit instead of relying on two lists staying in the same order.
 */
const PRESETS = [
  { name: "above-water", viewer: "-22" },
  { name: "golden-hour", viewer: "-12" },
  { name: "reef", viewer: "8" },
  { name: "open-water", viewer: "17" },
  { name: "twilight", viewer: "142" },
  { name: "abyssal-plain", viewer: "2448" },
] as const;

// Longer than the app's: the prototype decodes ten base64 GLBs out of the HTML
// itself before it has a scene to draw.
const SCENE_RENDER_MILLISECONDS = 9_000;

test.describe("prototype reference", () => {
  test.skip(!existsSync(REFERENCE_HTML), "prototype not built (run demos/ocean-depth-rig/build.mjs)");

  for (const { name, viewer } of PRESETS) {
    test(`reference: ${name}`, async ({ page }) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));

      await page.goto(pathToFileURL(REFERENCE_HTML).href);
      await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
      await page.locator(`button[data-viewer="${viewer}"]`).click();
      await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);
      await page.evaluate(() => {
        window.requestAnimationFrame = () => 0;
      });
      await page.screenshot({
        path: `e2e/shots/${test.info().project.name}/ref-${name}.png`,
        animations: "disabled",
      });
      expect(problems).toEqual([]);
    });
  }
});
