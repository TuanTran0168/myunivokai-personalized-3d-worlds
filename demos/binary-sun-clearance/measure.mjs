import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const { inflatePng } = await import(
  new URL("../../apps/myunivokai-personalization/e2e/parityMetrics.mjs", import.meta.url).href
);

/**
 * CROP THE STAR OUT OF A FULL-PAGE SHOT, AND MEASURE ITS COLOUR.
 *
 * `demos/README.md`: a demo that makes a visual claim ships a script that checks
 * it numerically. This one makes two claims and checks the second only, on
 * purpose.
 *
 * **The geometry is NOT measured here.** Counting bright regions to say "one
 * welded blob became two stars" was written first and thrown away: the primary's
 * additive glow shell sits above any threshold low enough to include the
 * companion's disc, so at 0.66 of the frame's peak everything is one region and
 * at 0.78 the primary's own mottled texture breaks into seven. A count that
 * swings between 1 and 8 over a threshold sweep is not evidence. The geometry is
 * proven instead by
 * `apps/myunivokai-personalization/src/features/scene-renderers/solar-system/binarySunGeometry.test.ts`,
 * which sweeps the entire seeded core-scale range in world units and needs no
 * pixels at all. **Look at the crops with your eyes; trust the test for the
 * number.**
 *
 * The colour IS measured, because the owner's report was "the sun looks pale"
 * and that deserves a number rather than an opinion. Same method as
 * `e2e/sun-colour.spec.ts`: find the star by its brightest pixel, mean every
 * pixel above a luminance floor around it, report saturation as (max−min)/max
 * across the channels.
 */

// The canvas region of the 1440x900 desktop shot: right of the form rail, below
// the header, left of the live-preview island. Restricting the search is what
// keeps the brass button and the HUD text out of the measurement.
const SEARCH_LEFT = 430;
const SEARCH_TOP = 200;
const SEARCH_RIGHT = 1130;
const SEARCH_BOTTOM = 780;

const STAR_BOX_HALF_WIDTH = 90;
const STAR_LUMINANCE_FLOOR = 60;

const CROP_LEFT = 470;
const CROP_TOP = 210;
const CROP_WIDTH = 620;
const CROP_HEIGHT = 520;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_COLOR_TYPE_RGBA = 6;
const PNG_BIT_DEPTH = 8;
const CHANNELS_PER_PIXEL = 4;

function luminanceAt(pixels, offset) {
  return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
}

function measureStarColour(frame) {
  const { width, pixels } = frame;
  let peakLuminance = -1;
  let peakX = 0;
  let peakY = 0;
  for (let y = SEARCH_TOP; y < SEARCH_BOTTOM; y += 1) {
    for (let x = SEARCH_LEFT; x < SEARCH_RIGHT; x += 1) {
      const luminance = luminanceAt(pixels, (y * width + x) * CHANNELS_PER_PIXEL);
      if (luminance > peakLuminance) {
        peakLuminance = luminance;
        peakX = x;
        peakY = y;
      }
    }
  }

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let measuredPixels = 0;
  for (let y = peakY - STAR_BOX_HALF_WIDTH; y <= peakY + STAR_BOX_HALF_WIDTH; y += 1) {
    for (let x = peakX - STAR_BOX_HALF_WIDTH; x <= peakX + STAR_BOX_HALF_WIDTH; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= frame.height) continue;
      const offset = (y * width + x) * CHANNELS_PER_PIXEL;
      if (luminanceAt(pixels, offset) < STAR_LUMINANCE_FLOOR) continue;
      redTotal += pixels[offset];
      greenTotal += pixels[offset + 1];
      blueTotal += pixels[offset + 2];
      measuredPixels += 1;
    }
  }

  const red = redTotal / measuredPixels;
  const green = greenTotal / measuredPixels;
  const blue = blueTotal / measuredPixels;
  const highestChannel = Math.max(red, green, blue);
  const lowestChannel = Math.min(red, green, blue);

  return {
    red,
    green,
    blue,
    saturation: highestChannel === 0 ? 0 : (highestChannel - lowestChannel) / highestChannel,
    peakLuminance,
    measuredPixels
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = PNG_BIT_DEPTH;
  header[9] = PNG_COLOR_TYPE_RGBA;
  const stride = width * CHANNELS_PER_PIXEL;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function cropped(frame) {
  const pixels = Buffer.alloc(CROP_WIDTH * CROP_HEIGHT * CHANNELS_PER_PIXEL);
  for (let y = 0; y < CROP_HEIGHT; y += 1) {
    const sourceStart = ((CROP_TOP + y) * frame.width + CROP_LEFT) * CHANNELS_PER_PIXEL;
    frame.pixels.copy(
      pixels,
      y * CROP_WIDTH * CHANNELS_PER_PIXEL,
      sourceStart,
      sourceStart + CROP_WIDTH * CHANNELS_PER_PIXEL
    );
  }
  return encodePng(CROP_WIDTH, CROP_HEIGHT, pixels);
}

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const sources = process.argv.slice(2);

if (sources.length === 0) {
  console.error("usage: node measure.mjs <label>=<path-to-shot.png> [...]");
  process.exit(1);
}

for (const source of sources) {
  const separatorIndex = source.indexOf("=");
  const label = source.slice(0, separatorIndex);
  const path = resolve(source.slice(separatorIndex + 1));
  const frame = inflatePng(readFileSync(path), inflateSync);

  writeFileSync(resolve(outputDirectory, `${label}.png`), cropped(frame));

  const star = measureStarColour(frame);
  console.log(
    `${label}: rgb ${star.red.toFixed(1)} ${star.green.toFixed(1)} ${star.blue.toFixed(1)} · ` +
      `saturation ${star.saturation.toFixed(3)} · peak ${star.peakLuminance.toFixed(0)} of 255 · ` +
      `${star.measuredPixels} px`
  );
}
