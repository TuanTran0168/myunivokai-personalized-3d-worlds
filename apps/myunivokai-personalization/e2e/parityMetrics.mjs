/**
 * WHAT "THE SAME IMAGE" MEANS, WITH A NUMBER ATTACHED.
 *
 * Phase 4 of agent-system/research/webgpu-full-migration-feasibility-2026.md.
 * `playwright.config.ts` argues, correctly, that a pixel assertion on a WebGL
 * frame is worse than nothing: output differs by GPU and driver, so a red job
 * would mean "different machine" far more often than "broken scene". §23.2
 * answers that objection rather than dismissing it — three renders, ONE machine,
 * ONE driver, one pinned animation phase — and what is left to decide is the
 * metric.
 *
 * Exact equality is still wrong, even here. Two backends rasterise the same
 * triangle to different subpixel coverage, resolve multisampling differently and
 * round the last bit of a colour differently, so a byte-exact comparison fails
 * on frames a person would call identical. Mean absolute error over the whole
 * frame is wrong in the other direction: a scene that is 80% dark sky absorbs a
 * badly wrong sea into a small average.
 *
 * So three numbers, and each one exists because it catches something the others
 * miss:
 *
 *   meanAbsoluteError   the average, per channel. Catches a global shift — a
 *                       tone curve applied twice, an exposure, a colour-space
 *                       round trip. Blind to a small region being very wrong.
 *   worstBlockError     the frame in 16x16 blocks, worst block's mean error.
 *                       Catches a LOCAL failure — one layer missing, a shader
 *                       that did not compile, a reflection in the wrong place —
 *                       which is exactly the shape Phase 1 found WebGPU fails
 *                       in (§30.3: the draw is dropped and nothing reports it).
 *   differingFraction   share of pixels past a per-pixel noise floor. Separates
 *                       "everything moved a little" from "a few things moved a
 *                       lot", which the first two cannot do alone.
 *
 * NO STRUCTURAL METRIC (SSIM and friends) on purpose: it would need a
 * dependency, and this comparison is between two renders of one scene at one
 * pinned moment, not between an image and a compressed copy of it. The failures
 * worth catching here are radiometric and positional, and these three see both.
 *
 * READ OFF THE CANVAS, NEVER A RENDER TARGET. Phase 1 measured why (§30.5): the
 * same linear 0.5 under ACES comes back as 127 from a render target and 197 from
 * the canvas, because `Renderer.isToneMappingState` is false whenever a target
 * is bound — and `readRenderTargetPixelsAsync` hands back row 0 as the TOP of
 * the frame on WebGPU and the BOTTOM on the WebGL backend, so a naive buffer
 * diff between backends reports a total mismatch that is not a rendering
 * difference at all. A Playwright screenshot is the canvas, top-down, on both.
 */

const BLOCK_SIZE = 16;

/**
 * Per-channel byte difference below which a pixel is called unchanged.
 *
 * 4 of 255, about 1.5%. Set from a measurement rather than a feeling: the ocean
 * PROTOTYPE frames — a static page, no animation, no scene code — move by up to
 * ±0.004 mean luma between two runs of identical code on this machine, and this
 * is the per-pixel room that leaves.
 */
export const PIXEL_NOISE_FLOOR = 4;

/**
 * The tolerances, stated rather than discovered, because a tolerance chosen
 * after seeing the result is not a test.
 *
 * SAME_RENDERER is the stability gate and the one that must pass FIRST: two runs
 * of the identical renderer, at the identical pinned time, must land inside it,
 * or the harness is measuring its own noise and nothing it says about backends
 * means anything. Phase 4's own acceptance criterion in §26 — "the harness
 * reproduces today's WebGL output against itself within tolerance, i.e. it is
 * stable before it is trusted".
 *
 * CROSS_BACKEND is deliberately looser and deliberately NOT zero. Two backends
 * are two rasterisers; the question is whether a visitor could tell, and a
 * visitor cannot tell 2 bytes of mean error on a sea. It is tight enough to fail
 * a dropped layer, a doubled tone curve or a flipped reflection, which are the
 * failures this exists for.
 */
export const SAME_RENDERER_TOLERANCE = {
  meanAbsoluteError: 2,
  worstBlockError: 12,
  differingFraction: 0.02
};

