import { createContext, useContext } from "react";

/**
 * RENDERING THE PICTURE INSTEAD OF SCRAPING IT.
 *
 * Stage 0 of `agent-system/plans/frontend/webgpu-graphics-upgrade-roadmap.md`.
 * Three features in this app want a bitmap of what the scene looks like right
 * now: the download button, the world-change warp, and the gallery reveal. All
 * three got it by drawing the live `<canvas>` into a 2D context, and that stops
 * working the moment the node renderer draws the frame.
 *
 * **IT IS NOT AN ALPHA PROBLEM AND THE MEASUREMENT SAYS SO.** The diagnostic
 * counts alpha and colour separately since 2026-09-18, and both node backends
 * read back **0 of 256 samples carrying alpha and 0 of 256 carrying colour**,
 * against 256 and 256 on the classic renderer. The buffer is EMPTY, not
 * transparent, because `preserveDrawingBuffer` does not exist on
 * `WebGPURendererParameters` — zero occurrences of the string in
 * `three.webgpu.js` against two in `three.module.js`. The WebGL2 backend fails
 * for the same reason as the WebGPU one, which is what rules out WebGPU
 * present-time semantics: it is the same graphics API as the row that works.
 *
 * So the node path renders one extra frame into an offscreen render target and
 * reads THAT back. `SceneStillBridge` does the rendering; this file holds the
 * two things that are not React — the pixel arithmetic, which is where the two
 * backends disagree, and the handoff that tells the capture who draws a frame.
 *
 * # THE CLASSIC PATH IS NOT ROUTED THROUGH ANY OF THIS
 *
 * `WebGLRenderer` + `preserveDrawingBuffer` reads back correctly today and is
 * what every visitor renders through while the rollout flag is off. A rewrite
 * that also replaced the working path would be putting the one path with
 * traffic on it at risk to fix the one without, so `captureSceneStill` asks
 * this registry first and falls back to the canvas when nothing registered.
 * On the classic path nothing registers.
 */

/** Four channels, one byte each. The only readback format this app asks for. */
export const RGBA_BYTES_PER_PIXEL = 4;

/**
 * WebGPU copies a texture out one row at a time and pads every row to 256
 * bytes.
 *
 * `WebGPUTextureUtils.copyTextureToBuffer` computes
 * `bytesPerRow = ceil( width * bytesPerTexel / 256 ) * 256` and sizes the
 * buffer as `( height - 1 ) * bytesPerRow + width * bytesPerTexel`
 * (`three.webgpu.js:77012-77015`). That alignment is `GPUTexelCopyBufferInfo`'s
 * own requirement, not three's choice.
 *
 * **SO THE RETURNED ARRAY IS NOT `width * height * 4` BYTES LONG UNLESS THE
 * WIDTH HAPPENS TO BE A MULTIPLE OF 64**, and reading it as if it were shears
 * the picture progressively across its own height — which looks like a
 * rendering fault rather than like a unit mistake. The WebGL backend has no
 * such alignment: `gl.readPixels` into a pixel-pack buffer writes rows tightly
 * (`three.webgpu.js:70159`).
 */
export const WEBGPU_READBACK_ROW_ALIGNMENT_BYTES = 256;

/** `gl.readPixels` writes rows back to back. One is "no alignment at all". */
export const WEBGL_READBACK_ROW_ALIGNMENT_BYTES = 1;

/**
 * How coarsely a still is sampled to decide whether it holds a picture.
 *
 * A failed capture is blank everywhere, so a 16x16 grid answers the question
 * for the cost of one tiny `drawImage` — against a full-resolution
 * `getImageData` on a 4K still, which would allocate 33 MB to look at pixels
 * that are all the same. The number is the one `lib/exportImage.ts` has always
 * used for the same question.
 */
export const BLANK_PROBE_GRID_SIZE = 16;

/**
 * How many bytes one row of a readback occupies, padding included.
 *
 * Separated from the copy below because it is the one line the two backends
 * disagree on, and a disagreement worth a unit test is a disagreement worth a
 * named function.
 */
export function readbackRowStrideBytes(
  pixelWidth: number,
  bytesPerPixel: number,
  rowAlignmentBytes: number
): number {
  const tightStride = pixelWidth * bytesPerPixel;
  if (rowAlignmentBytes <= 1) {
    return tightStride;
  }
  return Math.ceil(tightStride / rowAlignmentBytes) * rowAlignmentBytes;
}

/** A readback exactly as a backend handed it over, before it means anything. */
export type SceneStillReadback = {
  /** The bytes the backend returned. May be padded, and may be upside down. */
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** Includes whatever padding the backend's alignment added. */
  rowStrideBytes: number;
  /**
   * Whether row zero of `bytes` is the BOTTOM row of the picture.
   *
   * True on the WebGL backend, because `gl.readPixels` reads out of a
   * framebuffer whose origin is bottom-left. False on the WebGPU backend,
   * because `copyTextureToBuffer` copies a texture whose origin is top-left.
   * The two node backends genuinely differ here, and it is the same
   * coordinate-system split `describeBackend` reports from `coordinateSystem`.
   */
  rowsRunBottomToTop: boolean;
};

