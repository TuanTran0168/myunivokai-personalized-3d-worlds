import { test, expect, type Page } from "@playwright/test";

/**
 * THE CREATE FORM'S LIVE PREVIEW, PHOTOGRAPHED WITH THE CLOCK PINNED.
 *
 * This is the screen every report about the scene has come from, and until now
 * it was the one screen no spec could photograph reproducibly. `sun-colour.spec.ts`
 * says so in its own limits: it pins a stored world through a fixture, and the
 * create form has no fixture to pin.
 *
 * It turns out it does not need one. `UniverseCanvas` reads the parity harness
 * off `window.location.search`, wherever it is mounted — the home page included
 * — so `?parityRenderer=webgl&paritySeconds=N` stops the preview's clock at the
 * same instant on every run. Everything else about the preview is already
 * deterministic: `previewSeedFromInputs` derives the whole scene from the form,
 * so a shot is a function of the fields typed into it.
 *
 * Which is what makes these comparable across a code change. Two runs of this
 * file differ by the code between them, not by the moment the shutter opened.
 *
 * These produce ARTEFACTS, not verdicts — the same contract as the rest of
 * `npm run shoot`. The arithmetic gate for the geometry is
 * `solar-system/binarySunGeometry.test.ts`, which runs in `npm test`.
 */

const PINNED_SECONDS = 6;
const SCENE_ARRIVAL_MILLISECONDS = 20_000;
const HARNESS_ARRIVAL_MILLISECONDS = 120_000;
const CANVAS_VISIBLE_MILLISECONDS = 60_000;
const PREVIEW_SHOT_TIMEOUT_MILLISECONDS = 300_000;

const NICKNAME_PLACEHOLDER = "e.g. Neo";
const SHOT_DIRECTORY = "e2e/shots/create-form-preview";

/**
 * The case the owner reported. Every other field is left at
 * `CREATE_FORM_INITIAL_VALUES`, because their screenshot shows exactly those
 * defaults — Technology/Design/AI, Curious/Builder/Focused, the violet-and-cyan
 * palette — with the nickname the only field they had touched. Signing in is
 * what typed it: `profileAutofill.ts` fills the nickname from the account's
 * display name.
 *
 * That name rolls `binary-sun` and `black-hole` out of the rare-feature lottery;
 * the empty nickname below rolls neither. Both shots are worth keeping, because
 * the pair is the whole explanation for "the old build did not look like this".
 */
const REPORTED_NICKNAME = "Trần Đăng Tuấn";

async function photographPinnedPreview(page: Page, nickname: string, shotName: string) {
  await page.goto(`/?parityRenderer=webgl&paritySeconds=${PINNED_SECONDS}`);
  await page.waitForFunction(() => "__parityHarness" in window, undefined, {
    timeout: HARNESS_ARRIVAL_MILLISECONDS
  });

  if (nickname.length > 0) {
    await page.getByPlaceholder(NICKNAME_PLACEHOLDER).fill(nickname);
  }

  // The preview re-solves its framing whenever a field changes, so the clock is
  // advanced AFTER the name is in: pinning first would photograph the scene the
  // empty form built.
  await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
  await page.evaluate(async () => {
    const harness = (window as unknown as { __parityHarness: { advanceToPinnedTime: () => Promise<void> } })
      .__parityHarness;
    await harness.advanceToPinnedTime();
  });

  await expect(page.locator("canvas[data-engine]")).toBeVisible({ timeout: CANVAS_VISIBLE_MILLISECONDS });
  await page.screenshot({ path: `${SHOT_DIRECTORY}/${shotName}.png`, animations: "disabled" });
}

test("the create form preview, with the nickname that rolls a binary sun", async ({ page }, testInfo) => {
  test.setTimeout(PREVIEW_SHOT_TIMEOUT_MILLISECONDS);
  await photographPinnedPreview(page, REPORTED_NICKNAME, `${testInfo.project.name}-binary-sun`);
});

test("the create form preview, with the nickname left empty", async ({ page }, testInfo) => {
  test.setTimeout(PREVIEW_SHOT_TIMEOUT_MILLISECONDS);
  await photographPinnedPreview(page, "", `${testInfo.project.name}-default`);
});