export const CROSS_BACKEND_TOLERANCE = {
  meanAbsoluteError: 6,
  worstBlockError: 40,
  differingFraction: 0.15
};

/**
 * Decodes a PNG into raw RGBA.
 *
 * Hand-rolled rather than taken from a dependency, matching
 * the demos' own measure scripts: Playwright's screenshots are 8-bit RGB/RGBA
 * non-interlaced, which is the one case worth supporting, and a decoder that
 * fails loudly on anything else is better than a dependency that quietly
 * handles cases this suite never produces.
 */
export function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  let bitDepth = 8;
  const dataChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      if (buffer[start + 12] !== 0) throw new Error("parityMetrics: interlaced PNG is not supported");
    } else if (type === "IDAT") {
      dataChunks.push(buffer.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }
  if (bitDepth !== 8) throw new Error(`parityMetrics: unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`parityMetrics: unsupported colour type ${colorType}`);
  return { width, height, channels, deflated: Buffer.concat(dataChunks) };
}

/** Undoes PNG's per-scanline filters, giving one contiguous RGBA buffer. */
export function inflatePng(buffer, inflateSync) {
  const { width, height, channels, deflated } = decodePng(buffer);
  const raw = inflateSync(deflated);
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previousLine = Buffer.alloc(stride);
  let readAt = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[readAt];
    readAt += 1;
    const line = Buffer.from(raw.subarray(readAt, readAt + stride));
    readAt += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? line[index - channels] : 0;
      const up = previousLine[index];
      const upLeft = index >= channels ? previousLine[index - channels] : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[index] = (line[index] + left) & 0xff;
          break;
        case 2:
          line[index] = (line[index] + up) & 0xff;
          break;
        case 3:
          line[index] = (line[index] + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          const prediction = left + up - upLeft;
          const distanceLeft = Math.abs(prediction - left);
          const distanceUp = Math.abs(prediction - up);
          const distanceUpLeft = Math.abs(prediction - upLeft);
          const nearest =
            distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
              ? left
              : distanceUp <= distanceUpLeft
                ? up
                : upLeft;
          line[index] = (line[index] + nearest) & 0xff;
          break;
        }
        default:
          throw new Error(`parityMetrics: unknown PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      pixels[to] = line[from];
      pixels[to + 1] = line[from + 1];
      pixels[to + 2] = line[from + 2];
      pixels[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previousLine = line;
  }
  return { width, height, pixels };
}

/**
 * Compares two decoded frames.
 *
 * Differing sizes are a thrown error rather than a large difference: two frames
 * of different dimensions are not a parity failure, they are a harness failure,
 * and reporting one as the other is how a broken instrument gets acted on.
 */
export function compareFrames(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `parityMetrics: frames are different sizes (${left.width}x${left.height} against ${right.width}x${right.height})`
    );
  }
  const { width, height } = left;
  let totalError = 0;
  let differingPixels = 0;
  const blocksAcross = Math.ceil(width / BLOCK_SIZE);
  const blocksDown = Math.ceil(height / BLOCK_SIZE);
  const blockError = new Float64Array(blocksAcross * blocksDown);
  const blockPixels = new Float64Array(blocksAcross * blocksDown);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const redError = Math.abs(left.pixels[offset] - right.pixels[offset]);
      const greenError = Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]);
      const blueError = Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]);
      const pixelError = (redError + greenError + blueError) / 3;
      totalError += pixelError;
      if (redError > PIXEL_NOISE_FLOOR || greenError > PIXEL_NOISE_FLOOR || blueError > PIXEL_NOISE_FLOOR) {
        differingPixels += 1;
      }
      const blockIndex = Math.floor(y / BLOCK_SIZE) * blocksAcross + Math.floor(x / BLOCK_SIZE);
      blockError[blockIndex] += pixelError;
      blockPixels[blockIndex] += 1;
    }
  }

  let worstBlockError = 0;
  let worstBlockAt = { x: 0, y: 0 };
  for (let blockIndex = 0; blockIndex < blockError.length; blockIndex += 1) {
    if (blockPixels[blockIndex] === 0) continue;
    const meanForBlock = blockError[blockIndex] / blockPixels[blockIndex];
    if (meanForBlock > worstBlockError) {
      worstBlockError = meanForBlock;
      worstBlockAt = {
        x: (blockIndex % blocksAcross) * BLOCK_SIZE,
        y: Math.floor(blockIndex / blocksAcross) * BLOCK_SIZE
      };
    }
  }

  const pixelCount = width * height;
  return {
    meanAbsoluteError: totalError / pixelCount,
    worstBlockError,
    worstBlockAt,
    differingFraction: differingPixels / pixelCount,
    pixelCount
  };
}

