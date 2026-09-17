const EXPORTED_IMAGE_MIME_TYPE = "image/png";
const EXPORTED_FILE_NAME_MAXIMUM_LENGTH = 60;

/**
 * How coarsely the canvas is sampled to decide whether it read back at all.
 *
 * A blank readback is blank everywhere, so a 16x16 grid answers the question
 * for the cost of one tiny `drawImage` — against a full-resolution
 * `getImageData` on a 4K canvas, which would allocate 33 MB to look at pixels
 * that are all the same.
 */
const BLANK_PROBE_GRID_SIZE = 16;

function sanitizeFileName(rawFileName: string): string {
  const sanitized = rawFileName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, EXPORTED_FILE_NAME_MAXIMUM_LENGTH);
  return sanitized || "myunivokai-universe";
}

/**
 * Whether this canvas still holds an image, asked the way `sceneStill.ts` asks
 * it.
 *
 * **THIS IS NOT DEFENSIVE PROGRAMMING, IT IS A MEASURED CASE.** §26 Phase 9
 * measured the readback on all three renderers, same fixture, same machine:
 *
 *     WebGLRenderer                256/256 samples carry alpha
 *     WebGPURenderer / WebGPU        0/256
 *     WebGPURenderer / WebGL2        0/256
 *
 * The cause is one line that does not exist: `preserveDrawingBuffer` appears
 * twice in `three.module.js` (`:16074` reads it from the parameters, `:16372`
 * hands it to `getContext`) and **zero times in `three.webgpu.js`**.
 * `WebGPURendererParameters` does not declare it, so it cannot be requested on
 * either backend — the WebGL2 one fails for the same reason as the WebGPU one,
 * which is what rules out WebGPU present-time semantics as the explanation.
 *
 * Without this check the download button would hand the visitor a fully
 * transparent PNG and report success. `features/transitions/sceneStill.ts`
 * already fails safe on the same signal — it returns null and the caller cuts
 * instead of warping a transparent rectangle — and this is the site that did
 * not.
 */
function canvasReadsBackBlank(sceneCanvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = BLANK_PROBE_GRID_SIZE;
  probe.height = BLANK_PROBE_GRID_SIZE;
  const probeContext = probe.getContext("2d");
  if (!probeContext) {
    // No 2D context to check with. Not being able to ask is not an answer, so
    // the export goes ahead rather than being refused on a guess.
    return false;
  }
  probeContext.drawImage(sceneCanvas, 0, 0, BLANK_PROBE_GRID_SIZE, BLANK_PROBE_GRID_SIZE);
  const pixels = probeContext.getImageData(0, 0, BLANK_PROBE_GRID_SIZE, BLANK_PROBE_GRID_SIZE).data;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Downloads the 3D canvas inside the given container as a PNG file.
 *
 * Requires the canvas to have been created with `preserveDrawingBuffer: true`,
 * otherwise the buffer may already be cleared when `toDataURL` runs — which is
 * why every route that offers this sets it. **On the node renderer that option
 * does not exist at all**, so the guard above refuses rather than downloading a
 * transparent rectangle. Returning false is what the caller already shows a
 * failed-export message for.
 */
export function exportSceneCanvasAsPng(containerElement: HTMLElement | null, fileName: string): boolean {
  if (!containerElement) {
    return false;
  }
  const sceneCanvas = containerElement.querySelector("canvas");
  if (!sceneCanvas) {
    return false;
  }
  try {
    if (canvasReadsBackBlank(sceneCanvas)) {
      return false;
    }
    const imageDataUrl = sceneCanvas.toDataURL(EXPORTED_IMAGE_MIME_TYPE);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = imageDataUrl;
    downloadAnchor.download = `${sanitizeFileName(fileName)}.png`;
    downloadAnchor.click();
    return true;
  } catch {
    return false;
  }
}
