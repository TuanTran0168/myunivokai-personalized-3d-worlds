import { mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import {
  BLANK_FRAME_LUMINANCE_DEVIATION,
  compareBlockMeans,
  describeBlockComparison,
  inflatePng,
  luminanceStandardDeviation
} from "./parityMetrics.mjs";
import natureWorld from "./fixtures/nature-world.json";
import universeWorld from "./fixtures/universe-world.json";
import oceanShallowWorld from "./fixtures/ocean-shallow-world.json";
import oceanSurfaceWorld from "./fixtures/ocean-surface-world.json";

/**
 * DOES THE STILL CAPTURE PRODUCE THE PICTURE THE VISITOR IS LOOKING AT?
 *
 * Stage 0 of `agent-system/plans/frontend/webgpu-graphics-upgrade-roadmap.md`,
 * and the spec that replaces a ratchet rather than inverting it.
 * `node-path-diagnostic.spec.ts` recorded that both node backends read their
 * canvas back EMPTY — 0 of 256 samples carrying alpha AND 0 of 256 carrying
 * colour — and said in its own comment that the day an offscreen rebuild fixed
 * it, the recorded branch should be deleted. This is that rebuild's evidence.
 *
 * # WHY IT IS COMPARED AGAINST A SCREENSHOT AND NOT AGAINST ITSELF
 *
 * "The capture returned some bytes" is not the claim. Three things can each be
 * separately wrong and each produce a plausible rectangle:
 *
 *   - the **row order**: `gl.readPixels` reads a framebuffer whose origin is
 *     bottom-left, `copyTextureToBuffer` copies a texture whose origin is
 *     top-left, so one of the two node backends has to be flipped and the other
 *     must not be. An upside-down still passes every non-blank check there is.
 *   - the **row padding**: WebGPU pads every row to 256 bytes. Read as if it
 *     were tight, the picture shears progressively down its own height — which
 *     reads as a rendering fault rather than as a unit mistake.
 *   - the **tone curve and colour space**: a still rendered through
 *     `setRenderTarget` instead of `setOutputRenderTarget` comes back linear and
 *     un-tone-mapped, because `Renderer.currentToneMapping` collapses to
 *     `NoToneMapping` whenever `isOutputTarget` is false. That is a dark, flat
 *     picture that is still obviously "a picture".
 *
 * A Playwright screenshot of the canvas element is what the visitor sees,
 * composited by the browser, on whichever backend really drew. Comparing the
 * capture against it catches all three at once, and nothing cheaper does.
 *
 * # THE BUDGET IS ONE FRAME OF THE WORLD'S OWN MOTION, MEASURED PER RUN
 *
 * **A CAPTURE COSTS ONE EXTRA FRAME, AND AN EXTRA FRAME IS NOT FREE IN THIS
 * APP.** That is the finding this spec was built to reach, and it was reached
 * by ruling everything else out. The still disagreed with the canvas on the
 * universe and the forest, and the obvious readings were all wrong:
 *
 *   - not a stale canvas, not a drifting scene — `readSceneState()` reports the
 *     same clock, camera pose and world-position checksum on both sides of the
 *     capture, and two captures taken back to back agree to 0.02 of 255;
 *   - not the post chain — bypassing it keeps the same disagreement;
 *   - not the readback — both ocean fixtures take the identical readback path
 *     on the identical backends and land at 0.02.
 *
 * What finally answered it was asking the canvas to REPAINT ITSELF at the clock
 * it is already at. A zero delta gives every `useFrame` nothing to integrate,
 * so the scene cannot move — and the repainted canvas still differs from the
 * screenshot taken a moment earlier by **22 to 34 of 255**, on the classic
 * renderer as much as on the node ones. Something in this app advances per
 * FRAME rather than per DELTA. So the still is a picture of the world one frame
 * on from the canvas, and that is the correct amount of difference for it to
 * have rather than a defect to tune away.
 *
 * **So the tolerance is that repaint, and comparing like with like collapses
 * the disagreement to nothing.** Each leg measures, in the same run and on the
 * same machine, what one more frame does to it; the capture is then compared
 * against the repainted canvas rather than against the frame before it. Every
 * one of the twelve legs then lands between **0.01 and 0.11 of 255**, against
 * one-frame budgets of 16 to 36. The still IS the frame on screen.
 *
 * No hand-recorded table: one was written — universe 16.93, forest 20.52 — and
 * thrown away, because it was recording the methodology rather than the app.
 * The gate is still a gate: a flipped, sheared or un-tone-mapped still lands
 * far outside one frame of motion, and the universe reads about 150 flipped
 * against a budget near 23.
 *
 * # WHY BLOCK MEANS RATHER THAN PER-PIXEL
 *
 * The capture is resampled into the comparison size, so per-pixel equality was
 * never available and a tolerance built on it could not be defended.
 * `compareBlockMeans` averages 16x16 blocks first, so high-frequency
 * disagreement cancels and a region that changed what it IS does not. Same lens
 * as `driver-parity.spec.ts`, for the same reason.
 *
 * Run it with `--project=webgpu`. The two SwiftShader projects have no WebGPU.
 */

const HARNESS_READY_TIMEOUT_MILLISECONDS = 60_000;
const SCENE_ARRIVAL_MILLISECONDS = 2_500;
const CAPTURE_TIMEOUT_MILLISECONDS = 300_000;
const PINNED_SECONDS = 6;

const SHOT_DIRECTORY = "e2e/shots/scene-still-capture";

const RENDERERS = ["webgl", "webgpu-forcewebgl", "webgpu"] as const;

const FIXTURES = [
  { name: "universe-world", worldId: universeWorld.world.id, family: "", oceanWorld: oceanShallowWorld },
  { name: "forest-world", worldId: natureWorld.world.id, family: "nature", oceanWorld: oceanShallowWorld },
  { name: "ocean-shallow", worldId: oceanShallowWorld.world.id, family: "ocean", oceanWorld: oceanShallowWorld },
  { name: "ocean-surface", worldId: oceanSurfaceWorld.world.id, family: "ocean", oceanWorld: oceanSurfaceWorld }
] as const;

/**
 * Room above the measured one-frame budget, for run-to-run noise.
 *
 * The same multiple `scene-parity.spec.ts` gives its own ledger. A gate with no
 * headroom fails because the machine was busy, and a gate that fails for that
 * reason gets switched off.
 */
const ONE_FRAME_BUDGET_HEADROOM = 1.6;

/**
 * And a floor under it, because two fixtures measure a one-frame budget of
 * EXACTLY ZERO.
 *
 * Both ocean legs on the node path repaint to 0.00 — that family's motion is
 * entirely a function of the clock, so a zero delta really does reproduce the
 * frame byte for byte. Their captures land at 0.02, which is resampling and
 * nothing else, and without a floor a budget of zero would fail them for it.
 */
const ONE_FRAME_BUDGET_FLOOR = { meanBlockDifference: 1, worstBlockDifference: 30 };

type FrameCounts = { drawCalls: number; triangles: number };

type CapturedStill = {
  dataUrl: string;
  nativeWidth: number;
  nativeHeight: number;
  capturedFromRenderTarget: boolean;
  captureCounts: FrameCounts;
};

type ParityHarnessWindow = Window & {
  __parityHarness?: {
    backend: string;
    advanceToPinnedTime: () => Promise<void>;
    redrawAtCurrentTime: () => FrameCounts;
    captureSceneStillAsPngDataUrl: (
      comparisonWidth: number,
      comparisonHeight: number
    ) => Promise<CapturedStill | null>;
  };
};

async function serveWorldFixtures(page: Page, oceanWorld: unknown) {
  const routes = [
    ["**/api/nature/**", natureWorld],
    ["**/api/universe/**", universeWorld],
    ["**/api/ocean/**", oceanWorld]
  ] as const;
  for (const [path, world] of routes) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(world) });
    });
  }
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

