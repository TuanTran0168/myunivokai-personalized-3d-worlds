/**
 * One frame of a genie warp, drawn onto a 2D context.
 *
 * Extracted when the second consumer appeared, not before. The gallery card's
 * reveal (`GenieReveal`) unfolds a scene OUT of a small rectangle; a world
 * change (`WorldTransition`) collapses one INTO a small rectangle and then
 * unfolds the next one back out of it. Those are the same drawing routine run
 * with the two rectangles swapped, and keeping two copies of it would mean the
 * arrival and the departure drifting apart the first time either was tuned.
 *
 * The geometry itself is in `genieWarp.ts` and stays there — this module is
 * only the canvas work: which rows to draw, how tall to draw them, and the band
 * of light that rides the trailing edge.
 */

import {
  GENIE_MINIMUM_ROW_WIDTH,
  genieGlowAlpha,
  genieRowAt,
  genieRowHeight,
  type GenieRectangle,
  type GenieRow
} from "./genieWarp";

/**
 * More rows than this and the per-frame `drawImage` count costs more than the
 * effect is worth. Against a 700-pixel-tall canvas this draws every other row,
 * which is invisible across 620 ms and halves the work.
 */
export const GENIE_MAXIMUM_ROWS = 420;

/**
 * Half-thickness of the light on the trailing edge, as a fraction of that
 * edge's own width, and the range it is held inside.
 *
 * Tied to the edge's width rather than fixed so it stays in proportion as the
 * sheet opens: a constant band that reads as a rim on a 300-pixel card reads as
 * a stripe across a 1280-pixel frame.
 */
const GENIE_GLOW_HALF_HEIGHT_RATIO = 0.045;
const GENIE_GLOW_MINIMUM_HALF_HEIGHT = 2;
const GENIE_GLOW_MAXIMUM_HALF_HEIGHT = 18;

/** Brass, the accent this product's chrome already lights things with. */
const GENIE_GLOW_CORE_COLOR = "255, 240, 206";
const GENIE_GLOW_EDGE_COLOR = "201, 163, 91";

/**
 * Lays a soft band of light along the sheet's trailing edge — the one still
 * being drawn between the two rectangles, and so the one the eye is following.
 *
 * Composited with `lighter` rather than painted over: the band is light falling
 * on the frame, and an opaque fill there would punch a hole in the very rows it
 * is supposed to be lighting.
 */
function drawTrailingEdgeGlow(
  context: CanvasRenderingContext2D,
  edge: GenieRow,
  alpha: number
): void {
  if (alpha <= 0 || edge.width < GENIE_MINIMUM_ROW_WIDTH) {
    return;
  }
  const halfHeight = Math.min(
    GENIE_GLOW_MAXIMUM_HALF_HEIGHT,
    Math.max(GENIE_GLOW_MINIMUM_HALF_HEIGHT, edge.width * GENIE_GLOW_HALF_HEIGHT_RATIO)
  );
  const gradient = context.createLinearGradient(0, edge.top - halfHeight, 0, edge.top + halfHeight);
  gradient.addColorStop(0, `rgba(${GENIE_GLOW_EDGE_COLOR}, 0)`);
  gradient.addColorStop(0.5, `rgba(${GENIE_GLOW_CORE_COLOR}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${GENIE_GLOW_EDGE_COLOR}, 0)`);

  const previousComposite = context.globalCompositeOperation;
  context.globalCompositeOperation = "lighter";
  context.fillStyle = gradient;
  context.fillRect(edge.left, edge.top - halfHeight, edge.width, halfHeight * 2);
  context.globalCompositeOperation = previousComposite;
}

/**
 * How many source rows a sheet of this height is cut into.
 *
 * Kept as its own function because the caller needs the same number to work out
 * the source row height before the first frame, and a mismatch between the two
 * would sample the snapshot at an offset that grows down the sheet.
 */
export function genieRowCount(destinationHeight: number): number {
  return Math.max(1, Math.min(GENIE_MAXIMUM_ROWS, Math.round(destinationHeight)));
}

export type GenieSheetFrame = {
  /** The already-rasterised image being warped. Never a live WebGL canvas. */
  source: CanvasImageSource;
  /** Its pixel height, used to work out how tall one source row is. */
  sourceHeight: number;
  sourceWidth: number;
  from: GenieRectangle;
  to: GenieRectangle;
  progress: number;
  rowCount: number;
};

/**
 * Draws the sheet at this point in its run. Does NOT clear the context — the
 * caller owns what is underneath, which for a reveal is nothing and for a world
 * change is the arriving world's ground.
 */
export function drawGenieSheet(context: CanvasRenderingContext2D, frame: GenieSheetFrame): void {
  const sourceRowHeight = frame.sourceHeight / frame.rowCount;
  let nextRow = genieRowAt(0, frame.progress, frame.from, frame.to);
  for (let rowIndex = 0; rowIndex < frame.rowCount; rowIndex++) {
    const row = nextRow;
    nextRow = genieRowAt((rowIndex + 1) / frame.rowCount, frame.progress, frame.from, frame.to);
    if (row.width < GENIE_MINIMUM_ROW_WIDTH) {
      continue;
    }
    context.drawImage(
      frame.source,
      0,
      rowIndex * sourceRowHeight,
      frame.sourceWidth,
      sourceRowHeight,
      row.left,
      row.top,
      row.width,
      genieRowHeight(row.top, nextRow.top)
    );
  }

  // `nextRow` has walked past the last row and now holds rowRatio 1 — the
  // bottom edge of the sheet, which is exactly where the light goes.
  drawTrailingEdgeGlow(context, nextRow, genieGlowAlpha(frame.progress));
}
