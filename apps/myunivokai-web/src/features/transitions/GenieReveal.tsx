"use client";

import { useEffect, useRef, type RefObject } from "react";
import { REDUCED_MOTION_MEDIA_QUERY } from "@/lib/formRailCollapse";
import { drawGenieSheet, genieRowCount } from "./genieSheet";
import { GENIE_DURATION_MILLISECONDS, isGenieWorthPlaying, type GenieRectangle } from "./genieWarp";
import { captureSceneStill } from "./sceneStill";

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
 *
 * The warp itself lives in `genieSheet.ts`, shared with the world change that
 * collapses one world into a slot and unfolds the next one back out of it. A
 * card opening into a world and a world arriving from off screen are the same
 * gesture seen twice, and they should never be able to drift apart.
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
    if (!overlayCanvas || !sceneContainer) {
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

    // Null when the canvas handed back a blank buffer — a route that forgot
    // `preserveDrawingBuffer`. Unfolding a transparent rectangle over the scene
    // would read as a flash of nothing rather than as a missing effect.
    const snapshot = captureSceneStill(sceneContainer);
    const overlayContext = overlayCanvas.getContext("2d");
    if (!snapshot || !overlayContext) {
      finish();
      return;
    }

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    overlayCanvas.width = Math.max(1, Math.round(viewportWidth * pixelRatio));
    overlayCanvas.height = Math.max(1, Math.round(viewportHeight * pixelRatio));

    const rowCount = genieRowCount(destination.height);
    // Bound before the frame callback closes over them: TypeScript loses the
    // narrowing on `origin`, on the snapshot and on the context across a nested
    // function declaration, which it has to assume could be called before the
    // checks above ran.
    const from = origin;
    const context = overlayContext;
    const sheetSource = snapshot;
    let animationFrame = 0;
    let startTimestamp = 0;

    function drawFrame(timestamp: number) {
      if (startTimestamp === 0) {
        startTimestamp = timestamp;
      }
      const progress = Math.min(1, (timestamp - startTimestamp) / GENIE_DURATION_MILLISECONDS);

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewportWidth, viewportHeight);
      drawGenieSheet(context, {
        source: sheetSource,
        sourceWidth: sheetSource.width,
        sourceHeight: sheetSource.height,
        from,
        to: destination,
        progress,
        rowCount
      });

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
