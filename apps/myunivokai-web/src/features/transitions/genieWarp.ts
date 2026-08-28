/**
 * The scanline warp behind the "a card unfolds into a world" reveal.
 *
 * Modelled on the macOS genie minimise, by way of ui-layouts.com/components
 * /mac-genie, whose technique this reproduces: rasterise the thing being moved
 * once, then each frame redraw it ROW BY ROW, giving every row its own delayed
 * start and its own interpolation between the small rectangle and the large
 * one. Rows that have not had their turn yet are still bunched at the origin
 * while rows ahead of them have already reached their place, and that lag —
 * not any filter or shader — is the entire effect.
 *
 * The reference collapses a window into a dock POINT. This expands a gallery
 * card RECTANGLE into the canvas frame, so the interpolation runs between two
 * rectangles rather than a rectangle and a point; a point is just the
 * degenerate case where the origin has no width.
 *
 * That difference is why this carries three terms the reference does not need.
 * Collapsing into a point gets a funnel for free — the two edges converge on
 * the same coordinate — while a rectangle-to-rectangle interpolation gets none,
 * so the neck (GENIE_NECK_PINCH) and the curved path (GENIE_BOW_STRENGTH) have
 * to be put back by hand. The third, the trailing-edge glow, the reference does
 * have, and it is worth having for the same reason it is there.
 *
 * Everything here is pure geometry. The canvas work lives in GenieReveal.
 */

import { clampUnitInterval, easeInOutCubic, easeInQuad, lerp, staggeredProgress } from "@/lib/easing";

export type GenieRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GenieRow = {
  left: number;
  width: number;
  top: number;
};

/**
 * Long enough to read as an unfolding rather than a wipe, short enough that it
 * never becomes the thing standing between the visitor and their world.
 */
export const GENIE_DURATION_MILLISECONDS = 620;

/**
 * The share of the run the LAST row waits before it starts opening sideways.
 * This is the dial that decides how much the sheet stretches: at 0 every row
 * opens together and the effect is a plain scale, and near 1 the tail rows only
 * begin as the run ends and the sheet tears. 0.55 was picked against the
 * reference's 0.65 for a shorter run.
 */
export const GENIE_HORIZONTAL_STAGGER = 0.65;

/** The same idea vertically, and deliberately much smaller: rows have to reach
 * their final height early or the frame ends up top-heavy for most of the run. */
export const GENIE_VERTICAL_STAGGER = 0.2;

/**
 * How much a row narrows at the midpoint of its own travel, as a fraction of
 * the width a straight interpolation would have given it.
 *
 * This is the NECK. Interpolating each row's two edges on their own produces a
 * sheet that only ever widens, and a sheet that only widens is a zoom with a
 * stagger on it. What the macOS effect actually shows is content being drawn
 * THROUGH something narrower than either end — the waist is what sells the
 * suction. Applied on the row's own travel rather than on the run's progress so
 * the waist travels down the sheet with the unfolding instead of pinching the
 * whole frame at once.
 */
export const GENIE_NECK_PINCH = 0.18;

/**
 * How far the sheet's centreline lags behind the straight path between the two
 * rectangles, as a fraction of the distance between their centres.
 *
 * A card in the right-hand column and a canvas centred in the viewport are not
 * on the same vertical line, and moving between them in a straight line reads
 * as a slide. Letting the centreline bow back toward the card and catch up late
 * turns the same move into a swing — the curved chute the reference's content
 * falls down, adapted to a horizontal offset rather than a vertical one.
 */
export const GENIE_BOW_STRENGTH = 0.14;

/** Peak opacity of the light that rides the trailing edge. */
export const GENIE_GLOW_PEAK_ALPHA = 0.32;

/**
 * How far into its own travel a row is, shaped so it is exactly zero at both
 * ends of that travel.
 *
 * Both the neck and the bow are scaled by this. The explicit endpoint check is
 * not defensive tidiness: `Math.sin(Math.PI)` is 1.22e-16, not 0, and the whole
 * reveal rests on the last frame being pixel-identical to the live canvas it is
 * about to be swapped for. A deformation that is merely almost gone at the end
 * is a deformation.
 */
function rowTravelArc(horizontal: number): number {
  if (horizontal <= 0 || horizontal >= 1) {
    return 0;
  }
  return Math.sin(Math.PI * horizontal);
}

