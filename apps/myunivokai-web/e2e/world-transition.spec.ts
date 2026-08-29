import { test, expect, type Page } from "@playwright/test";

/**
 * The create page's world change, phase by phase, plus the two layout facts the
 * change was built around.
 *
 * Unlike the scene baselines next door, some of this DOES assert. The split is
 * deliberate and it is the same one the config's header draws: a pixel
 * assertion on WebGL output would mean "different GPU" far more often than
 * "broken", so the transition frames are images to look at and nothing more.
 * The layout facts at the bottom are not WebGL — they are box geometry and
 * scroll containment, identical on every machine, and both were real bugs
 * reported from a screenshot rather than caught by anything else in this repo.
 * A number that can regress silently and can be checked exactly is worth
 * checking exactly.
 *
 * Nothing here needs a gateway: the landing page's preview scenes are built on
 * the client from the form's own state.
 */

const shotDirectory = () => `e2e/shots/${test.info().project.name}`;

/**
 * Wait for the live preview to have drawn once.
 *
 * A world change captures a still of the outgoing world, and a capture taken
 * before the first frame comes back empty — which the component correctly
 * handles by cutting instead, and then there is no transition to photograph.
 */
async function waitForPreview(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(3000);
}

/**
 * Every phase wait is STARTED BEFORE the screenshot that precedes it, and that
 * ordering is the difference between this file passing and this file being
 * flaky.
 *
 * A full-viewport screenshot under the software renderer this suite pins takes
 * longer than the hold's own 420 ms floor. Waiting for the next phase after the
 * shot therefore lost the race whenever the destination happened to be warm:
 * the hold began and ended inside the capture, and the waiter that started
 * afterwards sat there until the test timed out — on a transition that had in
 * fact played perfectly. Playwright's waiters observe the DOM from the moment
 * they are created, so creating one first and awaiting it after catches a state
 * that came and went while the camera was busy.
 */
function phaseWaiters(page: Page) {
  const ground = page.locator(".world-loader-ground");
  const mark = page.locator('.world-loader-stage[data-mark-visible="true"]');
  return {
    ground,
    mark,
    holdStarted: () => mark.waitFor({ state: "attached", timeout: 60_000 }),
    holdEnded: () => mark.waitFor({ state: "detached", timeout: 60_000 }),
    transitionEnded: () => ground.waitFor({ state: "detached", timeout: 60_000 })
  };
}

test.describe("world transition", () => {
  test("universe departs, the forest's loader holds, the forest arrives", async ({ page }) => {
    await waitForPreview(page);
    const phase = phaseWaiters(page);

    await page.getByRole("button", { name: /Forest/ }).first().click();

    await phase.ground.waitFor({ state: "attached" });
    const holdStarted = phase.holdStarted();
    // Mid-departure: the outgoing world is a warped sheet being drawn toward
    // the slot, over the arriving family's ground.
    //
    // `animations` is left ALONE here, unlike the scene baselines. Disabling
    // them snaps every CSS animation to its end state, which for the hold's
    // loader means photographing a mark that is not where it would be — and
    // the whole point of these frames is what the phases look like while they
    // are running.
    await page.screenshot({ path: `${shotDirectory()}/transition-1-departing.png` });
    await holdStarted;

    const holdEnded = phase.holdEnded();
    await page.screenshot({ path: `${shotDirectory()}/transition-2-forest-hold.png` });
    await holdEnded;

    const transitionEnded = phase.transitionEnded();
    await page.screenshot({ path: `${shotDirectory()}/transition-3-arriving.png` });
    await transitionEnded;

    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${shotDirectory()}/transition-4-forest-settled.png` });

    // The overlay covers the entire scene while it is up, so an overlay that
    // outlived its transition would be a page with no world on it and no error
    // to explain why.
    await expect(phase.ground).toHaveCount(0);
  });

  test("a second change wears the second family's colours", async ({ page }) => {
    await waitForPreview(page);
    const phase = phaseWaiters(page);

    await page.getByRole("button", { name: /Forest/ }).first().click();
    await phase.transitionEnded();
    await page.waitForTimeout(1500);

    // The claim this test exists for: the wait belongs to the family being
    // arrived AT, not to the one being left. Asserted rather than eyeballed —
    // a ground keyed off the wrong family is a one-character mistake that no
    // screenshot review reliably catches.
    const oceanHoldStarted = phase.holdStarted();
    await page.getByRole("button", { name: /Ocean/ }).first().click();
    await expect(page.locator(".world-loader-ground-ocean")).toHaveCount(1);
    await expect(page.locator(".world-loader-ground-nature")).toHaveCount(0);
    await oceanHoldStarted;

    const oceanTransitionEnded = phase.transitionEnded();
    await page.screenshot({ path: `${shotDirectory()}/transition-5-ocean-hold.png` });
    await oceanTransitionEnded;

    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shotDirectory()}/transition-6-ocean-settled.png` });
  });
});

