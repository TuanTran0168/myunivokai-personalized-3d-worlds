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
 * Downloads the WebGL canvas inside the given container as a PNG file.
 * Requires the canvas to be created with preserveDrawingBuffer: true,
 * otherwise the buffer may already be cleared when toDataURL runs.
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
