import { captureSceneStillAtNativeResolution } from "@/features/transitions/sceneStill";

const EXPORTED_IMAGE_MIME_TYPE = "image/png";
const EXPORTED_FILE_NAME_MAXIMUM_LENGTH = 60;

function sanitizeFileName(rawFileName: string): string {
  const sanitized = rawFileName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, EXPORTED_FILE_NAME_MAXIMUM_LENGTH);
  return sanitized || "myunivokai-universe";
}

/**
 * Downloads the 3D scene as a PNG file, on whichever renderer drew it.
 *
 * **THIS USED TO REFUSE ON THE NODE RENDERER AND NO LONGER HAS TO.** §26 Phase 9
 * measured the readback on all three renderers, same fixture, same machine:
 *
 *     WebGLRenderer                256/256 samples carry alpha
 *     WebGPURenderer / WebGPU        0/256
 *     WebGPURenderer / WebGL2        0/256
 *
 * The cause is one line that does not exist — `preserveDrawingBuffer` appears
 * twice in `three.module.js` and zero times in `three.webgpu.js` — so this file
 * carried a guard that detected a blank canvas and returned false rather than
 * downloading a transparent rectangle and reporting success. That guard was the
 * right thing to ship and the wrong thing to keep: it made the download button
 * dead on a fifth of the renderers the rollout will produce.
 *
 * Stage 0 of the graphics upgrade roadmap replaces it. `captureSceneStill*`
 * asks whatever renderer is mounted for a picture — the live canvas on the
 * classic path, one extra frame drawn into an offscreen render target on the
 * node path — and returns null when there is genuinely nothing. A null still
 * means the same failed-export message the guard used to produce, so the caller
 * did not change.
 *
 * At the renderer's NATIVE resolution rather than the warp's capped one: a file
 * a visitor keeps is worth every pixel the frame had.
 */
export async function exportSceneCanvasAsPng(
  containerElement: HTMLElement | null,
  fileName: string
): Promise<boolean> {
  try {
    const still = await captureSceneStillAtNativeResolution(containerElement);
    if (!still) {
      return false;
    }
    const imageDataUrl = still.toDataURL(EXPORTED_IMAGE_MIME_TYPE);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = imageDataUrl;
    downloadAnchor.download = `${sanitizeFileName(fileName)}.png`;
    downloadAnchor.click();
    return true;
  } catch {
    return false;
  }
}
