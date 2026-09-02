/**
 * Measures the transition bench instead of looking at it.
 *
 *   node demos/world-change-transition/measure.mjs
 *
 * This demo makes three claims in prose, and prose is exactly what an agent
 * producing a page like this cannot be trusted on. All three are numbers:
 *
 *   1. The timeline under "What shipped" says 620 ms out, a hold, 620 ms in.
 *      Each stage is timed end to end, from the click to the Play button being
 *      re-enabled, against what its own code asks for.
 *   2. "The hold is painted in the ARRIVING world's ground colour." Sampled
 *      from the canvas mid-hold and compared against both worlds' grounds. A
 *      hold painted in the departing world's colour is the version of this
 *      effect that says nothing about where you are going, and it looks
 *      completely fine in a screenshot.
 *   3. "The rail and header stay put throughout." The rail's bounding box is
 *      read before, during and after. A screenshot mid-gesture is what caught
 *      the real implementation's layering fault — the still was at z-40 and the
 *      arriving container at z-10, so one half slid OVER the form the visitor
 *      was operating and the other slid UNDER it.
 *
 * WHAT THIS DOES NOT PROVE. The bench never compiles a shader, so its "stall"
 * is a setTimeout and every stage here keeps animating through it. In the app
 * only the CSS hold does. Nothing measured here says anything about the real
 * 2.7 s of blocked main thread — see the cold-mount section of
 * agent-system/agents/frontend-agent.md and the transition modules themselves.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Node resolves a bare specifier from the importing file, not from the working
// directory, and this demo has no node_modules of its own. createRequire moves
// the resolution base to the web app, which owns the Playwright dependency.
const appRequire = createRequire(resolve(here, "../../apps/myunivokai-personalization/package.json"));
const { chromium } = appRequire("playwright");

const PAGE_URL = pathToFileURL(resolve(here, "between-worlds.html")).href;

// The bench's own constants, duplicated here on purpose: a measurement that
// reads its expectations out of the thing it is measuring proves nothing.
const STALL_MILLISECONDS = 2500;
const GENIE_HALF_MILLISECONDS = 620;
const STAGE_TIMEOUT_MILLISECONDS = 20000;

// Wall-clock timing in a headless browser is not a stopwatch: a frame boundary,
// a font load or a GC pause all land inside a measured span. Wide enough not to
// be flaky, tight enough that a stage silently losing half its animation fails.
const DURATION_TOLERANCE_MILLISECONDS = 500;

// Two colours count as the same world's ground when every channel is this
// close. The hold darkens its world's sky by 45-50%, so the two candidate
// answers are far further apart than this.
const CHANNEL_MATCH_TOLERANCE = 10;
// Sampled near the top-left corner, not the centre. The centre is where the
// loader is drawn, and its accent pulse pulls the pixel toward the answer this
// check is supposed to be able to get wrong.
const GROUND_SAMPLE_X_RATIO = 0.08;
const GROUND_SAMPLE_Y_RATIO = 0.02;
const RAIL_MOVEMENT_TOLERANCE_PIXELS = 0.5;

const EXPECTED_TOTAL_MILLISECONDS = {
  "Hard cut": 300 + STALL_MILLISECONDS + 700,
  "Push with parallax": 420 + STALL_MILLISECONDS,
  "Genie, scanline": GENIE_HALF_MILLISECONDS + STALL_MILLISECONDS + GENIE_HALF_MILLISECONDS,
  "Genie out · hold · in": GENIE_HALF_MILLISECONDS + STALL_MILLISECONDS + GENIE_HALF_MILLISECONDS
};

const failures = [];

function check(passed, message) {
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${message}`);
  if (!passed) {
    failures.push(message);
  }
}

function channelsClose(first, second) {
  return (
    Math.abs(first[0] - second[0]) <= CHANNEL_MATCH_TOLERANCE &&
    Math.abs(first[1] - second[1]) <= CHANNEL_MATCH_TOLERANCE &&
    Math.abs(first[2] - second[2]) <= CHANNEL_MATCH_TOLERANCE
  );
}

/** The card index whose <h3> matches, so a reordered bench fails loudly. */
async function cardIndexByTitle(page, title) {
  return page.evaluate(
    (wanted) => Array.from(document.querySelectorAll(".card h3")).findIndex((heading) => heading.textContent === wanted),
    title
  );
}

async function playAndTime(page, cardIndex) {
  const startedAt = Date.now();
  await page.click(`.card:nth-of-type(${cardIndex + 1}) .play`);
  await page.waitForFunction(
    (index) => !document.querySelectorAll(".card")[index].querySelector(".play").disabled,
    cardIndex,
    { timeout: STAGE_TIMEOUT_MILLISECONDS }
  );
  return Date.now() - startedAt;
}

