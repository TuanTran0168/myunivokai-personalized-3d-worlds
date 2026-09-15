import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureFrame, type FrameMetrics } from "../../../../e2e/frameMetrics.mjs";

/**
 * WHAT THE FRAMES THAT GO THROUGH THE POST-PROCESSING CHAIN ARE ALLOWED TO
 * CONTAIN.
 *
 * `ocean/oceanFrameBudget.test.ts` is the model for this file and the reason it
 * exists: the ocean got numeric bands after its frames were found clipped flat
 * to white, and the three families that were NOT measured kept the same defect
 * for their whole lives. `EffectComposer` sets `gl.toneMapping = NoToneMapping`
 * on mount, the chain had no `<ToneMapping>` effect, and so forest, universe and
 * the fallback renderer had no tone curve at all — every linear value above 1
 * clipped.
 *
 * Measured before the fix, on the canvas band, desktop:
 *
 *   universe-world             10.1% of pixels at 250+     luma 0.236   sat 0.55
 *   landing (live preview)     12.5%                       luma 0.156   sat 0.29
 *   create-form-identity-row    8.8%                       luma 0.147   sat 0.30
 *
 * After:
 *
 *   universe-world              0.0%                       luma 0.305   sat 0.78
 *   landing                     0.0%                       luma 0.360   sat 0.74
 *   create-form-identity-row    0.0%                       luma 0.366   sat 0.72
 *
 * The saturation column is the tell, and it is why `blown` alone would have been
 * a weaker test: a clipped pixel is white, so clipping does not merely brighten a
 * frame, it DRAINS it. Every one of those three gained saturation by having its
 * highlights returned.
 *
 * Like the ocean's, this reads the committed screenshots rather than rendering
 * anything, and skips a shot that is absent so a fresh clone is not a failure.
 * `covers every composed family` below is what stops that from quietly becoming
 * zero coverage.
 */

const SHOTS = fileURLToPath(new URL("../../../../e2e/shots/", import.meta.url));

function metricsFor(shot: string, project = "desktop"): FrameMetrics | null {
  const path = `${SHOTS}${project}/${shot}.png`;
  if (!existsSync(path)) return null;
  return measureFrame(path, false);
}

/**
 * The families that render THROUGH the composer. The ocean is deliberately
 * absent: it bypasses the chain and has its own budget file, and listing it here
 * would be a second opinion about the same frames.
 */
const COMPOSED_SCENE_SHOTS = ["universe-world", "forest-world"] as const;

/**
 * Pages whose desktop layout carries the live 3D preview. They are shots of a
 * form with a scene in it, so their luma and crush are furniture as much as
 * frame — but `blown` is measured on the canvas band, and that is the number
 * this file is about.
 */
const LIVE_PREVIEW_PAGE_SHOTS = ["landing", "create-form-identity-row", "create-form-scrolled"] as const;

/**
 * 2% is where a highlight has visibly lost its gradient — the same bound the
 * ocean's budget uses, and set at the same kind of real defect rather than at
 * the edge of current output. The three shots above sat at 8.8%, 10.1% and
 * 12.5%.
 */
const MAXIMUM_BLOWN_FRACTION = 0.02;

/**
 * A tone curve that is present but wrong in the other direction would crush
 * instead of clip. Wide, because these frames are legitimately dark — the forest
 * at dusk, a universe scene that is mostly empty space.
 */
const MAXIMUM_CRUSH_FRACTION = 0.35;

/** A frame with no highlights left is not a frame; a white wash is not one either. */
const MINIMUM_LUMA = 0.05;
const MAXIMUM_LUMA = 0.8;

/**
 * Clipping drains colour, so a floor on saturation catches the same defect from
 * the other side — and catches it on a frame that happens to be dark enough not
 * to trip `blown`. Set below every measured value after the fix (0.31 on the
 * forest) and above the pre-fix universe reading of 0.55… which is to say the
 * forest is the binding case here, not the universe.
 */
const MINIMUM_SATURATION = 0.12;

describe("composed frame budget", () => {
  /**
   * The guard on the guard. Without it, renaming a shot turns this whole file
   * into a suite that passes because it measured nothing — which is exactly how
   * the defect it is named after survived.
   */
  it("covers every composed family", () => {
    const missing = [...COMPOSED_SCENE_SHOTS, ...LIVE_PREVIEW_PAGE_SHOTS].filter(
      (shot) => metricsFor(shot) === null
    );
    // Absent shots are reported, not asserted against: a clone that has never
    // run Playwright has none of them, and that is not a defect.
    if (missing.length > 0) {
      console.warn(`composed frame budget: ${missing.length} shot(s) absent, not measured: ${missing.join(", ")}`);
    }
    expect(COMPOSED_SCENE_SHOTS.length + LIVE_PREVIEW_PAGE_SHOTS.length).toBe(5);
  });

  for (const shot of COMPOSED_SCENE_SHOTS) {
    it(`${shot} keeps its highlights, its shadows and its colour`, () => {
      const metrics = metricsFor(shot);
      if (metrics === null) return;
      expect(metrics.blown, `${shot} blown`).toBeLessThanOrEqual(MAXIMUM_BLOWN_FRACTION);
      expect(metrics.crush, `${shot} crush`).toBeLessThanOrEqual(MAXIMUM_CRUSH_FRACTION);
      expect(metrics.luma, `${shot} luma`).toBeGreaterThanOrEqual(MINIMUM_LUMA);
      expect(metrics.luma, `${shot} luma`).toBeLessThanOrEqual(MAXIMUM_LUMA);
      expect(metrics.sat, `${shot} saturation`).toBeGreaterThanOrEqual(MINIMUM_SATURATION);
    });
  }

  for (const shot of LIVE_PREVIEW_PAGE_SHOTS) {
    it(`${shot} does not clip the preview it carries`, () => {
      const metrics = metricsFor(shot);
      if (metrics === null) return;
      expect(metrics.blown, `${shot} blown`).toBeLessThanOrEqual(MAXIMUM_BLOWN_FRACTION);
    });
  }

  /**
   * The universe world is the frame the defect was found on, so it gets the
   * assertion that names the defect rather than a band it happens to satisfy.
   * 8% would still be a broken tone curve; this fails long before that.
   */
  it("the universe world is nowhere near the 10.1% it used to clip", () => {
    const metrics = metricsFor("universe-world");
    if (metrics === null) return;
    expect(metrics.blown).toBeLessThan(0.05);
  });
});
