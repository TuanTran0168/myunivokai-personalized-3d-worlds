import {
  sceneStillSource,
  stillBytesHoldAPicture,
  type SceneStillPicture
} from "@/features/scene-renderers/shared/sceneStillCapture";

/**
 * A picture of the scene as it looks right now, however this renderer can give
 * one.
 *
 * Every transition in this folder warps a PICTURE of the scene rather than the
 * scene itself, and this is where that picture comes from. The gallery reveal
 * takes one of the world it is about to unfold; a world change takes one of the
 * world being left, one statement before the state update that replaces it, and
 * another of the world arriving once it has drawn its first frame. The download
 * button takes one too, at the renderer's own resolution rather than the warp's.
 *
 * # TWO ROUTES, BECAUSE THE TWO RENDERERS DO NOT AGREE ON WHAT A CANVAS HOLDS
 *
 * `WebGLRenderer` + `preserveDrawingBuffer` still holds its last frame after it
 * has been presented, so the canvas is drawn straight into a 2D context — the
 * route this file has always taken, unchanged, and the one every visitor is on
 * while the rollout flag is off.
 *
 * The node renderer's canvas reads back EMPTY on both of its backends, because
 * `preserveDrawingBuffer` does not exist on `WebGPURendererParameters`. There
 * `SceneStillBridge` registers a source that draws one more frame into an
 * offscreen render target and reads that back instead. Which route is taken is
 * decided by which renderer mounted, not by trying one and falling back: a
 * source is registered only by the path that needs one.
 *
 * # WHY IT IS ASYNCHRONOUS NOW
 *
 * `Renderer.readRenderTargetPixelsAsync` is the only readback the node renderer
 * has — there is no synchronous twin anywhere in `three.webgpu.js`
 * (`:62244` is the whole of it). So the capture became a promise, and the call
 * sites that were synchronous for written-down reasons each had to keep their
 * ordering across an `await`. Each one says how, where it is.
 *
 * Returns null rather than a blank rectangle when there is nothing to read.
 * Warping a transparent rectangle across the screen reads as a flash of nothing
 * rather than as a missing effect, and a null is the caller's cue to cut
 * instead — which is what every one of these changes used to do anyway.
 */

/**
 * Capped at 2: past that the still costs memory and fill rate for detail nobody
 * resolves inside a 620 ms warp. **The download does not use this cap** — see
 * `captureSceneStillAtNativeResolution`.
 */
const MAXIMUM_WARPED_STILL_PIXEL_RATIO = 2;

/**
 * How coarsely the live canvas is sampled to decide whether it read back at all.
 *
 * A blank readback is blank everywhere, so a 16x16 grid answers the question
 * for the cost of one tiny `drawImage` — against a full-resolution
 * `getImageData` on a 4K canvas, which would allocate 33 MB to look at pixels
 * that are all the same. This is the number `lib/exportImage.ts` used for the
 * same question before the capture moved here.
 */
const BLANK_PROBE_GRID_SIZE = 16;

function scaledStillCanvasFor(sceneContainer: HTMLElement): HTMLCanvasElement | null {
  const containerBox = sceneContainer.getBoundingClientRect();
  if (containerBox.width < 1 || containerBox.height < 1) {
    return null;
  }
  const pixelRatio = Math.min(MAXIMUM_WARPED_STILL_PIXEL_RATIO, window.devicePixelRatio || 1);
  const still = document.createElement("canvas");
  still.width = Math.max(1, Math.round(containerBox.width * pixelRatio));
  still.height = Math.max(1, Math.round(containerBox.height * pixelRatio));
  return still;
}

/**
 * The captured pixels on a canvas of their own, at their own resolution.
 *
 * `putImageData` ignores any transform — it writes pixel for pixel — so a
 * readback can only land on a canvas its own size, and anything that wants a
 * different size draws THIS canvas scaled.
 */
function canvasFromCapturedPicture(picture: SceneStillPicture): HTMLCanvasElement | null {
  const captured = document.createElement("canvas");
  captured.width = picture.pixelWidth;
  captured.height = picture.pixelHeight;
  const capturedContext = captured.getContext("2d");
  if (!capturedContext) {
    return null;
  }
  capturedContext.putImageData(new ImageData(picture.bytes, picture.pixelWidth, picture.pixelHeight), 0, 0);
  return captured;
}

function scaledStillFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  sceneContainer: HTMLElement
): HTMLCanvasElement | null {
  const still = scaledStillCanvasFor(sceneContainer);
  const stillContext = still?.getContext("2d");
  if (!still || !stillContext) {
    return null;
  }
  stillContext.drawImage(sourceCanvas, 0, 0, still.width, still.height);
  return still;
}

/**
 * Whether the live canvas still holds an image, on the route that reads it.
 *
 * **NOT DEFENSIVE PROGRAMMING, A MEASURED CASE.** Every route that plays a
 * transition or offers the download sets `preserveDrawingBuffer`, and a future
 * one might not; without it a WebGL canvas hands back a cleared buffer. The
 * node path does not come through here at all — it has a source registered, and
 * `stillBytesHoldAPicture` asks the same question of the readback.
 */
function liveCanvasHoldsAPicture(sceneCanvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = BLANK_PROBE_GRID_SIZE;
  probe.height = BLANK_PROBE_GRID_SIZE;
  const probeContext = probe.getContext("2d");
  if (!probeContext) {
    // No 2D context to check with. Not being able to ask is not an answer, so
    // the capture goes ahead rather than being refused on a guess.
    return true;
  }
  probeContext.drawImage(sceneCanvas, 0, 0, BLANK_PROBE_GRID_SIZE, BLANK_PROBE_GRID_SIZE);
  const pixels = probeContext.getImageData(0, 0, BLANK_PROBE_GRID_SIZE, BLANK_PROBE_GRID_SIZE).data;
  return stillBytesHoldAPicture(pixels);
}

/** A still the size of the container's box, for a warp to carry. */
export async function captureSceneStill(sceneContainer: HTMLElement | null): Promise<HTMLCanvasElement | null> {
  if (!sceneContainer) {
    return null;
  }
  const captureFromRenderTarget = sceneStillSource();
  if (captureFromRenderTarget) {
    const picture = await captureFromRenderTarget();
    const captured = picture ? canvasFromCapturedPicture(picture) : null;
    return captured ? scaledStillFromCanvas(captured, sceneContainer) : null;
  }
  const sceneCanvas = sceneContainer.querySelector("canvas");
  if (!sceneCanvas || !liveCanvasHoldsAPicture(sceneCanvas)) {
    return null;
  }
  return scaledStillFromCanvas(sceneCanvas, sceneContainer);
}

/**
 * A still at the renderer's own resolution, for the download.
 *
 * Deliberately NOT the warp's capped ratio: a file a visitor keeps is worth
 * every pixel the frame had, and on a display above 2x the cap would throw some
 * of them away. On the classic path this is the live canvas itself, which is
 * exactly what `toDataURL` used to be called on.
 */
export async function captureSceneStillAtNativeResolution(
  sceneContainer: HTMLElement | null
): Promise<HTMLCanvasElement | null> {
  if (!sceneContainer) {
    return null;
  }
  const captureFromRenderTarget = sceneStillSource();
  if (captureFromRenderTarget) {
    const picture = await captureFromRenderTarget();
    return picture ? canvasFromCapturedPicture(picture) : null;
  }
  const sceneCanvas = sceneContainer.querySelector("canvas");
  if (!sceneCanvas || !liveCanvasHoldsAPicture(sceneCanvas)) {
    return null;
  }
  return sceneCanvas;
}
