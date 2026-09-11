import { test, expect } from "@playwright/test";

/**
 * The LANDING PAGE preview, one shot per ocean mood.
 *
 * This exists because the baseline suite photographs /worlds/<id>, and the
 * ocean rig passed every one of those shots during a round in which the landing
 * page preview rendered a white rectangle. They are two different scene configs
 * — one stored by the service, one built live in the browser — through the same
 * renderer, so a shot of one says nothing about the other, and the preview is
 * the first thing anyone sees.
 *
 * It drives the page the way a person does, and fails on anything the page
 * logs, which the baseline suite deliberately does not do.
 */
const OCEAN_MOODS = ["still", "drifting", "surge", "abyss"] as const;

for (const mood of OCEAN_MOODS) {
  test(`landing preview: ocean / ${mood}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        problems.push(`[${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));

    await page.goto("/");
    await page.getByRole("button", { name: "Ocean", exact: false }).first().click();

    // The mood buttons are relabelled per family, so find the one whose index
    // matches — the ocean labels are Glass Shallows / Mesophotic Current / Reef
    // Crest / The Abyss.
    const label = {
      still: "Glass Shallows",
      drifting: "Mesophotic Current",
      surge: "Reef Crest",
      abyss: "The Abyss",
    }[mood];
    await page.getByRole("button", { name: label, exact: false }).first().click();

    await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(9_000);
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.screenshot({
      path: `e2e/shots/${test.info().project.name}/preview-ocean-${mood}.png`,
      animations: "disabled",
    });

    if (problems.length > 0) {
      console.log(`\n--- ${mood} ---\n` + problems.slice(0, 40).join("\n"));
    }
  });
}