/**
 * Where one row of the rasterised frame belongs at this point in the run.
 *
 * `rowRatio` is the row's position down the source image, 0 at the top edge and
 * 1 at the bottom. Rows nearer the top lead, so the frame unfolds downward out
 * of the card the way a window unfolds out of the dock.
 */
export function genieRowAt(
  rowRatio: number,
  progress: number,
  from: GenieRectangle,
  to: GenieRectangle
): GenieRow {
  const horizontal = easeInOutCubic(staggeredProgress(progress, rowRatio * GENIE_HORIZONTAL_STAGGER));
  // Ease-IN vertically, matching the reference: rows hang near the origin and
  // then travel. Paired with the earlier horizontal opening, that is what makes
  // the sheet appear to be drawn out of the card rather than scaled up from it.
  const vertical = easeInQuad(staggeredProgress(progress, rowRatio * GENIE_VERTICAL_STAGGER));
  const left = lerp(from.left, to.left, horizontal);
  const right = lerp(from.left + from.width, to.left + to.width, horizontal);

  const top = lerp(from.top + rowRatio * from.height, to.top + rowRatio * to.height, vertical);

  const travelArc = rowTravelArc(horizontal);
  if (travelArc === 0) {
    // Standing on one end of its travel or the other. Returned straight from
    // the interpolation rather than through the neck-and-bow arithmetic below,
    // which would reassemble the same edges out of a midpoint and a half-width
    // and hand back a value a few ulps off. Sub-pixel, but the last frame of
    // the reveal has to be bit-identical to the live canvas it is swapped for.
    return { left, width: right - left, top };
  }

  const centreTravel = to.left + to.width / 2 - (from.left + from.width / 2);
  // Negative: the centreline is held BACK toward the origin, so it arrives from
  // behind the straight path rather than overshooting past it.
  const centre = (left + right) / 2 - centreTravel * GENIE_BOW_STRENGTH * travelArc;
  const halfWidth = ((right - left) / 2) * (1 - GENIE_NECK_PINCH * travelArc);

  return { left: centre - halfWidth, width: halfWidth * 2, top };
}

/**
 * Opacity of the light on the sheet's trailing edge at this point in the run.
 *
 * The reference fades a glow in and out across its run, and it is doing real
 * work: the rows in the middle of the effect are a smear of resampled pixels,
 * and a bright edge gives the eye an object to follow through them. Zero at
 * both ends — a glow still burning on the last frame would be the one thing
 * that made the handoff to the live canvas visible.
 */
export function genieGlowAlpha(progress: number): number {
  const clamped = clampUnitInterval(progress);
  if (clamped <= 0 || clamped >= 1) {
    return 0;
  }
  return GENIE_GLOW_PEAK_ALPHA * Math.sin(Math.PI * clamped);
}

/**
 * Rows thinner than this are skipped rather than drawn. Below about a pixel a
 * row contributes nothing but a rounding artefact, and at the very start of an
 * expansion from a narrow card there can be hundreds of them.
 */
export const GENIE_MINIMUM_ROW_WIDTH = 0.8;

/**
 * How tall to draw a row, given where the row after it landed.
 *
 * Rows are positioned independently, so their spacing changes through the run;
 * drawing every row one pixel tall — which is what the source rows are — leaves
 * gaps the moment the spacing opens past 1. Measuring the gap to the next row
 * and filling it is what keeps the sheet solid.
 */
export function genieRowHeight(rowTop: number, nextRowTop: number): number {
  return Math.max(1, nextRowTop - rowTop);
}

/**
 * Is this a run worth playing at all?
 *
 * A card rectangle that is already the size of the destination, or one that
 * arrived empty, produces a "warp" that is either invisible or a division by
 * zero waiting to happen. Both are better handled by not starting.
 */
export function isGenieWorthPlaying(from: GenieRectangle, to: GenieRectangle): boolean {
  if (!(from.width > 0) || !(from.height > 0) || !(to.width > 0) || !(to.height > 0)) {
    return false;
  }
  const widthRatio = from.width / to.width;
  const heightRatio = from.height / to.height;
  return widthRatio < 0.9 || heightRatio < 0.9;
}
