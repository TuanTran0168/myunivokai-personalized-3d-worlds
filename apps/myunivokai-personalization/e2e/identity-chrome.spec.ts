import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * The identity chrome: the two credential screens, the account menu, and the
 * one toast that reports a finished save.
 *
 * These four surfaces had no shots at all, which is why the defect they are
 * here to hold was reported from a screenshot rather than caught: nothing in
 * this repository could see that an open account menu and the panel underneath
 * it were legible through each other, or that a save confirmation landed on top
 * of the Save button.
 *
 * Two of the tests assert as well as photograph, and what they assert is chosen
 * to be identical on every machine — see playwright.config.ts on why a pixel
 * assertion here would be worse than nothing. A CSS material and two bounding
 * boxes are not GPU output.
 */

/** Long enough for the backdrop's canvas chunk to load and its first frames to
 * land. The canvas is lazy now (components/AmbientBackdrop.tsx), so this waits
 * on a network fetch as well as on a scene. */
const BACKDROP_SETTLE_MILLISECONDS = 6_000;

/**
 * A signed-in session, seeded the way the app itself stores one: two
 * non-httpOnly cookies and the display copy in localStorage (lib/productSession.ts).
 * No gateway is involved — nothing about the account menu asks the server who
 * is signed in.
 *
 * The name carries Vietnamese diacritics on purpose. It is what the owner's own
 * account is called, it is the string the menu takes its initial from, and
 * `label[0]` on a combining sequence is a real way to get that wrong.
 */
const SIGNED_IN_ACCOUNT = {
  accountId: "d290f1ee-6c54-4b01-90e6-d701748f0851",
  email: "tran.dang.tuan@myunivokai.test",
  name: "Trần Đăng Tuấn"
};

const PROFILE_FIXTURE = {
  displayName: SIGNED_IN_ACCOUNT.name,
  fullName: "Trần Đăng Tuấn",
  gender: "",
  preferredWorldFamily: "universe",
  autofillCreateForm: false,
  creationDefaults: {
    nickname: SIGNED_IN_ACCOUNT.name,
    role: "Explorer",
    interests: ["Technology", "Design", "AI"],
    traits: ["curious", "builder", "focused"],
    goal: "Ship something that outlives the sprint it was built in.",
    challenge: "",
    mood: "dreamy",
    favoriteColors: ["#7C5CF0", "#06B6D4"],
    preferredWorldStyle: "nebula"
  }
};

async function seedSignedInSession(page: Page) {
  await page.addInitScript((account) => {
    const oneWeekInSeconds = 7 * 24 * 60 * 60;
    document.cookie = `myunivokai_access=seeded-access-token; Path=/; Max-Age=${oneWeekInSeconds}; SameSite=Lax`;
    document.cookie = `myunivokai_refresh=seeded-refresh-token; Path=/; Max-Age=${oneWeekInSeconds}; SameSite=Lax`;
    window.localStorage.setItem("myunivokai.productAccount.v1", JSON.stringify(account));
  }, SIGNED_IN_ACCOUNT);
}

async function serveAccountProfile(page: Page) {
  await page.route("**/api/me/profile", async (route) => {
    // The same body for the read and the save. This spec is about what the
    // page looks like after a save succeeds, not about what the server does
    // with the fields.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROFILE_FIXTURE) });
  });
  // The gallery link in the menu and the toast is real, and a stray prefetch of
  // the account's world list would otherwise reach a gateway that is not there.
  await page.route("**/api/me/worlds**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ worlds: [] }) });
  });
}

async function photograph(page: Page, name: string) {
  // Stop the loop before the shot, exactly as scene-baseline does: a running
  // rAF and a screenshot are not atomic, and a torn frame is a difference that
  // says nothing about the code.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.screenshot({ path: `e2e/shots/${test.info().project.name}/${name}.png`, animations: "disabled" });
}

