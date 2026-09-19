import { afterEach, describe, expect, it } from "vitest";
import {
  RGBA_BYTES_PER_PIXEL,
  WEBGL_READBACK_ROW_ALIGNMENT_BYTES,
  WEBGPU_READBACK_ROW_ALIGNMENT_BYTES,
  forgetSceneStillSource,
  readbackRowStrideBytes,
  registerSceneStillSource,
  sceneStillSource,
  stillBytesHoldAPicture,
  toTopDownImageBytes
} from "./sceneStillCapture";

/**
 * THE TWO PLACES THE BACKENDS DISAGREE, WHICH IS WHY THIS FILE EXISTS.
 *
 * A still captured off a render target is not the target's bytes: WebGPU pads
 * every row to 256 bytes and stores the picture top-down, WebGL pads nothing
 * and stores it bottom-up. Getting either wrong produces an image that is
 * plausible enough to ship — a sheared picture, or an upside-down one — and
 * neither is something a smoke test notices. They are arithmetic, so they are
 * tested as arithmetic rather than photographed.
 */

const OPAQUE = 255;

/** A readback where every pixel's red channel is its own row index. */
function rowMarkedReadback(pixelWidth: number, pixelHeight: number, rowStrideBytes: number): Uint8Array {
  const bytes = new Uint8Array(rowStrideBytes * pixelHeight);
  for (let row = 0; row < pixelHeight; row += 1) {
    for (let column = 0; column < pixelWidth; column += 1) {
      const offset = row * rowStrideBytes + column * RGBA_BYTES_PER_PIXEL;
      bytes[offset] = row;
      bytes[offset + 3] = OPAQUE;
    }
  }
  return bytes;
}

function redChannelOfEveryRow(bytes: Uint8ClampedArray, pixelWidth: number, pixelHeight: number): number[] {
  const rows: number[] = [];
  for (let row = 0; row < pixelHeight; row += 1) {
    rows.push(bytes[row * pixelWidth * RGBA_BYTES_PER_PIXEL]);
  }
  return rows;
}

afterEach(() => {
  forgetSceneStillSource();
});

describe("readbackRowStrideBytes", () => {
  it("pads a WebGPU row up to the next 256 bytes", () => {
    // 100 px * 4 = 400 bytes, which is not a multiple of 256, so the row
    // occupies 512 and 112 bytes of every row are padding.
    expect(readbackRowStrideBytes(100, RGBA_BYTES_PER_PIXEL, WEBGPU_READBACK_ROW_ALIGNMENT_BYTES)).toBe(512);
  });

  it("leaves a WebGPU row alone when the width already lands on the alignment", () => {
    // 64 px * 4 = 256 exactly. This is the width at which a missing de-pad
    // would pass, which is precisely why it is a separate case.
    expect(readbackRowStrideBytes(64, RGBA_BYTES_PER_PIXEL, WEBGPU_READBACK_ROW_ALIGNMENT_BYTES)).toBe(256);
  });

  it("packs a WebGL row tightly", () => {
    expect(readbackRowStrideBytes(100, RGBA_BYTES_PER_PIXEL, WEBGL_READBACK_ROW_ALIGNMENT_BYTES)).toBe(400);
  });
});

describe("toTopDownImageBytes", () => {
  it("drops WebGPU's row padding and keeps the row order", () => {
    const pixelWidth = 3;
    const pixelHeight = 4;
    const rowStrideBytes = readbackRowStrideBytes(
      pixelWidth,
      RGBA_BYTES_PER_PIXEL,
      WEBGPU_READBACK_ROW_ALIGNMENT_BYTES
    );
    expect(rowStrideBytes, "3 px is 12 bytes, padded to one 256-byte row").toBe(256);

    const topDown = toTopDownImageBytes({
      bytes: rowMarkedReadback(pixelWidth, pixelHeight, rowStrideBytes),
      pixelWidth,
      pixelHeight,
      rowStrideBytes,
      rowsRunBottomToTop: false
    });

    expect(topDown.length).toBe(pixelWidth * pixelHeight * RGBA_BYTES_PER_PIXEL);
    expect(redChannelOfEveryRow(topDown, pixelWidth, pixelHeight)).toEqual([0, 1, 2, 3]);
  });

  it("turns a WebGL readback the right way up", () => {
    const pixelWidth = 3;
    const pixelHeight = 4;
    const rowStrideBytes = readbackRowStrideBytes(
      pixelWidth,
      RGBA_BYTES_PER_PIXEL,
      WEBGL_READBACK_ROW_ALIGNMENT_BYTES
    );

    const topDown = toTopDownImageBytes({
      bytes: rowMarkedReadback(pixelWidth, pixelHeight, rowStrideBytes),
      pixelWidth,
      pixelHeight,
      rowStrideBytes,
      rowsRunBottomToTop: true
    });

    // Row 0 of the readback is the BOTTOM of the picture, so it must land last.
    expect(redChannelOfEveryRow(topDown, pixelWidth, pixelHeight)).toEqual([3, 2, 1, 0]);
  });

  it("does both corrections at once, which is the WebGPU-shaped mistake reversed", () => {
    const pixelWidth = 5;
    const pixelHeight = 3;
    const rowStrideBytes = readbackRowStrideBytes(
      pixelWidth,
      RGBA_BYTES_PER_PIXEL,
      WEBGPU_READBACK_ROW_ALIGNMENT_BYTES
    );

    const topDown = toTopDownImageBytes({
      bytes: rowMarkedReadback(pixelWidth, pixelHeight, rowStrideBytes),
      pixelWidth,
      pixelHeight,
      rowStrideBytes,
      rowsRunBottomToTop: true
    });

    expect(topDown.length).toBe(pixelWidth * pixelHeight * RGBA_BYTES_PER_PIXEL);
    expect(redChannelOfEveryRow(topDown, pixelWidth, pixelHeight)).toEqual([2, 1, 0]);
  });
});

describe("stillBytesHoldAPicture", () => {
  it("rejects a capture that came back empty", () => {
    expect(stillBytesHoldAPicture(new Uint8ClampedArray(64))).toBe(false);
  });

  it("accepts a capture with colour but no alpha, which is a real frame", () => {
    const bytes = new Uint8ClampedArray(64);
    bytes[8] = 12;
    expect(stillBytesHoldAPicture(bytes)).toBe(true);
  });

  it("accepts a capture with alpha but no colour, which is a real black frame", () => {
    const bytes = new Uint8ClampedArray(64);
    bytes[3] = OPAQUE;
    expect(stillBytesHoldAPicture(bytes)).toBe(true);
  });
});

describe("the still source registry", () => {
  it("answers null until a source registers", () => {
    expect(sceneStillSource()).toBeNull();
  });

  it("hands back the registered source", async () => {
    const source = async () => null;
    registerSceneStillSource(source);
    expect(sceneStillSource()).toBe(source);
  });

  /**
   * A canvas remount mounts the replacement before unmounting the original
   * often enough that the reverse order cannot be assumed. A withdrawal that
   * arrives late must not take the newer source with it.
   */
  it("ignores a withdrawal that arrives after a newer source registered", () => {
    const firstSource = async () => null;
    const secondSource = async () => null;
    const withdrawFirst = registerSceneStillSource(firstSource);
    registerSceneStillSource(secondSource);
    withdrawFirst();
    expect(sceneStillSource()).toBe(secondSource);
  });

  it("withdraws the current source", () => {
    const withdraw = registerSceneStillSource(async () => null);
    withdraw();
    expect(sceneStillSource()).toBeNull();
  });
});
