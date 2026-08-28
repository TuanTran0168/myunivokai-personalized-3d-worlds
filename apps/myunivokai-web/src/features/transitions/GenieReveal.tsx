"use client";

import { useEffect, useRef, type RefObject } from "react";
import { REDUCED_MOTION_MEDIA_QUERY } from "@/lib/formRailCollapse";
import {
  GENIE_DURATION_MILLISECONDS,
  GENIE_MINIMUM_ROW_WIDTH,
  genieGlowAlpha,
  genieRowAt,
  genieRowHeight,
  isGenieWorthPlaying,
  type GenieRectangle,
  type GenieRow
} from "./genieWarp";

/**
 * More rows than this and the per-frame `drawImage` count costs more than the
 * effect is worth. Against a 700-pixel-tall canvas this draws every other row,
 * which is invisible across 620 ms and halves the work.
 */
const GENIE_MAXIMUM_ROWS = 420;

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
 * being drawn out of the card, and so the one the eye is following.
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

type GenieRevealProps = {
  /** The rectangle to unfold from, or null for no reveal at all. */
  origin: GenieRectangle | null;
  /** The element whose <canvas> is snapshotted, and whose box is the destination. */
  sceneContainerReference: RefObject<HTMLDivElement | null>;
  /**
   * Called exactly once per reveal, whether it played, was declined for reduced
   * motion or found nothing to snapshot. The caller uses it to un-hide the live
   * canvas and release the opening camera move, so a path that never calls back
   * is a scene that never appears.
   */
  onFinished: () => void;
};

/**
 * Unfolds the scene's first frame out of the rectangle the visitor clicked.
 *
 * Draws onto a fixed, pointer-transparent canvas over the whole viewport: the
 * origin rectangle is in viewport coordinates and the destination is the scene
 * container's box, and only a viewport-sized surface holds both without the
 * page's own scrolling and stacking contexts getting a say.
 *
 * The handoff at the end is a hard swap, not a crossfade, and deliberately so.
 * The final frame of the warp places every row exactly on the destination box,
 * and the live canvas it hands to is showing the same camera — the opening move
 * is held at its first pose for as long as this runs. Two identical images do
 * not need dissolving between; crossfading them would only add a dip.
 */
export function GenieReveal({ origin, sceneContainerReference, onFinished }: GenieRevealProps) {
  const overlayCanvasReference = useRef<HTMLCanvasElement>(null);
  // Held in a ref so the effect below never re-runs just because the parent
  // handed it a new closure: a reveal restarted mid-flight would snapshot a
  // frame the warp had already moved past.
  const onFinishedReference = useRef(onFinished);
  onFinishedReference.current = onFinished;

  useEffect(() => {
    function finish() {
      onFinishedReference.current();
    }
    if (!origin) {
      return;
    }
    const overlayCanvas = overlayCanvasReference.current;
    const sceneContainer = sceneContainerReference.current;
    const sceneCanvas = sceneContainer?.querySelector("canvas") ?? null;
    if (!overlayCanvas || !sceneContainer || !sceneCanvas) {
      finish();
      return;
    }
    if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      finish();
      return;
    }

    const containerBox = sceneContainer.getBoundingClientRect();
    const destination: GenieRectangle = {
      left: containerBox.left,
      top: containerBox.top,
      width: containerBox.width,
      height: containerBox.height
    };
    if (!isGenieWorthPlaying(origin, destination)) {
      finish();
      return;
    }

    // Capped at 2: past that the snapshot costs memory and fill rate for
    // detail nobody resolves inside a 620 ms warp.
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const snapshot = document.createElement("canvas");
    snapshot.width = Math.max(1, Math.round(destination.width * pixelRatio));
    snapshot.height = Math.max(1, Math.round(destination.height * pixelRatio));
    const snapshotContext = snapshot.getContext("2d");
    const overlayContext = overlayCanvas.getContext("2d");
    if (!snapshotContext || !overlayContext) {
      finish();
      return;
    }
    snapshotContext.drawImage(sceneCanvas, 0, 0, snapshot.width, snapshot.height);

    // A WebGL canvas hands back a blank buffer unless it was created with
    // preserveDrawingBuffer. Every route that opens a genie sets it, but a
    // future one might not, and unfolding a transparent rectangle over the
    // scene would read as a flash of nothing rather than as a missing effect.
    const centreSample = snapshotContext.getImageData(
      Math.floor(snapshot.width / 2),
      Math.floor(snapshot.height / 2),
      1,
      1
    ).data;
    if (centreSample[3] === 0) {
      finish();
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    overlayCanvas.width = Math.max(1, Math.round(viewportWidth * pixelRatio));
    overlayCanvas.height = Math.max(1, Math.round(viewportHeight * pixelRatio));

    const rowCount = Math.max(1, Math.min(GENIE_MAXIMUM_ROWS, Math.round(destination.height)));
    const sourceRowHeight = snapshot.height / rowCount;
    // Bound before the frame callback closes over them: TypeScript loses the
    // narrowing on `origin` and on the context across a nested function.
    const from = origin;
    const context = overlayContext;
    let animationFrame = 0;
    let startTimestamp = 0;

    function drawFrame(timestamp: number) {
      if (startTimestamp === 0) {
        startTimestamp = timestamp;
      }
      const progress = Math.min(1, (timestamp - startTimestamp) / GENIE_DURATION_MILLISECONDS);

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewportWidth, viewportHeight);

      let nextRow = genieRowAt(0, progress, from, destination);
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const row = nextRow;
        nextRow = genieRowAt((rowIndex + 1) / rowCount, progress, from, destination);
        if (row.width < GENIE_MINIMUM_ROW_WIDTH) {
          continue;
        }
        context.drawImage(
          snapshot,
          0,
          rowIndex * sourceRowHeight,
          snapshot.width,
          sourceRowHeight,
          row.left,
          row.top,
          row.width,
          genieRowHeight(row.top, nextRow.top)
        );
      }

      // `nextRow` has walked past the last row and now holds rowRatio 1 — the
      // bottom edge of the sheet, which is exactly where the light goes.
      drawTrailingEdgeGlow(context, nextRow, genieGlowAlpha(progress));

      if (progress >= 1) {
        finish();
        return;
      }
      animationFrame = requestAnimationFrame(drawFrame);
    }

    animationFrame = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animationFrame);
  }, [origin, sceneContainerReference]);

  if (!origin) {
    return null;
  }
  return (
    <canvas
      ref={overlayCanvasReference}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
