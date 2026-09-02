import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Renders the Myunivokai mark to transparent PNGs.
 *
 * The SVGs beside the outputs are the masters and are what the browser actually
 * loads; these rasters exist for the surfaces that cannot take vector art. Rather
 * than pull in a rasteriser — this repo has neither sharp nor ImageMagick, and a
 * brand mark is not worth a native dependency in a production install — the mark
 * is drawn analytically here and written through the PNG encoder below, which
 * needs nothing but node:zlib.
 *
 * Run: node scripts/build-brand-mark.mjs
 */

// --- PNG container -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder = CRC_TABLE[(remainder ^ byte) & 0xff] ^ (remainder >>> 8);
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typed.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typed), 8 + data.length);
  return chunk;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Compression, filter and interlace methods all have exactly one valid value.

  const stride = size * 4;
  // Every scanline carries filter type 0. Filtering would compress better, but a
  // few hundred bytes on a logo is not worth the arithmetic.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// --- The mark ----------------------------------------------------------------
//
// An M drawn as a ridge, with a disc rising behind it.
//
// The name is My Unique OK AI, not "my universe", and the product builds forests,
// cities and oceans as readily as solar systems — so the mark cannot be a planet.
// A ridge is the one silhouette that reads as all of them: summits, a skyline,
// a swell. It is also, at these proportions, the letter M. The disc behind it is
// whatever the world needs it to be — sun, moon, or the star a system orbits.
//
// Authored against a 512 grid and scaled, so these read as the SVGs' numbers.

const DESIGN_SIZE = 512;

/**
 * Two cuts of one mark, matching public/logo.svg and src/app/icon.svg.
 *
 * The tab icon is not the logo shrunk. At 16px a fine ridge turns to mud, so that
 * cut thickens the stroke, shortens the run and lifts the disc until the
 * silhouette still reads.
 */
const MARK_VARIANTS = {
  logo: {
    ridge: [
      [68, 400],
      [172, 214],
      [256, 292],
      [338, 170],
      [444, 400]
    ],
    ridgeStroke: 46,
    // Behind the right summit rather than down in the valley: in the valley the
    // two arms close over it and all that shows is a smudge.
    discCentre: [352, 156],
    discRadius: 66
  },
  icon: {
    ridge: [
      [76, 396],
      [176, 220],
      [256, 292],
      [334, 180],
      [436, 396]
    ],
    ridgeStroke: 62,
    discCentre: [350, 166],
    discRadius: 68
  }
};

/** Brass, from globals.css: --paper, --brass lightened, --brass, --brass-deep. */
const HIGHLIGHT = [242, 238, 230];
const BRASS_LIGHT = [228, 207, 156];
const BRASS = [201, 163, 91];
const BRASS_DEEP = [168, 132, 63];

const SAMPLES_PER_AXIS = 4;

function mixColor(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount
  ];
}

function rampColor(stops, position) {
  const clamped = Math.min(1, Math.max(0, position));
  const span = 1 / (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(clamped / span));
  return mixColor(stops[index], stops[index + 1], (clamped - index * span) / span);
}

/** Distance to a segment — a round-capped, round-joined stroke is its offset. */
function distanceToSegment(x, y, [startX, startY], [endX, endY]) {
  const runX = endX - startX;
  const runY = endY - startY;
  const lengthSquared = runX * runX + runY * runY;
  const along =
    lengthSquared > 0
      ? Math.min(1, Math.max(0, ((x - startX) * runX + (y - startY) * runY) / lengthSquared))
      : 0;
  return Math.hypot(x - (startX + along * runX), y - (startY + along * runY));
}

function isOnRidge(variant, x, y) {
  for (let index = 0; index < variant.ridge.length - 1; index += 1) {
    if (distanceToSegment(x, y, variant.ridge[index], variant.ridge[index + 1]) <= variant.ridgeStroke / 2) {
      return true;
    }
  }
  return false;
}

/** Topmost element covering this design-space point, or null. */
function colorAt(variant, x, y) {
  // Ridge first: the disc reads as rising BEHIND it, which is the whole reason
  // the two overlap at all.
  if (isOnRidge(variant, x, y)) {
    // Darker as it falls away to the left and right, so the ridge has depth
    // rather than reading as a flat zigzag.
    return rampColor([BRASS_LIGHT, BRASS, BRASS_DEEP], (x + y) / (DESIGN_SIZE * 2));
  }
  const [discX, discY] = variant.discCentre;
  if (Math.hypot(x - discX, y - discY) <= variant.discRadius) {
    // Lit from the upper left, like every other raised surface in the interface.
    const lighting = (x - discX + (y - discY)) / (variant.discRadius * 2) + 0.5;
    return rampColor([HIGHLIGHT, BRASS_LIGHT, BRASS], lighting);
  }
  return null;
}

function renderMark(variant, size) {
  const rgba = new Uint8Array(size * size * 4);
  const scale = DESIGN_SIZE / size;
  const step = 1 / SAMPLES_PER_AXIS;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sampleY = 0; sampleY < SAMPLES_PER_AXIS; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLES_PER_AXIS; sampleX += 1) {
          const color = colorAt(
            variant,
            (pixelX + (sampleX + 0.5) * step) * scale,
            (pixelY + (sampleY + 0.5) * step) * scale
          );
          if (color) {
            red += color[0];
            green += color[1];
            blue += color[2];
            covered += 1;
          }
        }
      }
      const offset = (pixelY * size + pixelX) * 4;
      if (covered > 0) {
        // Straight alpha, not premultiplied: the colour is the average of the
        // samples that hit something, and coverage becomes the alpha on its own.
        rgba[offset] = Math.round(red / covered);
        rgba[offset + 1] = Math.round(green / covered);
        rgba[offset + 2] = Math.round(blue / covered);
        rgba[offset + 3] = Math.round((covered / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)) * 255);
      }
    }
  }

  return encodePng(size, rgba);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
  [join(projectRoot, "public", "logo.png"), MARK_VARIANTS.logo, 512],
  // Fallback for the browsers that still will not take an SVG in rel="icon".
  [join(projectRoot, "src", "app", "icon1.png"), MARK_VARIANTS.icon, 64]
];

for (const [path, variant, size] of outputs) {
  writeFileSync(path, renderMark(variant, size));
  console.log(`${path} ${size}x${size}`);
}
