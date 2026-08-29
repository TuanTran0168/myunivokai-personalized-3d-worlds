import { expect, test, type Page } from "@playwright/test";

/**
 * The create rail's section-progress indicator, checked at both tiers.
 *
 * This is an assertion suite, unlike the screenshot specs around it: nothing
 * here looks at the canvas, and the bug it was written for is invisible to
 * every unit test. `pickActiveSectionId` was correct the whole time; what was
 * wrong was the IntersectionObserver's ROOT, and a root can only be wrong in a
 * real layout. On phones the rail is a sheet starting at 46svh while the
 * observer measured against the viewport, so the active band fell in the world
 * above the sheet and the bar never moved off its first segment.
 */

const PROGRESS_BAR = '[role="progressbar"][aria-label="Form section progress"]';
const RAIL_SCROLL = ".rail-scroll";

async function readProgressPosition(page: Page): Promise<number> {
  const value = await page.locator(PROGRESS_BAR).getAttribute("aria-valuenow");
  return Number(value);
}

async function scrollRailBy(page: Page, deltaPixels: number): Promise<void> {
  await page.locator(RAIL_SCROLL).evaluate((element, delta) => {
    element.scrollTop += delta as number;
  }, deltaPixels);
  // The indicator is driven by IntersectionObserver, which reports on the frame
  // after the scroll, not during it.
  await page.waitForTimeout(250);
}

test.describe("create form section progress", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(RAIL_SCROLL).waitFor();
  });

  test("advances as the field column scrolls", async ({ page }) => {
    const startPosition = await readProgressPosition(page);
    expect(startPosition).toBe(1);

    await scrollRailBy(page, 260);
    const midPosition = await readProgressPosition(page);
    expect(midPosition).toBeGreaterThan(startPosition);
  });

  test("reaches the last segment at the bottom of the scroll", async ({ page }) => {
    // The observer's band sits a fifth of the way down the column, so the final
    // section is pinned below it at maximum scroll and can never win on ratio.
    // Reaching the end of the scroll is its own signal.
    await page.locator(RAIL_SCROLL).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(300);

    const bar = page.locator(PROGRESS_BAR);
    const position = Number(await bar.getAttribute("aria-valuenow"));
    const total = Number(await bar.getAttribute("aria-valuemax"));
    expect(position).toBe(total);
  });

  test("drops the world-style segment for a family that has no world style", async ({ page }) => {
    const bar = page.locator(PROGRESS_BAR);
    const universeSegments = Number(await bar.getAttribute("aria-valuemax"));

    await page.getByRole("button", { name: /forest/i }).first().click();
    await expect
      .poll(async () => Number(await bar.getAttribute("aria-valuemax")))
      .toBe(universeSegments - 1);
  });
});