/**
 * The readback, de-padded and turned the right way up, ready for `ImageData`.
 *
 * Copies row by row rather than in one pass, which is what makes both
 * corrections free: the source offset carries the padding and the destination
 * offset carries the flip, and neither costs an extra traversal.
 */
export function toTopDownImageBytes(readback: SceneStillReadback): Uint8ClampedArray<ArrayBuffer> {
  const { bytes, pixelWidth, pixelHeight, rowStrideBytes, rowsRunBottomToTop } = readback;
  const tightRowBytes = pixelWidth * RGBA_BYTES_PER_PIXEL;
  const topDownBytes = new Uint8ClampedArray(tightRowBytes * pixelHeight);
  for (let sourceRow = 0; sourceRow < pixelHeight; sourceRow += 1) {
    const destinationRow = rowsRunBottomToTop ? pixelHeight - 1 - sourceRow : sourceRow;
    const sourceStart = sourceRow * rowStrideBytes;
    topDownBytes.set(
      bytes.subarray(sourceStart, sourceStart + tightRowBytes),
      destinationRow * tightRowBytes
    );
  }
  return topDownBytes;
}

/**
 * Whether these bytes are a picture rather than a failed capture.
 *
 * Alpha OR colour, not alpha alone: a scene rendered into an offscreen target
 * with an opaque background carries colour everywhere and alpha everywhere, and
 * one rendered onto a transparent one carries colour where something was drawn.
 * Requiring both would reject a correct capture of a dark sky.
 */
export function stillBytesHoldAPicture(bytes: Uint8ClampedArray | Uint8Array): boolean {
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += RGBA_BYTES_PER_PIXEL) {
    if (
      bytes[byteIndex] > 0 ||
      bytes[byteIndex + 1] > 0 ||
      bytes[byteIndex + 2] > 0 ||
      bytes[byteIndex + 3] > 0
    ) {
      return true;
    }
  }
  return false;
}

/** What a registered source hands back: one picture, already the right way up. */
export type SceneStillPicture = {
  bytes: Uint8ClampedArray<ArrayBuffer>;
  pixelWidth: number;
  pixelHeight: number;
};

/** Renders one frame off-screen and reads it back. Null when it cannot. */
export type SceneStillSource = () => Promise<SceneStillPicture | null>;

let registeredSceneStillSource: SceneStillSource | null = null;

/**
 * Offers a way of capturing a still, for as long as the canvas is mounted.
 *
 * Module-level rather than context, because the consumers are outside the R3F
 * tree and outside React's tree entirely in one case — `lib/exportImage.ts` is
 * called from a click handler and has no component to read a context from.
 * `parityHarness.ts` reaches the same three call sites the same way, for the
 * same reason.
 *
 * Returns the function that withdraws it. A withdrawal that arrives after a
 * newer source registered leaves the newer one alone, which is what makes a
 * canvas remount safe: React mounts the replacement before it unmounts the
 * original often enough that the reverse order cannot be assumed.
 */
export function registerSceneStillSource(source: SceneStillSource): () => void {
  registeredSceneStillSource = source;
  return () => {
    if (registeredSceneStillSource === source) {
      registeredSceneStillSource = null;
    }
  };
}

/** The current source, or null when the canvas can be scraped instead. */
export function sceneStillSource(): SceneStillSource | null {
  return registeredSceneStillSource;
}

/** Drops whatever is registered. **Tests only.** */
export function forgetSceneStillSource(): void {
  registeredSceneStillSource = null;
}

/**
 * WHO DRAWS A COMPOSED FRAME, HANDED FROM THE POST CHAIN TO THE CAPTURE.
 *
 * A still has to look like the live scene or the warp visibly pops on its first
 * frame, and on three of the four families the live scene is not
 * `renderer.render( scene, camera )` — it is `RenderPipeline.render()`, eight
 * passes deep, with the tone curve inside it. `NodePostEffects` owns that
 * pipeline and takes the frame over with a `useFrame` priority, so the capture
 * has to be handed the same call rather than inventing a second one.
 *
 * **WHY A REF IN A CONTEXT AND NOT A `useFrame` PRIORITY.** Running the capture
 * after the chain by subscribing above its priority looks tidier and is a trap:
 * `@react-three/fiber` renders automatically only while NO subscriber holds a
 * priority above zero, so a capture bridge that claimed one would silently stop
 * the ocean — the one family that mounts no chain — from drawing at all.
 * `PlanetPositionTrackerContext` and `TerrainHeightSamplerContext` already pass
 * a mutable ref down this tree for the same shape of problem.
 *
 * Null means no chain is mounted, and the capture renders the scene directly.
 * That is the ocean's correct answer rather than a fallback: it renders
 * straight to the canvas by design, for the tone-mapping reason
 * `UniverseCanvas` documents beside the mount condition.
 */
export type ComposedFrameDrawer = { current: (() => void) | null };

export const ComposedFrameDrawerContext = createContext<ComposedFrameDrawer>({ current: null });

export function useComposedFrameDrawer(): ComposedFrameDrawer {
  return useContext(ComposedFrameDrawerContext);
}
