import { describe, expect, it } from "vitest";
import { easeInOutCubic, lerp, staggeredProgress } from "@/lib/easing";
import {
  GENIE_GLOW_PEAK_ALPHA,
  GENIE_HORIZONTAL_STAGGER,
  genieGlowAlpha,
  genieRowAt,
  genieRowHeight,
  isGenieWorthPlaying,
  type GenieRectangle
} from "./genieWarp";

const CARD: GenieRectangle = { left: 120, top: 380, width: 300, height: 210 };
const FRAME: GenieRectangle = { left: 0, top: 56, width: 1280, height: 700 };

// A row and a moment chosen to sit near the peak of that row's own travel arc,
// which is where the neck and the bow are deepest and therefore where they can
// actually be measured.
const NECK_SAMPLE_ROW = 0.2;
const NECK_SAMPLE_PROGRESS = 0.4;

/**
 * The row genieRowAt would have produced with neither neck nor bow: the two
 * edges interpolated on their own, which is all the reference technique does.
 *
 * Reimplemented here rather than exported from the module, deliberately. The
 * only claims these tests make with it are DIFFERENCES — this much narrower,
 * this much further back — and a difference needs the undeformed thing to
 * subtract from. Exporting it would put a shape on the module that nothing in
 * the app has a use for.
 */
function straightRow(rowRatio: number, progress: number): { left: number; width: number } {
  const horizontal = easeInOutCubic(staggeredProgress(progress, rowRatio * GENIE_HORIZONTAL_STAGGER));
  const left = lerp(CARD.left, FRAME.left, horizontal);
  const right = lerp(CARD.left + CARD.width, FRAME.left + FRAME.width, horizontal);
  return { left, width: right - left };
}