/** Which tolerances a comparison broke, named, or an empty list. */
export function toleranceBreaches(comparison, tolerance) {
  const breaches = [];
  if (comparison.meanAbsoluteError > tolerance.meanAbsoluteError) {
    breaches.push(
      `mean absolute error ${comparison.meanAbsoluteError.toFixed(2)} over ${tolerance.meanAbsoluteError}`
    );
  }
  if (comparison.worstBlockError > tolerance.worstBlockError) {
    breaches.push(
      `worst 16x16 block ${comparison.worstBlockError.toFixed(2)} over ${tolerance.worstBlockError}, at ` +
        `${comparison.worstBlockAt.x},${comparison.worstBlockAt.y}`
    );
  }
  if (comparison.differingFraction > tolerance.differingFraction) {
    breaches.push(
      `${(comparison.differingFraction * 100).toFixed(2)}% of pixels differ, over ` +
        `${(tolerance.differingFraction * 100).toFixed(2)}%`
    );
  }
  return breaches;
}

export function describeComparison(comparison) {
  return (
    `mean ${comparison.meanAbsoluteError.toFixed(2)} · worst block ${comparison.worstBlockError.toFixed(2)} ` +
    `at ${comparison.worstBlockAt.x},${comparison.worstBlockAt.y} · ` +
    `${(comparison.differingFraction * 100).toFixed(2)}% differing`
  );
}

/**
 * THE FLOOR A FRAME HAS TO CLEAR TO COUNT AS A RENDER AT ALL.
 *
 * Standard deviation of luminance, in bytes of 255. A frame filled with one
 * colour measures 0; every real frame this project produces measures tens.
 *
 * It exists because of a failure that passed every gate this harness had.
 * §26 Phase 5's node chain built its graph with a `null` centre node, three
 * logged `THREE.TSL: TypeError: Cannot read properties of null (reading
 * 'build')` — logged, not thrown — and `RenderPipeline` then rendered an EMPTY
 * canvas. The comparison duly reported the two new backends as **byte-identical
 * to 0.00**, which was true and meaningless: two blank frames are identical.
 * Phase 1 had already recorded this shape (§30.3, a dropped draw nothing
 * reports); what was missing was a gate that asks whether a leg drew anything
 * before asking whether two legs agree.
 *
 * 3 of 255, stated rather than fitted: it is above the noise of a gradient-only
 * background and far below any frame with geometry in it. Measured over the
 * frame's centred half — see `luminanceStandardDeviation`, and the reason is that
 * an element screenshot includes the HTML overlays on top of the canvas.
 */
export const BLANK_FRAME_LUMINANCE_DEVIATION = 3;

/** Rec. 709 luminance weights, matching three's own working colour space. */
const LUMINANCE_RED_WEIGHT = 0.2126;
const LUMINANCE_GREEN_WEIGHT = 0.7152;
const LUMINANCE_BLUE_WEIGHT = 0.0722;

/**
 * Standard deviation of per-pixel luminance — how much STRUCTURE a frame has.
 *
 * Not a mean: a blank frame and a busy frame can share a mean. The deviation is
 * what separates "the renderer drew the scene" from "the renderer drew the clear
 * colour", which is the distinction a parity comparison cannot make on its own.
 */
/**
 * How much of the frame's WIDTH and HEIGHT the structure test looks at, centred.
 *
 * Half, and it has to be a crop rather than the whole frame, because a
 * Playwright element screenshot is a VIEWPORT capture clipped to the element's
 * box — so a screenshot of the scene canvas contains every HTML overlay drawn on
 * top of it. On this app's world page that is the title card, the DNA panel, the
 * share box and the action bar, all of them identical on every leg.
 *
 * The first version of this gate measured the whole frame and passed a
 * completely empty 3D canvas at a deviation of 26, because the HUD alone
 * supplies that much structure. The middle of the frame is the one region that
 * is scene on every fixture this suite renders.
 */
