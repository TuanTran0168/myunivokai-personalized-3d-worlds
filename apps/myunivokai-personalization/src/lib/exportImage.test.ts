import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetSceneStillSource,
  registerSceneStillSource
} from "@/features/scene-renderers/shared/sceneStillCapture";
import { exportSceneCanvasAsPng } from "./exportImage";

/**
 * THE DOWNLOAD BUTTON, ON BOTH ROUTES.
 *
 * This file used to exercise a GUARD: the node renderer cannot be asked to
 * preserve its drawing buffer — the option is absent from `three.webgpu.js` on
 * both backends — so the canvas read back fully transparent, and the export
 * refused rather than handing a visitor an empty PNG with a success message.
 *
 * Stage 0 of the graphics upgrade roadmap replaces that guard with a capture.
 * The classic path still reads the live canvas and still refuses a blank one,
 * which is the first two cases here. The node path registers a source that
 * renders a frame into an offscreen target, which is the third — and the one
 * that used to be impossible.
 */

const CANVAS_WIDTH = 64;
const CANVAS_HEIGHT = 48;
const PROBE_GRID_SIZE = 16;
const BYTES_PER_PIXEL = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const OPAQUE_ALPHA = 255;
const CAPTURED_PICTURE_WIDTH = 8;
const CAPTURED_PICTURE_HEIGHT = 4;

type InstalledCanvases = {
  /** The CONTAINER the export walks, not the canvas — `querySelector` finds that. */
  element: HTMLElement;
  toDataURL: ReturnType<typeof vi.fn>;
  createdCanvasCount: () => number;
};

/**
 * A scene canvas plus the 2D probe canvas the blank check creates, wired so the
 * probe reports whatever this test wants the readback to have produced.
 */
function installCanvases(readbackAlpha: number): InstalledCanvases {
  const probePixels = new Uint8ClampedArray(PROBE_GRID_SIZE * PROBE_GRID_SIZE * BYTES_PER_PIXEL);
  for (let index = 0; index < probePixels.length; index += BYTES_PER_PIXEL) {
    probePixels[index + ALPHA_CHANNEL_OFFSET] = readbackAlpha;
  }
  const probeContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: probePixels })),
    putImageData: vi.fn()
  };

  const toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
  const sceneCanvas = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    toDataURL
  } as unknown as HTMLCanvasElement;

  const anchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;

  let createdCanvases = 0;
  // `vitest.config.ts` runs this suite in the `node` environment — there is no
  // jsdom here and adding one for four assertions would be a dependency for a
  // stub. Only `document.createElement` is ever called, so that is what is
  // stubbed.
  vi.stubGlobal("document", {
    createElement: (tagName: string) => {
      if (tagName === "canvas") {
        createdCanvases += 1;
        return {
          width: 0,
          height: 0,
          getContext: () => probeContext,
          toDataURL
        } as unknown as HTMLCanvasElement;
      }
      return anchor;
    }
  });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number
      ) {}
    }
  );

  const container = {
    querySelector: vi.fn(() => sceneCanvas)
  } as unknown as HTMLElement;

  return { element: container, toDataURL, createdCanvasCount: () => createdCanvases };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetSceneStillSource();
});

afterEach(() => {
  forgetSceneStillSource();
});

describe("exportSceneCanvasAsPng", () => {
  it("exports when the canvas still holds an image", async () => {
    const { element, toDataURL } = installCanvases(OPAQUE_ALPHA);
    await expect(exportSceneCanvasAsPng(element, "My World")).resolves.toBe(true);
    expect(toDataURL).toHaveBeenCalledWith("image/png");
  });

  /**
   * **THE MEASURED CASE, ON THE ROUTE THAT STILL HAS IT.** A canvas whose route
   * forgot `preserveDrawingBuffer` reads back 0/256 samples with any alpha.
   * Returning false is what makes the UI say the export failed instead of
   * handing over an empty rectangle.
   */
  it("refuses rather than downloading a transparent rectangle", async () => {
    const { element, toDataURL } = installCanvases(0);
    await expect(exportSceneCanvasAsPng(element, "My World")).resolves.toBe(false);
    expect(toDataURL, "a blank canvas must not even be encoded").not.toHaveBeenCalled();
  });

  it("answers false without a container or a canvas", async () => {
    await expect(exportSceneCanvasAsPng(null, "My World")).resolves.toBe(false);
    const container = { querySelector: () => null } as unknown as HTMLElement;
    await expect(exportSceneCanvasAsPng(container, "My World")).resolves.toBe(false);
  });

  /**
   * **THE CASE THAT USED TO BE A REFUSAL.** With a source registered — which is
   * what `SceneStillBridge` does on the node path — the export never looks at
   * the live canvas at all, so the empty drawing buffer stops mattering.
   */
  it("exports from a registered capture source without reading the canvas", async () => {
    const { element, toDataURL } = installCanvases(0);
    const capturedBytes = new Uint8ClampedArray(
      CAPTURED_PICTURE_WIDTH * CAPTURED_PICTURE_HEIGHT * BYTES_PER_PIXEL
    );
    capturedBytes.fill(OPAQUE_ALPHA);
    registerSceneStillSource(async () => ({
      bytes: capturedBytes,
      pixelWidth: CAPTURED_PICTURE_WIDTH,
      pixelHeight: CAPTURED_PICTURE_HEIGHT
    }));

    await expect(exportSceneCanvasAsPng(element, "My World")).resolves.toBe(true);
    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(
      (element.querySelector as ReturnType<typeof vi.fn>).mock.calls.length,
      "the live canvas is not consulted when a source is registered"
    ).toBe(0);
  });

  /** A source that finds nothing is the node path's version of a blank canvas. */
  it("refuses when the registered source captures nothing", async () => {
    const { element, toDataURL } = installCanvases(OPAQUE_ALPHA);
    registerSceneStillSource(async () => null);
    await expect(exportSceneCanvasAsPng(element, "My World")).resolves.toBe(false);
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