describe("genieRowAt", () => {
  it("starts every row inside the card it is unfolding from", () => {
    for (let step = 0; step <= 10; step++) {
      const rowRatio = step / 10;
      const row = genieRowAt(rowRatio, 0, CARD, FRAME);
      expect(row.left).toBeCloseTo(CARD.left, 9);
      expect(row.width).toBeCloseTo(CARD.width, 9);
      expect(row.top).toBeCloseTo(CARD.top + rowRatio * CARD.height, 9);
    }
  });

  it("lands EXACTLY on the destination frame at the end of the run", () => {
    // Load-bearing: the overlay hands the frame back to the live canvas the
    // instant the run ends, and a row that landed a pixel out is a visible
    // jump at precisely the moment the visitor is looking at it.
    for (let step = 0; step <= 10; step++) {
      const rowRatio = step / 10;
      const row = genieRowAt(rowRatio, 1, CARD, FRAME);
      expect(row.left).toBe(FRAME.left);
      expect(row.width).toBe(FRAME.width);
      expect(row.top).toBe(FRAME.top + rowRatio * FRAME.height);
    }
  });

  it("leads with the top rows — the sheet unfolds downward out of the card", () => {
    const midRun = 0.4;
    const topRow = genieRowAt(0, midRun, CARD, FRAME);
    const bottomRow = genieRowAt(1, midRun, CARD, FRAME);
    // "Further along" means wider, since every row ends at the frame's width.
    expect(topRow.width).toBeGreaterThan(bottomRow.width);
  });

  it("never produces a negative width", () => {
    for (let progressStep = 0; progressStep <= 20; progressStep++) {
      for (let rowStep = 0; rowStep <= 20; rowStep++) {
        const row = genieRowAt(rowStep / 20, progressStep / 20, CARD, FRAME);
        expect(row.width).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("still opens a real card into a real frame without ever reversing", () => {
    // The neck below subtracts from the width, so this is worth pinning: over
    // the travel a gallery card actually makes, the opening still dominates the
    // pinch and no frame is narrower than the one before it. A sheet that
    // visibly shrank mid-run would read as a glitch rather than as suction.
    let previousWidth = -1;
    for (let step = 0; step <= 30; step++) {
      const row = genieRowAt(0.5, step / 30, CARD, FRAME);
      expect(row.width).toBeGreaterThanOrEqual(previousWidth - 1e-9);
      previousWidth = row.width;
    }
  });

  it("draws each row through a neck narrower than the straight path", () => {
    // The whole reason the neck exists: interpolating a row's two edges on
    // their own only ever widens it, and a sheet that only widens is a zoom.
    const straight = straightRow(NECK_SAMPLE_ROW, NECK_SAMPLE_PROGRESS);
    const row = genieRowAt(NECK_SAMPLE_ROW, NECK_SAMPLE_PROGRESS, CARD, FRAME);

    // A real bite, not a rounding error's worth — and not so deep the frame
    // stops being legible through it.
    expect(row.width).toBeLessThan(straight.width * 0.99);
    expect(row.width).toBeGreaterThan(straight.width * 0.8);
  });

  it("bows the sheet back toward the card before letting it catch up", () => {
    // A card in the gallery's right-hand column and a canvas centred in the
    // viewport are not on the same vertical line. Travelling between them in a
    // straight line reads as a slide; lagging and catching up reads as a swing.
    const straight = straightRow(NECK_SAMPLE_ROW, NECK_SAMPLE_PROGRESS);
    const row = genieRowAt(NECK_SAMPLE_ROW, NECK_SAMPLE_PROGRESS, CARD, FRAME);
    const rowCentre = row.left + row.width / 2;
    const cardCentre = CARD.left + CARD.width / 2;
    const straightCentre = straight.left + straight.width / 2;

    // The frame's centre is to the RIGHT of the card's here, so lagging means a
    // smaller x. Behind the straight path, and never back past the card itself.
    expect(straightCentre).toBeGreaterThan(cardCentre);
    expect(rowCentre).toBeLessThan(straightCentre);
    expect(rowCentre).toBeGreaterThan(cardCentre);
  });

  it("handles an origin narrower than it is tall without inverting", () => {
    const sliver: GenieRectangle = { left: 900, top: 100, width: 8, height: 400 };
    const row = genieRowAt(0.5, 0.5, sliver, FRAME);
    expect(row.width).toBeGreaterThan(0);
    expect(Number.isFinite(row.top)).toBe(true);
  });

  it("degenerates cleanly to the reference's dock point when the origin has no size", () => {
    const point: GenieRectangle = { left: 640, top: 700, width: 0, height: 0 };
    const row = genieRowAt(0.3, 0, point, FRAME);
    expect(row.width).toBe(0);
    expect(row.top).toBe(point.top);
  });
});

describe("genieGlowAlpha", () => {
  it("is completely dark at both ends of the run", () => {
    // Load-bearing at the far end especially: the overlay is swapped for the
    // live canvas on the last frame, and a glow still burning on it is the one
    // thing that would make the handoff visible.
    expect(genieGlowAlpha(0)).toBe(0);
    expect(genieGlowAlpha(1)).toBe(0);
  });

  it("peaks in the middle, where the rows are most smeared", () => {
    expect(genieGlowAlpha(0.5)).toBeCloseTo(GENIE_GLOW_PEAK_ALPHA, 9);
    expect(genieGlowAlpha(0.25)).toBeGreaterThan(0);
    expect(genieGlowAlpha(0.25)).toBeLessThan(genieGlowAlpha(0.5));
    expect(genieGlowAlpha(0.75)).toBeLessThan(genieGlowAlpha(0.5));
  });

  it("stays subtle — light on the frame, never a wash over it", () => {
    for (let step = 0; step <= 20; step++) {
      const alpha = genieGlowAlpha(step / 20);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(GENIE_GLOW_PEAK_ALPHA);
    }
  });

  it("treats a frame-timing accident as no glow rather than as NaN on the canvas", () => {
    expect(genieGlowAlpha(-0.3)).toBe(0);
    expect(genieGlowAlpha(4)).toBe(0);
    expect(genieGlowAlpha(Number.NaN)).toBe(0);
  });
});

describe("genieRowHeight", () => {
  it("fills the gap to the next row so the sheet stays solid", () => {
    expect(genieRowHeight(100, 103.5)).toBeCloseTo(3.5, 9);
  });

  it("never draws a row thinner than a pixel, however bunched the rows are", () => {
    // At the start of an expansion the whole frame is squeezed into the card,
    // so consecutive rows can land on the same coordinate.
    expect(genieRowHeight(100, 100)).toBe(1);
    expect(genieRowHeight(100, 99.2)).toBe(1);
  });
});

describe("isGenieWorthPlaying", () => {
  it("plays for an ordinary card opening into a full canvas", () => {
    expect(isGenieWorthPlaying(CARD, FRAME)).toBe(true);
  });

  it("declines when the origin is already the size of the destination", () => {
    expect(isGenieWorthPlaying({ ...FRAME }, FRAME)).toBe(false);
  });

  it("declines on an empty or collapsed origin rather than dividing by zero", () => {
    expect(isGenieWorthPlaying({ left: 0, top: 0, width: 0, height: 0 }, FRAME)).toBe(false);
    expect(isGenieWorthPlaying(CARD, { left: 0, top: 0, width: 0, height: 0 })).toBe(false);
  });

  it("still plays when only one axis is meaningfully smaller", () => {
    const wideShort: GenieRectangle = { left: 0, top: 300, width: 1280, height: 90 };
    expect(isGenieWorthPlaying(wideShort, FRAME)).toBe(true);
  });
});
