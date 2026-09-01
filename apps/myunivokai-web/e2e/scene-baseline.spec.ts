import { test, expect, type Page } from "@playwright/test";
import universeWorld from "./fixtures/universe-world.json";
import natureWorld from "./fixtures/nature-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";
import oceanTwilightWorld from "./fixtures/ocean-twilight-world.json";
import oceanAbyssWorld from "./fixtures/ocean-abyss-world.json";
import oceanSurfaceWorld from "./fixtures/ocean-surface-world.json";
import oceanDaylightWorld from "./fixtures/ocean-daylight-world.json";

/**
 * The scenes are served from fixtures, never from a running gateway, and the
 * fixtures are the family services' own golden scene files. Two reasons, and
 * the second is the load-bearing one:
 *
 * - A backend is not needed to answer the question these images ask, which is
 *   "does the renderer still draw this scene the same way".
 * - A generated world would differ between the before run and the after run,
 *   and then every difference in the images would be ambiguous. Pinning the
 *   scene config means the only variable left is the code.
 */
// The glob has to start with ** — the gateway is a different origin from the
// app (NEXT_PUBLIC_GATEWAY_BASE_URL, default http://localhost:41800), and a
// pattern beginning with "/" is resolved against baseURL, so it would silently
// match nothing and every scene would render empty.
const FIXTURES = {
  universe: { world: universeWorld, path: "**/api/universe/**" },
  nature: { world: natureWorld, path: "**/api/nature/**" }
} as const;

/**
 * The ocean family gets FIVE shots, not one, and they are the only fixtures here
 * chosen to differ from each other rather than to be representative.
 *
 * They are now exactly the create form's four DEPTH & MOOD options, one shot per
 * option, with the above-water option sampled twice. That correspondence is the
 * point: each mood names a home depth (a weighted lean for "Glass Shallows",
 * a pin for the other three — see AboveWaterProbability), so this set is a
 * picture of every sea a visitor can actually ask for, and a preset that
 * stops working stops working here first.
 *
 *   ocean-surface   Glass Shallows      10.1 m UP,   sun  4.6 deg   golden hour
 *   ocean-daylight  Glass Shallows       9.5 m UP,   sun 37.2 deg   midday sea
 *   ocean-shallow   Reef Crest          24.5 m down, floor at 33 m  lit reef
 *   ocean-twilight  Mesophotic Current  62.7 m down, floor at 3.7 km midwater
 *   ocean-abyss     The Abyss           2209 m down, floor at 2214  on the bottom
 *
 * Depth is this family's whole axis, and the failure it is prone to is one no
 * single image can show: two worlds hundreds of metres apart that render
 * indistinguishably. If two of these images look alike, the family has lost the
 * thing it was built for.
 *
 * All five are spliced from ocean-service's own golden configs by
 * e2e/refresh-ocean-fixtures.mjs — never hand-written, because a hand-tuned
 * fixture measures a look nobody can generate.
 */
const OCEAN_DEPTHS = [
  { name: "ocean-surface", world: oceanSurfaceWorld },
  { name: "ocean-daylight", world: oceanDaylightWorld },
  { name: "ocean-shallow", world: oceanShallowWorld },
  { name: "ocean-twilight", world: oceanTwilightWorld },
  { name: "ocean-abyss", world: oceanAbyssWorld }
] as const;

const UNIVERSE_WORLD_ID = universeWorld.world.id;
const NATURE_WORLD_ID = natureWorld.world.id;

/**
 * How long the scene is allowed to run before it is photographed.
 *
 * Not a settle time — an orbit never settles. It is long enough for the lazy
 * renderer chunk to arrive, the GLTF models to load and the first frames to
 * draw, which is what these images are actually checking. The animation PHASE
 * is deliberately not pinned: freezing three.js's clock without touching
 * React's scheduler is not reliably possible from the outside, and the failures
 * worth catching here — a black canvas, missing geometry, foliage the wrong
 * colour after a shader-chunk rename — are all visible regardless of where an
 * orbit happens to be. Compare these by eye for CONTENT, never pixel by pixel.
 */
const SCENE_RENDER_MILLISECONDS = 6_000;

async function serveWorldFixtures(page: Page, oceanWorld?: unknown) {
  if (oceanWorld) {
    await page.route("**/api/ocean/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(oceanWorld) });
    });
  }
  for (const { world, path } of Object.values(FIXTURES)) {
    await page.route(path, async (route) => {
      // Mutations are never exercised by these shots; answering them with the
      // same body keeps an accidental click from producing a network error
      // toast in the corner of an image.
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

async function photographScene(page: Page, name: string) {
  // The canvas is what has to exist; the rest of the page renders without it.
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(SCENE_RENDER_MILLISECONDS);
  // Stop the loop before the shot. Playwright's screenshot is not atomic with
  // respect to a running rAF, so without this the same run can produce a torn
  // frame — a difference that says nothing about the code.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.screenshot({ path: `e2e/shots/${test.info().project.name}/${name}.png`, animations: "disabled" });
}

test.describe("scene baseline", () => {
  test.beforeEach(async ({ page }) => {
    await serveWorldFixtures(page);
  });

  test("universe world page", async ({ page }) => {
    await page.goto(`/worlds/${UNIVERSE_WORLD_ID}`);
    await photographScene(page, "universe-world");
  });

  test("forest world page", async ({ page }) => {
    // The forest family is selected by query parameter, exactly as the gallery
    // links to it — see lib/worldRoutes.ts.
    await page.goto(`/worlds/${NATURE_WORLD_ID}?family=nature`);
    await photographScene(page, "forest-world");
  });

  test("universe share page", async ({ page }) => {
    await page.goto(`/universe/share/worlds/${universeWorld.world.shareSlug}`);
    await photographScene(page, "universe-share");
  });

  test("forest share page", async ({ page }) => {
    await page.goto(`/nature/share/worlds/${natureWorld.world.shareSlug}`);
    await photographScene(page, "forest-share");
  });

  // The loading state is its own shot because it is its own React tree: a
  // Suspense fallback that the Next 15 / React 19 hop changes the timing of,
  // on the one screen where a regression looks like a hang rather than an error.
  test("world page while the world is still loading", async ({ page }) => {
    await page.route("**/api/universe/worlds/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(universeWorld) });
    });
    await page.goto(`/worlds/${UNIVERSE_WORLD_ID}`);
    await expect(page.getByText(/loading world/i)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `e2e/shots/${test.info().project.name}/world-loading.png`, animations: "disabled" });
  });

  // Not a scene, but the entry point every visitor meets first, and the one
  // page whose layout is pure App Router. If async params or the React 19 hop
  // break routing, this is where it shows up without any WebGL in the way.
  for (const { name, world } of OCEAN_DEPTHS) {
    test(`${name} world page`, async ({ page }) => {
      await serveWorldFixtures(page, world);
      await page.goto(`/worlds/${world.world.id}?family=ocean`);
      await photographScene(page, name);
    });
  }

  test("landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.screenshot({
      path: `e2e/shots/${test.info().project.name}/landing.png`,
      fullPage: true,
      animations: "disabled"
    });
  });
});
