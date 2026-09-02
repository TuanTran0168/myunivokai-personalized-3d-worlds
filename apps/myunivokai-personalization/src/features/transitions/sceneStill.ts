/**
 * Reads the last drawn frame out of a scene container's canvas.
 *
 * Every transition in this folder warps a PICTURE of the scene rather than the
 * scene itself, and this is where that picture comes from. The gallery reveal
 * takes one of the world it is about to unfold; a world change takes one of the
 * world being left, one statement before the state update that replaces it, and
 * another of the world arriving once it has drawn its first frame.
 *
 * Returns null rather than a blank rectangle when there is nothing to read. A
 * WebGL canvas hands back a cleared buffer unless it was created with
 * `preserveDrawingBuffer`; every route that plays a transition sets it, but a
 * future one might not, and warping a transparent rectangle across the screen
 * reads as a flash of nothing rather than as a missing effect. A null is the
 * caller's cue to cut instead — which is what every one of these changes used
 * to do anyway.
 */
export function captureSceneStill(sceneContainer: HTMLDivElement | null): HTMLCanvasElement | null {
  const sceneCanvas = sceneContainer?.querySelector("canvas");
  if (!sceneContainer || !sceneCanvas) {
    return null;
  }
  const containerBox = sceneContainer.getBoundingClientRect();
  if (containerBox.width < 1 || containerBox.height < 1) {
    return null;
  }
  // Capped at 2: past that the still costs memory and fill rate for detail
  // nobody resolves inside a 620 ms warp.
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const still = document.createElement("canvas");
  still.width = Math.max(1, Math.round(containerBox.width * pixelRatio));
  still.height = Math.max(1, Math.round(containerBox.height * pixelRatio));
  const stillContext = still.getContext("2d");
  if (!stillContext) {
    return null;
  }
  stillContext.drawImage(sceneCanvas, 0, 0, still.width, still.height);
  const centreSample = stillContext.getImageData(
    Math.floor(still.width / 2),
    Math.floor(still.height / 2),
    1,
    1
  ).data;
  if (centreSample[3] === 0) {
    return null;
  }
  return still;
}
