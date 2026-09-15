import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  compareFrames,
  CROSS_BACKEND_TOLERANCE,
  inflatePng,
  PIXEL_NOISE_FLOOR,
  SAME_RENDERER_TOLERANCE,
  toleranceBreaches,
  type DecodedFrame
} from "../../../../e2e/parityMetrics.mjs";

/**
 * THE INSTRUMENT, TESTED BEFORE THE THING IT MEASURES.
 *
 * `parityMetrics.mjs` contains a hand-rolled PNG decoder and a block-wise image
 * comparison, and both are the kind of code that returns plausible garbage
 * rather than failing: a filter case handled wrong shifts a scanline, and a
 * shifted scanline reads as "the two backends disagree". Every parity number
 * Phase 4 produces rests on these functions, so they get their own test rather
 * than being validated by the result they produce.
 *
 * The load-bearing case is `catches a local failure the average is blind to`.
 * That is the entire reason `worstBlockError` exists — Phase 1 measured that a
 * WebGPU shader failure DROPS THE DRAW and reports nothing (§30.3), so the
 * failure this harness must catch is one region being very wrong while the frame
 * average barely moves.
 */

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 48;

/** A valid 8-bit RGBA non-interlaced PNG, filter 0 on every scanline. */
function encodePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const lineStart = y * (stride + 1);
    raw[lineStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = paint(x, y);
      const at = lineStart + 1 + x * 4;
      raw[at] = red;
      raw[at + 1] = green;
      raw[at + 2] = blue;
      raw[at + 3] = 255;
    }
  }

  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typeAndBody = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndBody));
    return Buffer.concat([length, typeAndBody, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** Only needed to make the fixtures well-formed; the decoder does not check it. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decode(buffer: Buffer): DecodedFrame {
  return inflatePng(buffer, inflateSync);
}

/** A gradient, so a shifted scanline or a swapped channel cannot pass. */
const gradient = (x: number, y: number): [number, number, number] => [
  (x * 4) % 256,
  (y * 5) % 256,
  (x + y) % 256
];

describe("parity PNG decoding", () => {
  it("round-trips dimensions and every pixel", () => {
    const frame = decode(encodePng(FRAME_WIDTH, FRAME_HEIGHT, gradient));
    expect(frame.width).toBe(FRAME_WIDTH);
    expect(frame.height).toBe(FRAME_HEIGHT);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [FRAME_WIDTH - 1, FRAME_HEIGHT - 1],
      [17, 29]
    ]) {
      const at = (y * FRAME_WIDTH + x) * 4;
      const [red, green, blue] = gradient(x, y);
      expect([frame.pixels[at], frame.pixels[at + 1], frame.pixels[at + 2]], `pixel ${x},${y}`).toEqual([
        red,
        green,
        blue
      ]);
    }
  });

  it("reads row 0 as the TOP of the image", () => {
    // Not pedantry: the two backends hand back render-target rows in opposite
    // order (§30.5), which is exactly why this harness compares canvas
    // screenshots and why the decoder's own orientation has to be pinned.
    const topBright = decode(encodePng(8, 8, (_x, y) => (y < 4 ? [255, 255, 255] : [0, 0, 0])));
    expect(topBright.pixels[0]).toBe(255);
    expect(topBright.pixels[(7 * 8 + 0) * 4]).toBe(0);
  });
});

describe("parity comparison", () => {
  it("reports zero for a frame against itself", () => {
    const frame = decode(encodePng(FRAME_WIDTH, FRAME_HEIGHT, gradient));
    const comparison = compareFrames(frame, frame);
    expect(comparison.meanAbsoluteError).toBe(0);
    expect(comparison.worstBlockError).toBe(0);
    expect(comparison.differingFraction).toBe(0);
    expect(toleranceBreaches(comparison, SAME_RENDERER_TOLERANCE)).toEqual([]);
  });

  it("ignores a difference under the per-pixel noise floor", () => {
    const left = decode(encodePng(FRAME_WIDTH, FRAME_HEIGHT, () => [100, 100, 100]));
    const right = decode(
      encodePng(FRAME_WIDTH, FRAME_HEIGHT, () => [100 + PIXEL_NOISE_FLOOR, 100, 100])
    );
    const comparison = compareFrames(left, right);
    expect(comparison.differingFraction).toBe(0);
    expect(comparison.meanAbsoluteError).toBeCloseTo(PIXEL_NOISE_FLOOR / 3, 6);
  });

  /**
   * THE CASE THE WHOLE METRIC EXISTS FOR.
   *
   * At the real desktop viewport, one 16x16 block is 256 of 1,296,000 pixels —
   * 0.02% — so wronging it by 200 moves the mean absolute error by 0.04 and the
   * block detector by the full 200. A harness with only an average would pass a
   * frame that had lost an entire additive layer.
   *
   * The viewport size here is not decoration. Written first against the 64x48
   * fixture the other cases use, this test failed: 256 of 3,072 pixels is 8.3%,
   * the mean came out at 16.7, and the assertion that the average stays blind
   * was false. The blindness is a property of the RATIO, so the frame has to be
   * the size the harness actually photographs for the claim to hold.
   */
  it("catches a local failure the average is blind to", () => {
    const viewportWidth = 1440;
    const viewportHeight = 900;
    const left = decode(encodePng(viewportWidth, viewportHeight, () => [40, 40, 40]));
    const right = decode(
      encodePng(viewportWidth, viewportHeight, (x, y) => (x < 16 && y < 16 ? [240, 240, 240] : [40, 40, 40]))
    );
    const comparison = compareFrames(left, right);
    expect(comparison.meanAbsoluteError).toBeLessThan(0.1);

    expect(comparison.meanAbsoluteError).toBeLessThan(CROSS_BACKEND_TOLERANCE.meanAbsoluteError);
    expect(comparison.worstBlockError).toBeCloseTo(200, 6);
    expect(comparison.worstBlockAt).toEqual({ x: 0, y: 0 });

    const breaches = toleranceBreaches(comparison, CROSS_BACKEND_TOLERANCE);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toContain("worst 16x16 block");
  });

  it("refuses to compare frames of different sizes instead of calling it a difference", () => {
    const small = decode(encodePng(16, 16, gradient));
    const large = decode(encodePng(32, 16, gradient));
    // A size mismatch is a harness fault. Reporting it as a large image
    // difference is how a broken instrument gets acted on as a rendering bug.
    expect(() => compareFrames(small, large)).toThrow(/different sizes/);
  });
});