function pngBufferFromDataUrl(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), "base64");
}

/**
 * How much of each frame is compared, centred. Half, and the crop is
 * load-bearing rather than tidy.
 *
 * **A PLAYWRIGHT ELEMENT SCREENSHOT IS A VIEWPORT CAPTURE CLIPPED TO THE
 * ELEMENT'S BOX**, so a shot of the scene canvas contains every HTML overlay
 * drawn over it — on the world page that is the title card, the variant list,
 * the World DNA panel, the action bar. None of those is in the render target,
 * so a whole-frame comparison measures the chrome and not the capture. Measured
 * before the crop existed: **identical numbers on all three renderers** — mean
 * block 13.49, worst 93.02 at x=1328 on a 1440-wide frame, which is exactly
 * where the panel is — and the classic path failed it too, the one path that
 * reads the very canvas the screenshot came from. The same crop and the same
 * reasoning are already in `parityMetrics.mjs`'s `luminanceStandardDeviation`.
 */
const COMPARED_REGION_FRACTION = 0.5;

const RGBA_BYTES_PER_PIXEL = 4;

type DecodedFrame = { width: number; height: number; pixels: Buffer };

/** The middle of the frame, which is the one region that is scene everywhere. */
function cropToCentredRegion(frame: DecodedFrame): DecodedFrame {
  const regionWidth = Math.max(1, Math.round(frame.width * COMPARED_REGION_FRACTION));
  const regionHeight = Math.max(1, Math.round(frame.height * COMPARED_REGION_FRACTION));
  const startX = Math.round((frame.width - regionWidth) / 2);
  const startY = Math.round((frame.height - regionHeight) / 2);
  const pixels = Buffer.allocUnsafe(regionWidth * regionHeight * RGBA_BYTES_PER_PIXEL);
  for (let row = 0; row < regionHeight; row += 1) {
    const sourceStart = ((startY + row) * frame.width + startX) * RGBA_BYTES_PER_PIXEL;
    frame.pixels.copy(
      pixels,
      row * regionWidth * RGBA_BYTES_PER_PIXEL,
      sourceStart,
      sourceStart + regionWidth * RGBA_BYTES_PER_PIXEL
    );
  }
  return { width: regionWidth, height: regionHeight, pixels };
}

