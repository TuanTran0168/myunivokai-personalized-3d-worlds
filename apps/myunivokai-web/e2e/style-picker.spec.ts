import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The world-style picker, which now renders for every family with its own
 * vocabulary and its own label.
 *
 * It was hidden for the forest and the ocean because both services stored the
 * field and never read it, so the control changed nothing. Both read it now,
 * and the property worth asserting is the one that would silently break the
 * create button: a style belongs to exactly one family, and the gateway returns
 * 400 for one family's style posted to another.
 */

const SHOT_DIRECTORY = "e2e/shots/style-picker";

function shotDirectory(): string {
  mkdirSync(SHOT_DIRECTORY, { recursive: true });
  return SHOT_DIRECTORY;
}

async function selectFamily(page: Page, familyLabel: RegExp): Promise<void> {
  await page.getByRole("button", { name: familyLabel }).first().click();
  // The family change plays a genie departure, a hold and an arrival before the
  // form settles; the ground element is gone once it has finished.
  await page.locator(".world-loader-ground").waitFor({ state: "detached", timeout: 60_000 });
}

/** The style group's chip labels, in DOM order. */
async function styleChipLabels(page: Page): Promise<string[]> {
  const group = page.locator("[data-form-section='world-style']");
  return group.getByRole("button").allInnerTexts();
}

test.describe("world style picker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".rail-scroll").waitFor();
    await page.locator("[data-form-section='world-style']").scrollIntoViewIfNeeded();
  });

  test("gives each family its own styles and its own label", async ({ page }) => {
    const group = page.locator("[data-form-section='world-style']");

    await expect(group).toContainText("World Style");
    expect(await styleChipLabels(page)).toContain("Cosmic");
    await page.screenshot({ path: `${shotDirectory()}/universe.png` });

    await selectFamily(page, /forest/i);
    await page.locator("[data-form-section='world-style']").scrollIntoViewIfNeeded();
    await expect(group).toContainText("Forest Style");
    const forestStyles = await styleChipLabels(page);
    expect(forestStyles).toContain("Ancient Grove");
    expect(forestStyles).not.toContain("Cosmic");
    await page.screenshot({ path: `${shotDirectory()}/forest.png` });

    await selectFamily(page, /ocean/i);
    await page.locator("[data-form-section='world-style']").scrollIntoViewIfNeeded();
    await expect(group).toContainText("Water & Life");
    const oceanStyles = await styleChipLabels(page);
    expect(oceanStyles).toContain("Kelp Cathedral");
    expect(oceanStyles).not.toContain("Ancient Grove");
    await page.screenshot({ path: `${shotDirectory()}/ocean.png` });
  });

  test("lands on the new family's own neutral style when the family changes", async ({ page }) => {
    // Carrying a universe style into the forest would be a 400 from the gateway
    // on submit, with nothing in the form to explain it.
    await selectFamily(page, /forest/i);
    const group = page.locator("[data-form-section='world-style']");
    await group.scrollIntoViewIfNeeded();
    const selected = group.locator("button[aria-pressed='true']");
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Wildwood");

    await selectFamily(page, /ocean/i);
    await group.scrollIntoViewIfNeeded();
    await expect(group.locator("button[aria-pressed='true']")).toContainText("Open Water");
  });

  test("draws an icon on every chip of every option group", async ({ page }) => {
    // An icon some options have and others do not is worse than none at all —
    // the ones without read as unfinished.
    for (const sectionId of ["mood", "world-style"]) {
      const chips = page.locator(`[data-form-section='${sectionId}'] button`);
      const chipCount = await chips.count();
      expect(chipCount).toBeGreaterThan(0);
      for (let index = 0; index < chipCount; index++) {
        // One disc holding the icon, plus the always-mounted checkmark.
        await expect(chips.nth(index).locator("svg")).toHaveCount(2);
      }
    }
  });
});

test.describe("hiding the form", () => {
  test("leaves nothing but the world behind on a phone", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "the placard this covers only ever rendered below lg");
    await page.goto("/");
    await page.locator(".rail-scroll").waitFor();

    // The button's accessible name is stable ("Create-world form"); the visible
    // "Hide the form" label only unrolls on hover, so it is not what to match.
    await page.getByRole("button", { name: "Create-world form" }).click();
    // The rail's own collapse animation, then the frame after it.
    await expect(page.locator("[data-form-rail-collapsed='true']")).toBeVisible();
    await page.waitForTimeout(700);

    // "Live preview" appears in the identity summary and nowhere else. Counted
    // VISIBLE rather than attached: the desktop island is in the DOM at every
    // width and merely `hidden lg:block`, so an attached-element count would
    // pass or fail for the wrong reason.
    await expect(page.getByText("Live preview").filter({ visible: true })).toHaveCount(0);
    await page.screenshot({ path: `${shotDirectory()}/hidden-mobile.png` });
  });
});