/** Do these two boxes share any area at all? */
async function boxesOverlap(first: Locator, second: Locator): Promise<boolean> {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  if (!firstBox || !secondBox) {
    throw new Error("one of the elements has no box, so there is nothing to compare");
  }
  return (
    firstBox.x < secondBox.x + secondBox.width &&
    secondBox.x < firstBox.x + firstBox.width &&
    firstBox.y < secondBox.y + secondBox.height &&
    secondBox.y < firstBox.y + firstBox.height
  );
}

test.describe("the credential screens", () => {
  for (const screen of [
    { path: "/sign-in", name: "sign-in" },
    { path: "/sign-up", name: "sign-up" }
  ]) {
    test(`${screen.name} over its own world`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(BACKDROP_SETTLE_MILLISECONDS);
      await photograph(page, screen.name);
    });
  }

  // That the two screens show DIFFERENT worlds is asserted in
  // features/identity/authBackdropScene.test.ts, on the seeds, where it is a
  // fact rather than an image. It is not repeated here: comparing two canvases
  // would be the pixel assertion playwright.config.ts exists to warn against.
});

test.describe("the account menu", () => {
  test.beforeEach(async ({ page }) => {
    await seedSignedInSession(page);
    await serveAccountProfile(page);
  });

  test("is opaque where it overlaps the panel beneath it", async ({ page }) => {
    await page.goto("/");
    // Scoped to the header's nav: `next dev` mounts a dev-tools button with the
    // same aria-haspopup, and a bare attribute selector matches both.
    const menuTrigger = page.locator('nav button[aria-haspopup="menu"]');
    await expect(menuTrigger).toBeVisible({ timeout: 30_000 });
    await menuTrigger.click();

    const menuPanel = page.getByRole("menu");
    await expect(menuPanel).toBeVisible();

    // The overlap is asserted first, because without it the material assertion
    // below would be about a hypothetical. This menu opens directly over the
    // create page's live-preview island at every desktop width.
    // `:visible` because the create page renders this label twice — the
    // desktop island and the compact placard that replaces it below lg — and
    // exactly one of them is on screen at any width.
    const livePreviewLabel = page.locator(':text-is("Live preview"):visible').first();
    if (await livePreviewLabel.count()) {
      expect(await boxesOverlap(menuPanel, livePreviewLabel), "the menu no longer overlaps the live preview").toBe(
        true
      );
    }

    // And the fix: the panel on top refracts what is behind it instead of
    // showing it. A revert to the clear material (`--glass-tint`, saturate with
    // no blur) fails here rather than in a screenshot nobody reopened.
    const material = await menuPanel.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return {
        // Read through getPropertyValue so the -webkit- prefix is reachable:
        // it is a real property in the browser and not in lib.dom's typings.
        backdropFilter:
          computed.getPropertyValue("backdrop-filter") || computed.getPropertyValue("-webkit-backdrop-filter"),
        backgroundColor: computed.backgroundColor
      };
    });
    expect(material.backdropFilter).toContain("blur(");
    expect(material.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    await photograph(page, "account-menu-over-create-form");
  });
});

test.describe("the profile page's save confirmation", () => {
  test.beforeEach(async ({ page }) => {
    await seedSignedInSession(page);
    await serveAccountProfile(page);
  });

  test("does not cover the button that produced it", async ({ page }) => {
    await page.goto("/account");
    const saveButton = page.getByRole("button", { name: "Save profile" });
    await expect(saveButton).toBeVisible({ timeout: 30_000 });
    await saveButton.click();

    const confirmation = page.getByRole("status");
    await expect(confirmation).toBeVisible({ timeout: 30_000 });
    // The whole of the defect, as geometry: the toast used to sit at
    // `bottom-20`, over the Save button and over the way out beside it.
    expect(await boxesOverlap(confirmation, saveButton), "the confirmation is back on top of Save").toBe(false);

    // Both ways out are offered, and neither is the page being looked at.
    await expect(confirmation.getByRole("link", { name: "Back to your personalization" })).toBeVisible();
    await expect(confirmation.getByRole("link", { name: "Back to your gallery" })).toBeVisible();

    await photograph(page, "profile-save-confirmation");
  });
});
