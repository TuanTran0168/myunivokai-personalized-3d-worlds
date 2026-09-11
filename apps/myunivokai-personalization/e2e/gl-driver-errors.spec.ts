import { test, expect, type Page } from "@playwright/test";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";

/**
 * WHAT THE GL DRIVER SAYS WHILE A SCENE RENDERS, WHICH NOBODY WAS READING.
 *
 * A WebGL error is not an exception. `glBlitFramebuffer` with an illegal
 * argument does not throw, does not reject and does not stop the frame — it
 * writes a console line and the driver drops the operation. So the image still
 * arrives, `npm test` passes because it runs pure functions, `tsc` passes
 * because the types are fine, and the screenshot suite passes because — by its
 * own deliberate policy — it asserts nothing and asks a human to compare frames
 * "by eye for CONTENT". Every gate this repository has is pointed somewhere
 * else, and this channel had never been read.
 *
 * IT IS CLEAN, and that is the assertion. Both families that mount the post
 * chain render a scene without asking the driver for anything illegal.
 *
 * THE MEASUREMENT THAT FOUND SOMETHING, AND WHERE IT WENT. Against a
 * DEVELOPMENT server the forest reports
 *
 *   GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
 *   attachments cannot be the same image.
 *
 * 256 times in 8 seconds — about one per frame — until the driver gives up with
 * "too many errors, no more errors will be reported to the console for this
 * context". Against a PRODUCTION build of the same commit: zero. The universe is
 * zero on both, and the difference between the families is `N8AO`, which the
 * forest is the only one to mount and which needs the depth buffer the composer
 * is also writing.
 *
 * The most likely cause is `reactStrictMode` (`next.config.ts`), which
 * double-mounts every component in development: two `EffectComposer`s, each
 * allocating a depth-stencil attachment, and a blit between the two. **That is
 * an inference from where the difference lives, not a proof** — attributing it
 * properly would mean restarting the dev server with StrictMode off, and the dev
 * server here belongs to the local compose stack.
 *
 * Either way, no visitor meets it: visitors get a production build. Developers
 * do, on every forest frame, which is enough noise to bury a real error — so it
 * is written down here rather than in a scratch note.
 *
 * NOT IN CI. No GPU there, and this project runs no Playwright in CI
 * (`agent-system/rules/ci-quality-gates.md`).
 */

const SCENE_RENDER_MILLISECONDS = 8_000;

/** The message class a WebGL implementation uses for an illegal operation. */
const GL_ERROR_PATTERN = /GL_INVALID_(OPERATION|VALUE|ENUM|FRAMEBUFFER_OPERATION)/;

type DriverErrorCase = {
  name: string;
  world: unknown;
  route: string;
  path: string;
};

const CASES: DriverErrorCase[] = [
  {
    name: "universe world",
    world: universeWorld,
    route: "**/api/universe/**",
    path: `/worlds/${universeWorld.world.id}`
  },
  {
    name: "forest world",
    world: natureWorld,
    route: "**/api/nature/**",
    path: `/worlds/${natureWorld.world.id}?family=nature`
  }
];

function collectGlErrors(page: Page): string[] {
  const glErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (GL_ERROR_PATTERN.test(text)) {
      glErrors.push(text);
    }
  });
  return glErrors;
}

/** The distinct error bodies, with driver-specific context ids removed. */
function distinctErrors(glErrors: string[]): string[] {
  return Array.from(new Set(glErrors.map((error) => error.replace(/\[\.WebGL-0x[0-9a-f]+\]\s*/, "").trim())));
}

for (const driverErrorCase of CASES) {
  test(`${driverErrorCase.name} draws without upsetting the GL driver`, async ({ page }) => {
    const glErrors = collectGlErrors(page);
    await page.route(driverErrorCase.route, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(driverErrorCase.world)
      });
    });
    await page.goto(driverErrorCase.path);
    await page.locator("canvas[data-engine]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);

    const distinct = distinctErrors(glErrors);
    console.log(`${driverErrorCase.name}: ${glErrors.length} GL errors, ${distinct.length} distinct`);
    for (const error of distinct) {
      console.log(`  ${error}`);
    }

    expect(
      glErrors.length,
      `The GL driver reported ${glErrors.length} illegal operations while this scene rendered:\n` +
        distinct.map((error) => `  ${error}`).join("\n") +
        "\n\nIf this appeared against a development server, read the note at the top of this file " +
        "before believing it: the forest reports 256 of these in dev and none in a production build."
    ).toBe(0);
  });
}