const STRUCTURE_REGION_FRACTION = 0.5;

/**
 * Standard deviation of per-pixel luminance over the centred crop — how much
 * STRUCTURE the frame has where the scene is.
 *
 * Not a mean: a blank frame and a busy frame can share a mean. The deviation is
 * what separates "the renderer drew the scene" from "the renderer drew the clear
 * colour", which is the distinction a parity comparison cannot make on its own.
 */
export function luminanceStandardDeviation(frame) {
  const { pixels, width, height } = frame;
  const regionWidth = Math.max(1, Math.round(width * STRUCTURE_REGION_FRACTION));
  const regionHeight = Math.max(1, Math.round(height * STRUCTURE_REGION_FRACTION));
  const startX = Math.round((width - regionWidth) / 2);
  const startY = Math.round((height - regionHeight) / 2);

  let total = 0;
  let squaredTotal = 0;
  const sampleCount = regionWidth * regionHeight;
  for (let y = startY; y < startY + regionHeight; y += 1) {
    for (let x = startX; x < startX + regionWidth; x += 1) {
      const offset = (y * width + x) * 4;
      const luminance =
        pixels[offset] * LUMINANCE_RED_WEIGHT +
        pixels[offset + 1] * LUMINANCE_GREEN_WEIGHT +
        pixels[offset + 2] * LUMINANCE_BLUE_WEIGHT;
      total += luminance;
      squaredTotal += luminance * luminance;
    }
  }
  const mean = total / sampleCount;
  const variance = Math.max(0, squaredTotal / sampleCount - mean * mean);
  return Math.sqrt(variance);
}

/**
 * Mean luminance inside one rectangle of the frame.
 *
 * The whole-frame average cannot answer "is the star lit": a star is a small
 * bright disc in a mostly black sky, and its failure — going black — barely
 * moves a frame-wide mean. So the region is named by the caller and the fixture
 * pins the camera that puts the object in it.
 */
export function regionMeanLuminance(frame, region) {
  const { pixels, width } = frame;
  let total = 0;
  let sampleCount = 0;
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const offset = (y * width + x) * 4;
      total +=
        pixels[offset] * LUMINANCE_RED_WEIGHT +
        pixels[offset + 1] * LUMINANCE_GREEN_WEIGHT +
        pixels[offset + 2] * LUMINANCE_BLUE_WEIGHT;
      sampleCount += 1;
    }
  }
  return sampleCount === 0 ? 0 : total / sampleCount;
}

/**
 * A channel at or above this byte is called clipped.
 *
 * 250 of 255, not 255, because the composer's grade and the AgX shoulder land a
 * genuinely clipped value a byte or two below the ceiling and an exact-255 test
 * would miss it. This is the number the tone-curve fix was measured with.
 */
export const CLIPPED_CHANNEL_BYTE = 250;

/**
 * THE ONE-FRAME MEASUREMENT, because the failure it exists for is not a
 * difference between two frames.
 *
 * A missing tone curve does not make a scene differ from a reference — it makes
 * a scene lose its highlights, and it does that to EVERY frame including the
 * reference. For its whole life before the fix in §26 Phase 2 this app shipped a
 * composer that assigned `NoToneMapping` and had no `<ToneMapping>` pass, so
 * every linear value above 1 clipped flat: the sun rendered as a black disc with
 * only its hottest granulation surviving, and the baseline shot of that was
 * COMMITTED TO THIS REPOSITORY and reviewed by eye without anyone catching it.
 *
 * `scene-baseline.spec.ts` says to compare its images "by eye for CONTENT", and
 * that policy is right — but a black sun IS content, and it still got through,
 * twice, on two different pages. So the property gets an assertion instead of a
 * reviewer: what fraction of this frame is clipped.
 */
export function clippedChannelFraction(frame, clippedByte = CLIPPED_CHANNEL_BYTE) {
  const { pixels, width, height } = frame;
  const pixelCount = width * height;
  let clippedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (
      pixels[offset] >= clippedByte ||
      pixels[offset + 1] >= clippedByte ||
      pixels[offset + 2] >= clippedByte
    ) {
      clippedPixels += 1;
    }
  }
  return clippedPixels / pixelCount;
}
