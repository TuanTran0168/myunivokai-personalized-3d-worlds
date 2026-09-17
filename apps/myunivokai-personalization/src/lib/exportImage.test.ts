import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportSceneCanvasAsPng } from "./exportImage";

/**
 * THE DOWNLOAD BUTTON, AND THE CASE §26 PHASE 9 MEASURED.
 *
 * The node renderer cannot be asked to preserve its drawing buffer — the option
 * is absent from `three.webgpu.js` on both backends — so the canvas reads back
 * fully transparent. Without the guard this file exercises, a visitor on the
 * node path would receive a transparent PNG and a success message.
 */

const CANVAS_WIDTH = 64;
const CANVAS_HEIGHT = 48;
const PROBE_GRID_SIZE = 16;
const BYTES_PER_PIXEL = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const OPAQUE_ALPHA = 255;

type FakeCanvas = {
  /** The CONTAINER the export walks, not the canvas — `querySelector` finds that. */
  element: HTMLElement;
  toDataURL: ReturnType<typeof vi.fn>;
};

/**
 * A scene canvas plus the 2D probe canvas the guard creates, wired so the probe
 * reports whatever this test wants the readback to have produced.
 */
function installCanvases(readbackAlpha: number): FakeCanvas {
  const probePixels = new Uint8ClampedArray(PROBE_GRID_SIZE * PROBE_GRID_SIZE * BYTES_PER_PIXEL);
  for (let index = 0; index < probePixels.length; index += BYTES_PER_PIXEL) {
    probePixels[index + ALPHA_CHANNEL_OFFSET] = readbackAlpha;
  }
  const probeContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: probePixels }))
  };

  const toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
  const sceneCanvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    toDataURL
  } as unknown as HTMLCanvasElement;

  const anchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;

  // `vitest.config.ts` runs this suite in the `node` environment — there is no
  // jsdom here and adding one for three assertions would be a dependency for a
  // stub. The guard only ever calls `document.createElement`, so that is what is
  // stubbed.
  vi.stubGlobal("document", {
    createElement: (tagName: string) => {
      if (tagName === "canvas") {
        return { width: 0, height: 0, getContext: () => probeContext } as unknown as HTMLCanvasElement;
      }
      return anchor;
    }
  });

  const container = {
    querySelector: vi.fn(() => sceneCanvas)
  } as unknown as HTMLElement;

  return { element: container, toDataURL };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportSceneCanvasAsPng", () => {
  it("exports when the canvas still holds an image", () => {
    const { element, toDataURL } = installCanvases(OPAQUE_ALPHA);
    expect(exportSceneCanvasAsPng(element, "My World")).toBe(true);
    expect(toDataURL).toHaveBeenCalledWith("image/png");
  });

  /**
   * **THE MEASURED CASE.** A node-renderer canvas reads back 0/256 samples with
   * any alpha. Returning false is what makes the UI say the export failed
   * instead of handing over an empty rectangle.
   */
  it("refuses rather than downloading a transparent rectangle", () => {
    const { element, toDataURL } = installCanvases(0);
    expect(exportSceneCanvasAsPng(element, "My World")).toBe(false);
    expect(toDataURL, "a blank canvas must not even be encoded").not.toHaveBeenCalled();
  });

  it("answers false without a container or a canvas", () => {
    expect(exportSceneCanvasAsPng(null, "My World")).toBe(false);
    const container = { querySelector: () => null } as unknown as HTMLElement;
    expect(exportSceneCanvasAsPng(container, "My World")).toBe(false);
  });
});