for (const fixture of FIXTURES) {
  for (const renderer of RENDERERS) {
    test(`${fixture.name} on ${renderer}: the still capture is the frame on screen`, async ({ page }) => {
      test.setTimeout(CAPTURE_TIMEOUT_MILLISECONDS);

      await serveWorldFixtures(page, fixture.oceanWorld);
      const familyParameter = fixture.family ? `family=${fixture.family}&` : "";
      await page.goto(
        `/worlds/${fixture.worldId}?${familyParameter}parityRenderer=${renderer}&paritySeconds=${PINNED_SECONDS}`
      );

      // Twice, for the reason `scene-parity.spec.ts` documents at length: the
      // routed fixture arriving remounts the whole <Canvas>, so a harness seen
      // before the wait belongs to a registration that no longer exists.
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });
      await page.waitForTimeout(SCENE_ARRIVAL_MILLISECONDS);
      await page.waitForFunction(() => (window as ParityHarnessWindow).__parityHarness !== undefined, undefined, {
        timeout: HARNESS_READY_TIMEOUT_MILLISECONDS
      });

      const backend = await page.evaluate(() => (window as ParityHarnessWindow).__parityHarness!.backend);
      // The clock is pinned before anything is photographed, so every picture
      // below is of one moment rather than of several.
      await page.evaluate(async () => {
        await (window as ParityHarnessWindow).__parityHarness!.advanceToPinnedTime();
      });

      const sceneCanvas = page.locator("canvas").first();

      // THREE PICTURES, IN THIS ORDER, AND THE ORDER IS THE MEASUREMENT.
      //   1. the pinned frame;
      //   2. the same frame repainted at the same clock — one frame on, with a
      //      delta of zero, so nothing in the scene has anything to integrate;
      //   3. the capture, which renders one more frame of its own.
      // (1 vs 2) is therefore what ONE extra frame does to this fixture, and
      // (2 vs 3) is what the capture does. The first is the budget for the
      // second. See the header.
      const pinnedFrame = inflatePng(await sceneCanvas.screenshot({ animations: "disabled" }), inflateSync);
      const canvasCounts = await page.evaluate(() =>
        (window as ParityHarnessWindow).__parityHarness!.redrawAtCurrentTime()
      );
      const repaintedScreenshot = await sceneCanvas.screenshot({ animations: "disabled" });
      const repaintedFrame = inflatePng(repaintedScreenshot, inflateSync);
      const oneFrameOfChange = compareBlockMeans(
        cropToCentredRegion(pinnedFrame),
        cropToCentredRegion(repaintedFrame)
      );

      const captured = await page.evaluate(
        async ([comparisonWidth, comparisonHeight]) =>
          await (window as ParityHarnessWindow).__parityHarness!.captureSceneStillAsPngDataUrl(
            comparisonWidth,
            comparisonHeight
          ),
        [repaintedFrame.width, repaintedFrame.height] as const
      );

      expect(
        captured,
        `${renderer} captured nothing. On the node path that means the offscreen render or its readback failed;` +
          " on the classic path it means the canvas stopped preserving its drawing buffer."
      ).not.toBeNull();

      // THE CAPTURED STILL, WRITTEN OUT, because a mean block difference does
      // not say WHAT is wrong — and the three ways this can fail (flipped,
      // sheared, no tone curve) are all instantly obvious in a picture and all
      // invisible in a number. Same reason `node-path-diagnostic.spec.ts` keeps
      // its shots, and one file per leg to match it: the frame on SCREEN is
      // what that spec already photographs, so keeping a second copy of it here
      // would double 19 MB of committed PNGs to say the same thing twice.
      const capturedPng = pngBufferFromDataUrl(captured!.dataUrl);
      mkdirSync(SHOT_DIRECTORY, { recursive: true });
      writeFileSync(`${SHOT_DIRECTORY}/${fixture.name}-${renderer}.png`, capturedPng);

      const capturedFrame = inflatePng(capturedPng, inflateSync);
      const comparison = compareBlockMeans(cropToCentredRegion(repaintedFrame), cropToCentredRegion(capturedFrame));
      const capturedDeviation = luminanceStandardDeviation(capturedFrame);
      const shownDeviation = luminanceStandardDeviation(repaintedFrame);

      const allowedMean = Math.max(
        ONE_FRAME_BUDGET_FLOOR.meanBlockDifference,
        oneFrameOfChange.meanBlockDifference * ONE_FRAME_BUDGET_HEADROOM
      );
      const allowedWorst = Math.max(
        ONE_FRAME_BUDGET_FLOOR.worstBlockDifference,
        oneFrameOfChange.worstBlockDifference * ONE_FRAME_BUDGET_HEADROOM
      );

      console.log(
        `${fixture.name} · ${renderer} (${backend})\n` +
          `    route               ${captured!.capturedFromRenderTarget ? "offscreen render target" : "live canvas"}\n` +
          `    captured at         ${captured!.nativeWidth}x${captured!.nativeHeight}` +
          `, compared at ${repaintedFrame.width}x${repaintedFrame.height}\n` +
          `    structure           shown ${shownDeviation.toFixed(2)}, captured ${capturedDeviation.toFixed(2)}\n` +
          `    frame drew          canvas ${canvasCounts.drawCalls} calls / ${canvasCounts.triangles} triangles` +
          ` · capture ${captured!.captureCounts.drawCalls} / ${captured!.captureCounts.triangles}\n` +
          `    one frame costs     ${describeBlockComparison(oneFrameOfChange)}\n` +
          `    the still costs     ${describeBlockComparison(comparison)}` +
          `  (allowed ${allowedMean.toFixed(2)} / ${allowedWorst.toFixed(2)})`
      );

      // WHICH ROUTE ANSWERED IS PART OF THE CLAIM. A node leg that quietly fell
      // back to scraping the canvas would produce a blank still, and a classic
      // leg that went through a render target would mean the bridge mounted
      // where it must not.
      expect(
        captured!.capturedFromRenderTarget,
        "the node path must capture through the offscreen render target, and the classic path must not"
      ).toBe(renderer !== "webgl");

      expect(
        capturedDeviation,
        "the captured still has no structure in it — this is the blank rectangle the whole stage exists to stop"
      ).toBeGreaterThan(BLANK_FRAME_LUMINANCE_DEVIATION);

      // The frame on screen is only worth a file when the two disagree, and
      // then it is the only way to see WHICH of them is wrong.
      if (comparison.meanBlockDifference >= allowedMean || comparison.worstBlockDifference >= allowedWorst) {
        writeFileSync(`${SHOT_DIRECTORY}/${fixture.name}-${renderer}-shown.png`, repaintedScreenshot);
      }

      expect(
        comparison.meanBlockDifference,
        `the still is further from the canvas than one frame of this world's own motion.` +
          ` One frame costs ${oneFrameOfChange.meanBlockDifference.toFixed(2)};` +
          ` the still costs ${describeBlockComparison(comparison)}`
      ).toBeLessThan(allowedMean);

      expect(
        comparison.worstBlockDifference,
        "one region of the still is nothing like the screen. A flipped or sheared readback lands here first." +
          ` One frame's worst block is ${oneFrameOfChange.worstBlockDifference.toFixed(2)};` +
          ` the still's is ${comparison.worstBlockDifference.toFixed(2)}`
      ).toBeLessThan(allowedWorst);
    });
  }
}