/** The ground colour of a card's stage canvas, sampled clear of the loader. */
async function sampleStageGround(page, cardIndex, xRatio, yRatio) {
  return page.evaluate(
    ({ index, x, y }) => {
      const canvas = document.querySelectorAll(".card")[index].querySelector("canvas");
      const context = canvas.getContext("2d");
      const pixel = context.getImageData(Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    },
    { index: cardIndex, x: xRatio, y: yRatio }
  );
}

async function railBox(page, cardIndex) {
  return page.evaluate((index) => {
    const rail = document.querySelectorAll(".card")[index].querySelector(".rail");
    const box = rail.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }, cardIndex);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.goto(PAGE_URL);
await page.waitForSelector(".card .play");

console.log("\nStage duration — click to the Play button coming back, stall on\n");

for (const [title, expectedMilliseconds] of Object.entries(EXPECTED_TOTAL_MILLISECONDS)) {
  const cardIndex = await cardIndexByTitle(page, title);
  if (cardIndex < 0) {
    check(false, `stage "${title}" is not on the page`);
    continue;
  }
  const measured = await playAndTime(page, cardIndex);
  const drift = measured - expectedMilliseconds;
  check(
    Math.abs(drift) <= DURATION_TOLERANCE_MILLISECONDS,
    `${title.padEnd(22)} ${String(measured).padStart(5)} ms   want ${expectedMilliseconds} ±${DURATION_TOLERANCE_MILLISECONDS}   (${drift >= 0 ? "+" : ""}${drift})`
  );
}

console.log("\nThe hold belongs to the arriving world\n");

const holdIndex = await cardIndexByTitle(page, "Genie out · hold · in");
// Play, then sample once the departure is over and the loader is holding.
const holdSample = await (async () => {
  const clicked = page.click(`.card:nth-of-type(${holdIndex + 1}) .play`);
  await page.waitForTimeout(GENIE_HALF_MILLISECONDS + STALL_MILLISECONDS / 2);
  const centre = await sampleStageGround(page, holdIndex, GROUND_SAMPLE_X_RATIO, GROUND_SAMPLE_Y_RATIO);
  await clicked;
  await page.waitForFunction(
    (index) => !document.querySelectorAll(".card")[index].querySelector(".play").disabled,
    holdIndex,
    { timeout: STAGE_TIMEOUT_MILLISECONDS }
  );
  return centre;
})();

// Both candidate grounds, computed the way the page computes them, so the only
// question left is which one the hold actually used.
const grounds = await page.evaluate(() => {
  function shade(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const factor = 1 + amount;
    return [
      Math.round(((value >> 16) & 255) * factor),
      Math.round(((value >> 8) & 255) * factor),
      Math.round((value & 255) * factor)
    ];
  }
  return {
    universe: shade("#070A14", -0.45),
    forest: shade("#9FB6C4", -0.45),
    ocean: shade("#2E8FB4", -0.45)
  };
});

check(
  channelsClose(holdSample, grounds.forest),
  `hold ground rgb(${holdSample.join(",")}) matches the arriving forest rgb(${grounds.forest.join(",")})`
);
check(
  !channelsClose(holdSample, grounds.universe),
  `hold ground is NOT the departing universe rgb(${grounds.universe.join(",")})`
);

console.log("\nThe rail never moves\n");

const railIndex = await cardIndexByTitle(page, "Genie out · hold · in");
const railBefore = await railBox(page, railIndex);
const railPlay = page.click(`.card:nth-of-type(${railIndex + 1}) .play`);
await page.waitForTimeout(GENIE_HALF_MILLISECONDS / 2);
const railDuring = await railBox(page, railIndex);
await railPlay;
await page.waitForFunction(
  (index) => !document.querySelectorAll(".card")[index].querySelector(".play").disabled,
  railIndex,
  { timeout: STAGE_TIMEOUT_MILLISECONDS }
);
const railAfter = await railBox(page, railIndex);

for (const [label, box] of [
  ["mid-gesture", railDuring],
  ["after", railAfter]
]) {
  const moved = Math.max(
    Math.abs(box.left - railBefore.left),
    Math.abs(box.top - railBefore.top),
    Math.abs(box.width - railBefore.width),
    Math.abs(box.height - railBefore.height)
  );
  check(moved <= RAIL_MOVEMENT_TOLERANCE_PIXELS, `rail ${label}: moved ${moved.toFixed(2)} px`);
}

await browser.close();

console.log(`\n${failures.length === 0 ? "All checks passed." : `${failures.length} check(s) failed.`}\n`);
process.exit(failures.length === 0 ? 0 : 1);