test.describe("create form layout", () => {
  test("nickname and role share their row instead of overlapping it", async ({ page }) => {
    await waitForPreview(page);

    const boxes = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>("#create-universe-form input[maxlength]")
      ).slice(0, 2);
      return inputs.map((input) => {
        const box = input.getBoundingClientRect();
        return {
          left: Math.round(box.left),
          right: Math.round(box.right),
          top: Math.round(box.top),
          bottom: Math.round(box.bottom)
        };
      });
    });
    expect(boxes).toHaveLength(2);

    // Rectangle intersection, not a horizontal gap, because the row has two
    // legitimate shapes: side by side from `sm` up, and stacked below it,
    // where half a phone's width is not enough for either placeholder. An
    // assertion written for only one of them fails on the other for the right
    // reason and the wrong cause.
    const overlaps =
      boxes[0].right > boxes[1].left &&
      boxes[1].right > boxes[0].left &&
      boxes[0].bottom > boxes[1].top &&
      boxes[1].bottom > boxes[0].top;

    // This is the regression. A grid item's `min-width` defaults to `auto`,
    // which refuses to shrink below the content's intrinsic width, and an
    // <input>'s intrinsic width is about 245px whatever its placeholder says.
    // Two of them in a 300px track ran over each other by 98px in the 340px
    // rail and 76px in the 384px one — and looked FINE at 75% browser zoom,
    // where the track was finally wide enough for both intrinsic widths, which
    // is exactly why it was reported as a zoom bug.
    expect(overlaps, `nickname ${JSON.stringify(boxes[0])} over role ${JSON.stringify(boxes[1])}`).toBe(
      false
    );

    await page.screenshot({ path: `${shotDirectory()}/create-form-identity-row.png` });
  });

  test("only the rail scrolls — the world never leaves the screen", async ({ page }) => {
    await waitForPreview(page);

    const canvasBefore = await page.locator("canvas").first().boundingBox();
    await page.locator(".rail-scroll").evaluate((element) => element.scrollBy(0, 400));
    await page.waitForTimeout(300);
    const canvasAfter = await page.locator("canvas").first().boundingBox();

    const railScrollTop = await page.locator(".rail-scroll").evaluate((element) => element.scrollTop);
    const documentScroll = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      canScroll: document.documentElement.scrollHeight > window.innerHeight + 1
    }));

    // The rail moved.
    expect(railScrollTop).toBeGreaterThan(0);
    // The page did not, and could not have: below `md` this used to be a flex
    // column with the rail in flow under a tall hero, so reaching the palette
    // meant scrolling the live portrait off the top of the screen.
    expect(documentScroll.scrollY).toBe(0);
    expect(documentScroll.canScroll).toBe(false);
    expect(canvasAfter?.y).toBe(canvasBefore?.y);
    expect(canvasAfter?.height).toBe(canvasBefore?.height);

    await page.screenshot({ path: `${shotDirectory()}/create-form-scrolled.png` });
  });
});
